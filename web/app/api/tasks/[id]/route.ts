/**
 * GET /api/tasks/[id] - one task, with its verdict if it has been decided.
 *
 * The submission content is returned so the task page can show what was
 * delivered. The verdict JSON is returned exactly as it was hashed, so anyone
 * can recompute `reasoningHash` themselves and check it against the chain.
 */

import { NextResponse } from "next/server";
import { DEMO_MODE, demoTaskById } from "@/lib/demo";
import { prisma, serializeBigInts } from "@/lib/db";
import { hideSampleOnMainnet } from "@/lib/sample-data";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  let task;
  try {
    task = DEMO_MODE
      ? demoTaskById(id)
      : // A sample row does not exist on mainnet (lib/sample-data.ts).
        hideSampleOnMainnet(await prisma.task.findUnique({ where: { id } }));
  } catch (error) {
    // No database, or it is unreachable: say so, rather than an unexplained 500.
    console.error("[task] database unreachable:", error);
    return NextResponse.json({ error: "The record store is unavailable." }, { status: 503 });
  }
  if (!task || task.state === "PENDING") {
    // A PENDING task has no confirmed on-chain existence, so as far as the
    // public is concerned it does not exist.
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  return NextResponse.json(serializeBigInts({ task }));
}
