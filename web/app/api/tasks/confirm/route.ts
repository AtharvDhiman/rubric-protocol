/**
 * POST /api/tasks/confirm
 *
 * The client posts a transaction signature. The server verifies it against the
 * chain and only then advances the database row.
 *
 * This route exists because the UI must never show a state it has not verified.
 * A wallet returning a signature means the transaction was *sent*, not that it
 * landed, and not that it did what we think. So we re-read the Task account and
 * check that the rubric hash on-chain is byte-identical to the one we stored.
 * If a client ever seals different clauses than it drafted, this is where it is
 * caught - and the row is quarantined rather than published.
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { fetchTask, transactionSucceeded } from "@/lib/server/program";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { id, signature, kind } = body ?? {};
  if (typeof id !== "string" || typeof signature !== "string") {
    return NextResponse.json(
      { error: "id and signature are required." },
      { status: 400 }
    );
  }
  const step: "create" | "submit" | "reclaim" =
    kind === "submit" ? "submit" : kind === "reclaim" ? "reclaim" : "create";

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  // 1. Did the transaction actually land?
  const landed = await transactionSucceeded(signature);
  if (!landed.ok) {
    return NextResponse.json(
      { error: landed.reason ?? "Transaction could not be confirmed." },
      { status: 409 }
    );
  }

  // 2. What does the chain actually say about this task?
  let onChain;
  try {
    onChain = await fetchTask(
      new PublicKey(task.creatorAddress),
      task.onchainTaskId
    );
  } catch (error) {
    console.error("[confirm] chain read failed:", error);
    return NextResponse.json(
      { error: "Could not read the task from the chain. Try again shortly." },
      { status: 503 }
    );
  }

  if (!onChain) {
    return NextResponse.json(
      { error: "No task account exists at the expected address yet." },
      { status: 409 }
    );
  }

  // 3. THE CHECK THAT MATTERS. The clauses we hold must be the clauses that
  //    were sealed. If they differ, this row cannot be judged against that
  //    task, and publishing it would be advertising criteria that are not
  //    binding. Refuse, loudly, and leave the row PENDING.
  if (onChain.rubricHashHex !== task.rubricHash) {
    console.error(
      `[confirm] rubric hash mismatch for task ${task.id}: ` +
        `db=${task.rubricHash} chain=${onChain.rubricHashHex}`
    );
    return NextResponse.json(
      {
        error:
          "The clauses sealed on-chain do not match the clauses on record. " +
          "This task has not been published. Nothing was lost - the escrow is " +
          "still recoverable by its poster after the deadline.",
      },
      { status: 409 }
    );
  }

  if (step === "create") {
    if (onChain.state !== "open") {
      return NextResponse.json(
        { error: `Task is ${onChain.state} on-chain, not open.` },
        { status: 409 }
      );
    }
    const updated = await prisma.task.update({
      where: { id },
      data: { state: "OPEN", txCreate: signature },
    });
    return NextResponse.json({ id: updated.id, state: updated.state });
  }

  if (step === "reclaim") {
    // The poster took the escrow back after the window closed. Trust the chain,
    // not the caller: `reclaim_expired` is the only way a task reaches Refunded
    // this way, and it is terminal, so if the chain does not say Refunded then
    // whatever this signature did, it was not that.
    if (onChain.state !== "refunded") {
      return NextResponse.json(
        { error: `Task is ${onChain.state} on-chain, not refunded.` },
        { status: 409 }
      );
    }
    const updated = await prisma.task.update({
      where: { id },
      data: {
        state: "REFUNDED",
        // Cleared because the escrow account is closed and the money is back
        // with the poster. Leaving a stale hold reason would read as though a
        // human still owed this task a decision.
        heldReason: null,
      },
    });
    return NextResponse.json({ id: updated.id, state: updated.state });
  }

  // step === "submit"
  if (onChain.state !== "submitted") {
    return NextResponse.json(
      { error: `Task is ${onChain.state} on-chain, not submitted.` },
      { status: 409 }
    );
  }
  if (onChain.submissionHashHex !== task.submissionHash) {
    console.error(
      `[confirm] submission hash mismatch for task ${task.id}: ` +
        `db=${task.submissionHash} chain=${onChain.submissionHashHex}`
    );
    return NextResponse.json(
      {
        error:
          "The submission sealed on-chain does not match the submission on record.",
      },
      { status: 409 }
    );
  }

  const updated = await prisma.task.update({
    where: { id },
    data: {
      state: "SUBMITTED",
      txSubmit: signature,
      workerAddress: onChain.worker?.toBase58() ?? task.workerAddress,
      submittedAt: new Date(),
    },
  });
  return NextResponse.json({ id: updated.id, state: updated.state });
}
