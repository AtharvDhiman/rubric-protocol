/**
 * POST /api/tasks/[id]/verify - run the judge and settle on-chain.
 *
 * SERVER ONLY. This is the one route that signs with the verifier key.
 *
 * The order of operations is deliberate and should not be rearranged:
 *
 *   1. Re-read the task FROM THE CHAIN. Not from Postgres. Postgres is a cache.
 *   2. Refuse if the chain says the task is already terminal (idempotency - a
 *      double-submitted verdict must not double-pay, and while the program
 *      would reject it anyway, we should not be spending money on a judge run
 *      to discover that).
 *   3. Re-derive the rubric hash from the stored clauses and require it to
 *      equal the sealed hash. If the clauses we would judge against are not the
 *      clauses that were sealed, we must not judge at all.
 *   4. PREFLIGHT the verifier: is the key one the chain trusts, and can the
 *      wallet pay? The judge is the expensive step - API quota and up to five
 *      minutes - and its decision is thrown away if the settlement then cannot be
 *      paid for. On failure the task is left EXACTLY as it was, not marked held.
 *   5. Only then run the judge.
 *   6. If the judge held the task, record HELD and DO NOT touch the chain. A hold
 *      because the judge could not be ASKED is recorded as operational and stores no
 *      ruling; a hold because it could not settle is a judgement hold and stores its
 *      verdict (see HoldKind in lib/verifier.ts).
 *   7. Otherwise sign and send the verdict, then record the result. If THAT fails
 *      the task is held for an OPERATIONAL reason (lib/holds.ts), which is not a
 *      ruling on the work and is shown as such.
 */

import { NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WRITE_MESSAGE } from "@/lib/demo";
import { PublicKey } from "@solana/web3.js";
import type { Prisma } from "@prisma/client";
import { prisma, serializeBigInts } from "@/lib/db";
import {
  hashRubricHex,
  hashSubmissionHex,
  hashVerdict,
  hashVerdictHex,
} from "@/lib/hash";
import { runVerdict } from "@/lib/verifier";
import { fetchTask, sendVerdict } from "@/lib/server/program";
import { getVerifierHealth } from "@/lib/server/verifier-health";
import { operationalHold } from "@/lib/holds";

export const runtime = "nodejs";
/** The judge can take a while to think. Do not let the platform cut it off. */
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  // No database, so there is nothing to write to. Say so plainly rather than
  // failing with a connection error, or worse, appearing to succeed.
  if (DEMO_MODE) {
    return NextResponse.json({ error: DEMO_WRITE_MESSAGE }, { status: 503 });
  }

  const { id } = await context.params;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.state === "PENDING") {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.state === "SETTLED" || task.state === "REFUNDED") {
    return NextResponse.json(
      { error: "This task has already been decided.", state: task.state },
      { status: 409 }
    );
  }
  if (!task.submissionContent || !task.workerAddress) {
    return NextResponse.json(
      { error: "This task has no submission to judge." },
      { status: 409 }
    );
  }

  // --- 1. What does the chain say? ----------------------------------------
  const creator = new PublicKey(task.creatorAddress);
  let onChain;
  try {
    onChain = await fetchTask(creator, task.onchainTaskId);
  } catch (error) {
    console.error("[verify] chain read failed:", error);
    return NextResponse.json(
      { error: "Could not read the task from the chain." },
      { status: 503 }
    );
  }
  if (!onChain) {
    return NextResponse.json(
      { error: "This task does not exist on-chain." },
      { status: 409 }
    );
  }

  // --- 2. Idempotency ------------------------------------------------------
  if (onChain.state === "settled" || onChain.state === "refunded") {
    // The chain already decided. Reconcile our row to match and stop.
    await prisma.task.update({
      where: { id },
      data: { state: onChain.state === "settled" ? "SETTLED" : "REFUNDED" },
    });
    return NextResponse.json(
      { error: "This task is already terminal on-chain.", state: onChain.state },
      { status: 409 }
    );
  }
  if (onChain.state !== "submitted") {
    return NextResponse.json(
      { error: `Task is ${onChain.state} on-chain; only a submitted task can be judged.` },
      { status: 409 }
    );
  }

  // --- 3. The clauses we are about to judge must be the sealed ones --------
  const recomputed = hashRubricHex({ title: task.title, clauses: task.clauses });
  if (recomputed !== onChain.rubricHashHex) {
    console.error(
      `[verify] REFUSING TO JUDGE task ${task.id}: stored clauses hash to ` +
        `${recomputed} but the chain sealed ${onChain.rubricHashHex}.`
    );
    await prisma.task.update({
      where: { id },
      data: {
        state: "HELD",
        heldReason:
          "The clauses on record do not match the clauses sealed on-chain, so " +
          "this task cannot be judged automatically.",
      },
    });
    return NextResponse.json(
      { error: "Sealed clause mismatch. The task has been held for review." },
      { status: 409 }
    );
  }

  // PREFLIGHT. Can the verifier actually settle what the judge is about to decide?
  //
  // Everything above is cheap. The judge is not: it spends API quota and up to five
  // minutes, and its decision is discarded if the settlement transaction then
  // cannot be paid for or signed. So ask first - is there a configured key the
  // chain trusts, and can the wallet pay a fee?
  //
  // On failure the task is deliberately left EXACTLY as it was: still Submitted,
  // nothing marked held. An empty wallet says nothing about the work, so it must not
  // be recorded as a hold on the work, and leaving the row alone means it is simply
  // picked up again once the wallet is funded (scripts/retry-stuck.ts). The wallet
  // being low is NOT a failure here - only being unable to settle is.
  const health = await getVerifierHealth();
  if (!health.canSettle) {
    console.error(`[verify] NOT JUDGING task ${task.id}: ${health.message}`);
    return NextResponse.json(
      {
        error:
          "Judging is temporarily unavailable. Nothing was decided and this task is unchanged.",
        code: "VERIFIER_UNAVAILABLE",
        level: health.level,
      },
      { status: 503 }
    );
  }

  // --- 3b. ...and so must the submission ----------------------------------
  //
  // The clause check above exists because nobody should be able to move the
  // goalposts after work starts. The same argument runs the other way: the
  // worker committed `submission_hash` on-chain when they called `submit_work`,
  // so if what we are about to hand the judge does not hash to that, the
  // deliverable in this database is not the one they committed to. Judging it
  // would settle real money against content the worker never signed for.
  // Whether that came from tampering or a bug does not matter here - either way
  // it is not automatically judgeable.
  if (onChain.submissionHashHex && task.submissionContent) {
    const submissionDigest = hashSubmissionHex(task.submissionContent);
    if (submissionDigest !== onChain.submissionHashHex) {
      console.error(
        `[verify] REFUSING TO JUDGE task ${task.id}: stored submission hashes ` +
          `to ${submissionDigest} but the chain sealed ${onChain.submissionHashHex}.`
      );
      await prisma.task.update({
        where: { id },
        data: {
          state: "HELD",
          heldReason:
            "The submission on record does not match the one sealed on-chain, " +
            "so this task cannot be judged automatically.",
        },
      });
      return NextResponse.json(
        { error: "Submission mismatch. The task has been held for review." },
        { status: 409 }
      );
    }
  }

  // --- 4. Judge ------------------------------------------------------------
  const verdict = await runVerdict(
    { title: task.title, clauses: task.clauses },
    { content: task.submissionContent, workerAddress: task.workerAddress }
  );

  const reasoningHashHex = hashVerdictHex(verdict.published);

  // --- 5. Held: record it, touch nothing on-chain --------------------------
  if (verdict.outcome === "needs_manual_review") {
    // The judge could not be ASKED (out of quota, too slow, down). It formed no view
    // of the work, so there is no ruling to record: no verdict, no confidence, no
    // decision time. Storing the empty placeholder ruling would show the reader "the
    // judge was 0% sure", and would hide the task from scripts/retry-stuck.ts, which
    // only retries operational holds. The state alone changes, and the reason says
    // what happened.
    if (verdict.holdKind === "operational") {
      const reason = verdict.heldReason ?? "The judge could not be reached, so nothing was decided.";
      console.error(`[verify] judge unavailable for task ${task.id}: ${reason}`);
      await prisma.task.update({
        where: { id },
        data: { state: "HELD", heldReason: operationalHold(reason) },
      });
      return NextResponse.json(
        {
          error: "The judge could not be reached. Nothing was decided and this task is on hold.",
          code: "JUDGE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        state: "HELD",
        verdictJson: verdict.published as unknown as Prisma.InputJsonValue,
        verdictReasoningHash: reasoningHashHex,
        confidence: verdict.confidence,
        heldReason: verdict.heldReason ?? "The judge was not confident enough to settle.",
        decidedAt: new Date(),
      },
    });
    return NextResponse.json(
      serializeBigInts({
        outcome: verdict.outcome,
        heldReason: updated.heldReason,
        confidence: verdict.confidence,
        verdict: verdict.published,
      })
    );
  }

  // --- 6. Settle -----------------------------------------------------------
  let signature: string;
  try {
    signature = await sendVerdict({
      creator,
      taskId: task.onchainTaskId,
      worker: new PublicKey(task.workerAddress),
      mint: new PublicKey(task.mint),
      approved: verdict.approved,
      confidence: verdict.confidence,
      reasoningHash: hashVerdict(verdict.published),
    });
  } catch (error) {
    // Never leak the SDK error to the caller - it can contain RPC internals.
    console.error("[verify] submit_verdict failed:", error);

    // Say WHY when we can. An empty wallet, an untrusted key and a flaky RPC need
    // very different fixes, and the reader of the page is not the person who can
    // apply any of them. The health message holds amounts and PUBLIC keys only.
    const cause = await getVerifierHealth().catch(() => null);

    // Held for an OPERATIONAL reason, and recorded as exactly that: the judge ran,
    // but nothing was decided on-chain. Deliberately NOT stored: the verdict, its
    // hash, its confidence, or a decision time. A retry re-runs the judge and may
    // rule differently, so showing this run's verdict would display a ruling that
    // may not survive - and "decided at" would claim a decision that did not land.
    await prisma.task.update({
      where: { id },
      data: {
        state: "HELD",
        heldReason: operationalHold(
          "The judge ran, but the settlement transaction did not land, so nothing was decided on-chain. " +
            (cause && !cause.ok ? `Likely cause: ${cause.message} ` : "") +
            "This is not a ruling on the work: the escrow is untouched and judging can be run again."
        ),
      },
    });
    return NextResponse.json(
      {
        error: "The verdict could not be settled on-chain. The task is held and will be retried.",
        code: "SETTLEMENT_FAILED",
      },
      { status: 502 }
    );
  }

  const updated = await prisma.task.update({
    where: { id },
    data: {
      state: verdict.approved ? "SETTLED" : "REFUNDED",
      verdictJson: verdict.published as unknown as Prisma.InputJsonValue,
      verdictReasoningHash: reasoningHashHex,
      confidence: verdict.confidence,
      txSettle: signature,
      decidedAt: new Date(),
      heldReason: null,
    },
  });

  return NextResponse.json(
    serializeBigInts({
      outcome: verdict.outcome,
      approved: verdict.approved,
      confidence: verdict.confidence,
      signature,
      state: updated.state,
      verdict: verdict.published,
    })
  );
}
