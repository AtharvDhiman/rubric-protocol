/**
 * GET /api/tasks/[id] - one task, with its verdict if it has been decided.
 *
 * The submission content is returned so the task page can show what was
 * delivered. The verdict JSON is returned exactly as it was hashed, so anyone
 * can recompute `reasoningHash` themselves and check it against the chain.
 */

import { NextResponse } from "next/server";
import { prisma, serializeBigInts } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.state === "PENDING") {
    // A PENDING task has no confirmed on-chain existence, so as far as the
    // public is concerned it does not exist.
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json(serializeBigInts({ task }));
}
