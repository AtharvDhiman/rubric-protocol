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
 *   4. Only then run the judge.
 *   5. If the judge held the task, record HELD and DO NOT touch the chain.
 *   6. Otherwise sign and send the verdict, then record the result.
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import type { Prisma } from "@prisma/client";
import { prisma, serializeBigInts } from "@/lib/db";
import { hashRubricHex, hashVerdict, hashVerdictHex } from "@/lib/hash";
import { runVerdict } from "@/lib/verifier";
import {
  fetchConfig,
  fetchTask,
  sendVerdict,
} from "@/lib/server/program";
import { checkVerifierMatchesConfig } from "@/lib/server/verifier-keypair";

export const runtime = "nodejs";
/** The judge can take a while to think. Do not let the platform cut it off. */
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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

  // A mismatched verifier key means every verdict we sign will bounce. Say so
  // now rather than after paying for a judge run.
  try {
    const config = await fetchConfig();
    const check = checkVerifierMatchesConfig(config.verifierAuthority);
    if (!check.ok) {
      return NextResponse.json(
        { error: "The verifier key is not the one this program trusts." },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[verify] could not read config:", error);
    return NextResponse.json(
      { error: "Could not read the protocol config from the chain." },
      { status: 503 }
    );
  }

  // --- 4. Judge ------------------------------------------------------------
  const verdict = await runVerdict(
    { title: task.title, clauses: task.clauses },
    { content: task.submissionContent, workerAddress: task.workerAddress }
  );

  const reasoningHashHex = hashVerdictHex(verdict.published);

  // --- 5. Held: record it, touch nothing on-chain --------------------------
  if (verdict.outcome === "needs_manual_review") {
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
    await prisma.task.update({
      where: { id },
      data: {
        state: "HELD",
        verdictJson: verdict.published as unknown as Prisma.InputJsonValue,
        verdictReasoningHash: reasoningHashHex,
        confidence: verdict.confidence,
        heldReason:
          "The judge reached a decision but the settlement transaction did not " +
          "land. The escrow is untouched and a human needs to retry it.",
        decidedAt: new Date(),
      },
    });
    return NextResponse.json(
      { error: "The verdict could not be settled on-chain. The task is held." },
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
