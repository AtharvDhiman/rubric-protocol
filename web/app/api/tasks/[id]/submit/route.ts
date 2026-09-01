/**
 * POST /api/tasks/[id]/submit
 *
 * Store a worker's deliverable and return its hash, which the worker then
 * commits on-chain with `submit_work`. The server does not sign anything here -
 * the worker's own wallet does, because the signature is what binds the payout
 * address to them.
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { hashSubmissionHex } from "@/lib/hash";
import { verifyWorkerProof } from "@/lib/server/worker-auth";
import type { WorkerProof } from "@/lib/worker-auth";

export const runtime = "nodejs";

/** Long enough for a real deliverable, short enough to bound the judge's input. */
const MAX_SUBMISSION_CHARS = 20_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { content, workerAddress, proof } = body ?? {};

  if (typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      { error: "A submission cannot be empty." },
      { status: 400 }
    );
  }
  if (content.length > MAX_SUBMISSION_CHARS) {
    return NextResponse.json(
      { error: `Submissions are limited to ${MAX_SUBMISSION_CHARS} characters.` },
      { status: 400 }
    );
  }
  if (typeof workerAddress !== "string") {
    return NextResponse.json(
      { error: "workerAddress must be a valid Solana address." },
      { status: 400 }
    );
  }
  try {
    new PublicKey(workerAddress);
  } catch {
    return NextResponse.json(
      { error: "workerAddress must be a valid Solana address." },
      { status: 400 }
    );
  }

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.state === "PENDING") {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.state !== "OPEN") {
    return NextResponse.json(
      { error: `This task is ${task.state.toLowerCase()} and is not accepting work.` },
      { status: 409 }
    );
  }
  if (task.deadline.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "The work window for this task has closed." },
      { status: 409 }
    );
  }

  const submissionHash = hashSubmissionHex(content);

  // Prove the caller actually holds `workerAddress` before letting them write.
  //
  // Until this existed the field was just a string in a request body, so anyone
  // could overwrite a submission another worker had staged but not yet sealed -
  // not to steal the bounty, which only the chain can direct, but to break an
  // honest worker's submission so their task got held instead of judged.
  //
  // The signature covers the task, the wallet and a hash of this exact body, so
  // it cannot be replayed onto different content or a different task, and it is
  // only accepted within a few minutes of being issued.
  const auth = verifyWorkerProof({
    taskId: id,
    workerAddress,
    submissionHash,
    proof: proof as WorkerProof | undefined,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  // Nobody but the worker who staged it may replace a submission. Signature or
  // not, silently overwriting someone else's staged work is not something this
  // endpoint should do.
  if (
    task.submissionContent &&
    task.workerAddress &&
    task.workerAddress !== workerAddress
  ) {
    return NextResponse.json(
      { error: "Another worker has already submitted to this task." },
      { status: 409 }
    );
  }



  await prisma.task.update({
    where: { id },
    data: {
      submissionContent: content,
      submissionHash,
      workerAddress,
      // State stays OPEN until the on-chain submit_work is confirmed. The row
      // must never claim a chain state that has not been verified.
    },
  });

  return NextResponse.json({ id, submissionHash });
}
