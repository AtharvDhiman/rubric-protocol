/**
 * GET /api/tasks/[id]/address
 *
 * The on-chain addresses for a task: its PDA, its escrow, the creator, and the
 * task id. Derivation lives in one place (lib/solana.ts) and the client asks for
 * the answer rather than re-deriving it, so a seed change cannot silently leave
 * the browser pointing at a stale address.
 *
 * Everything returned here is public and derivable by anyone.
 */

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { escrowAddress, taskPda, usdcMint } from "@/lib/solana";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      creatorAddress: true,
      onchainTaskId: true,
      mint: true,
    },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  try {
    const creator = new PublicKey(task.creatorAddress);
    const pda = taskPda(creator, task.onchainTaskId);
    const mint = task.mint ? new PublicKey(task.mint) : usdcMint();
    return NextResponse.json({
      task: pda.toBase58(),
      escrow: escrowAddress(pda, mint).toBase58(),
      creator: task.creatorAddress,
      taskId: task.onchainTaskId.toString(),
      mint: mint.toBase58(),
    });
  } catch (error) {
    console.error("[address] derivation failed:", error);
    return NextResponse.json(
      { error: "The program id is not configured in this environment." },
      { status: 503 }
    );
  }
}
