/**
 * POST /api/tasks/[id]/verify - run the judge and settle on-chain.
 *
 * SERVER ONLY. This is one of the two routes that signs with the verifier key (the
 * other is the human-review route, which shares every check below).
 *
 * The order of operations is deliberate and should not be rearranged:
 *
 *   1. prepareRuling (lib/server/judging.ts): re-read the task FROM THE CHAIN, not
 *      from Postgres, which is a cache. Refuse a task the chain says is already
 *      terminal (a double-submitted verdict must not double-pay). Require the stored
 *      clauses to hash to the sealed hash, and the stored submission to hash to the one
 *      the worker committed. If what we would judge is not what was sealed, we must
 *      not judge at all.
 *   2. PREFLIGHT the verifier: is the key one the chain trusts, and can the wallet pay?
 *      The judge is the expensive step - API quota and up to five minutes - and its
 *      decision is thrown away if the settlement then cannot be paid for. On failure the
 *      task is left EXACTLY as it was, not marked held.
 *   3. Only then run the judge.
 *   4. If the judge held the task, record HELD and DO NOT touch the chain. A hold
 *      because the judge could not be ASKED is recorded as operational and stores no
 *      ruling; a hold because it could not settle is a judgement hold and stores its
 *      verdict (see HoldKind in lib/verifier.ts).
 *   5. Otherwise sign and send the verdict (settleVerdict), then record the result. If
 *      THAT fails the task is held for an OPERATIONAL reason (lib/holds.ts), which is
 *      not a ruling on the work and is shown as such.
 */

import { NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WRITE_MESSAGE } from "@/lib/demo";
import type { Prisma } from "@prisma/client";
import { prisma, serializeBigInts } from "@/lib/db";
import { hashVerdictHex } from "@/lib/hash";
import { runVerdict } from "@/lib/verifier";
import { operationalHold } from "@/lib/holds";
import {
  prepareRuling,
  settleVerdict,
  verifierCanSettle,
  type Failure,
} from "@/lib/server/judging";

export const runtime = "nodejs";
/** The judge can take a while to think. Do not let the platform cut it off. */
export const maxDuration = 300;

const respond = (failure: Failure) =>
  NextResponse.json(failure.body, { status: failure.status });

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

  // --- 1. Is this task one we may rule on, according to the chain? --------------
  const prepared = await prepareRuling(id, { label: "verify" });
  if (!prepared.ok) return respond(prepared.failure);
  const { task, creator } = prepared.ready;

  // --- 2. PREFLIGHT. Can the verifier actually settle what is about to be decided?
  //
  // Everything above is cheap. The judge is not. On failure the task is deliberately
  // left EXACTLY as it was: still Submitted, nothing marked held. An empty wallet says
  // nothing about the work, so it must not be recorded as a hold on the work, and
  // leaving the row alone means it is simply picked up again once the wallet is funded
  // (scripts/retry-stuck.ts). The wallet being low is NOT a failure here - only being
  // unable to settle is.
  const preflight = await verifierCanSettle("verify", task.id);
  if (!preflight.ok) return respond(preflight.failure);

  // --- 3. Judge ------------------------------------------------------------------
  // prepareRuling guarantees both are present; the types do not know that.
  const verdict = await runVerdict(
    { title: task.title, clauses: task.clauses },
    { content: task.submissionContent as string, workerAddress: task.workerAddress as string }
  );

  const reasoningHashHex = hashVerdictHex(verdict.published);

  // --- 4. Held: record it, touch nothing on-chain --------------------------------
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

  // --- 5. Settle -----------------------------------------------------------------
  const settled = await settleVerdict({
    task,
    creator,
    approved: verdict.approved,
    confidence: verdict.confidence,
    published: verdict.published,
    label: "verify",
    onFailure: "hold",
  });
  if (!settled.ok) return respond(settled.failure);

  return NextResponse.json(
    serializeBigInts({
      outcome: verdict.outcome,
      approved: verdict.approved,
      confidence: verdict.confidence,
      signature: settled.signature,
      state: settled.updated.state,
      verdict: verdict.published,
    })
  );
}
