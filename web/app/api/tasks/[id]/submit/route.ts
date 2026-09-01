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

  const { content, workerAddress } = body ?? {};

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

  // KNOWN GAP - see "Known limitations" in the README.
  //
  // Nothing here proves the caller controls `workerAddress`; it is taken from
  // the request body. While the task is OPEN, anyone can therefore overwrite the
  // staged submission of a worker who has not yet sealed on-chain.
  //
  // What that does and does not buy an attacker: it CANNOT redirect the bounty,
  // because `submit_work` is signed by the worker's own wallet and the escrow
  // pays whoever the chain records. It CAN grief - overwrite the content a
  // worker staged so that the hash they go on to sign no longer matches what is
  // stored, at which point the verify route refuses to judge and holds the task.
  // Annoying and worth closing; not a path to anyone else's money.
  //
  // The real fix is to make the client sign a short message with its wallet and
  // verify that signature against `workerAddress` here. That adds a signing
  // prompt before the transaction, which is a product decision, so it is written
  // down rather than done quietly.
  const submissionHash = hashSubmissionHex(content);

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
