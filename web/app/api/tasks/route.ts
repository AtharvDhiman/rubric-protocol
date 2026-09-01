/**
 * POST /api/tasks  - draft a task: validate, canonicalize, hash, store as PENDING
 * GET  /api/tasks  - list tasks for the docket
 *
 * POST does NOT touch the chain. It returns the task id and the rubric hash so
 * the client can build and sign `create_task` itself - the poster's wallet pays
 * and signs, never the server.
 */

import { NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WRITE_MESSAGE, demoTasks } from "@/lib/demo";
import { prisma } from "@/lib/db";
import { serializeBigInts } from "@/lib/db";
import { hashRubricHex, validateRubric } from "@/lib/hash";
import { MAX_BOUNTY_BASE_UNITS, CATEGORIES } from "@/lib/constants";
import { PublicKey } from "@solana/web3.js";

export const runtime = "nodejs";

function badRequest(message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status: 400 });
}

function isValidAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  // No database, so there is nothing to write to. Say so plainly rather than
  // failing with a connection error, or worse, appearing to succeed.
  if (DEMO_MODE) {
    return NextResponse.json({ error: DEMO_WRITE_MESSAGE }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }

  const { title, clauses, bountyAmount, deadline, category, creatorAddress, mint } =
    body ?? {};

  if (!isValidAddress(creatorAddress)) {
    return badRequest("creatorAddress must be a valid Solana address.");
  }
  if (!isValidAddress(mint)) {
    return badRequest("mint must be a valid Solana address.");
  }
  if (typeof title !== "string" || !Array.isArray(clauses)) {
    return badRequest("title must be a string and clauses an array of strings.");
  }
  if (clauses.some((c: unknown) => typeof c !== "string")) {
    return badRequest("Every clause must be a string.");
  }

  // The same validation the UI runs, applied again here. A client-side check is
  // a courtesy; this one is the rule.
  const problems = validateRubric({ title, clauses });
  if (problems.length > 0) {
    return badRequest("The rubric is not valid.", { problems });
  }

  if (typeof bountyAmount !== "string" && typeof bountyAmount !== "number") {
    return badRequest("bountyAmount must be an integer string in base units.");
  }
  let bounty: bigint;
  try {
    bounty = BigInt(bountyAmount);
  } catch {
    return badRequest("bountyAmount must be an integer string in base units.");
  }
  if (bounty <= 0n) return badRequest("bountyAmount must be greater than zero.");
  if (bounty > BigInt(MAX_BOUNTY_BASE_UNITS)) {
    return badRequest(
      `bountyAmount is above the MVP cap of ${MAX_BOUNTY_BASE_UNITS} base units (50 USDC).`
    );
  }

  const deadlineMs = Number(deadline);
  if (!Number.isFinite(deadlineMs)) {
    return badRequest("deadline must be a unix timestamp in seconds.");
  }
  const deadlineDate = new Date(deadlineMs * 1000);
  if (deadlineDate.getTime() <= Date.now()) {
    return badRequest("deadline must be in the future.");
  }

  if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) {
    return badRequest(`category must be one of: ${CATEGORIES.join(", ")}.`);
  }

  // THE HASH. Computed by the same function the verifier will use at judge time.
  // The client is sent this value and must write exactly it on-chain; the
  // confirm step re-reads the account and checks that it did.
  const rubricHash = hashRubricHex({ title, clauses });

  // The on-chain task id must be unique per creator. Take the next one after
  // whatever this creator already has, so a poster's ids stay dense and
  // predictable.
  const latest = await prisma.task.findFirst({
    where: { creatorAddress },
    orderBy: { onchainTaskId: "desc" },
    select: { onchainTaskId: true },
  });
  const onchainTaskId = (latest?.onchainTaskId ?? 0n) + 1n;

  const task = await prisma.task.create({
    data: {
      onchainTaskId,
      creatorAddress,
      title: title.trim(),
      clauses: clauses.map((c: string) => c.trim()).filter(Boolean),
      rubricHash,
      bountyAmount: bounty,
      mint,
      deadline: deadlineDate,
      category,
      state: "PENDING",
    },
  });

  return NextResponse.json(
    serializeBigInts({
      id: task.id,
      taskId: onchainTaskId.toString(),
      rubricHash,
    }),
    { status: 201 }
  );
}

export async function GET(request: Request) {
  if (DEMO_MODE) {
    // The sample docket, in the same envelope the real query returns.
    const all = demoTasks();
    return NextResponse.json(
      serializeBigInts({
        tasks: all.map((task) => ({
          ...task,
          clauseCount: task.clauses.length,
          clauses: undefined,
        })),
        page: 1,
        perPage: all.length,
        total: all.length,
        totalEscrow: all
          .filter((task) => ["OPEN", "SUBMITTED", "HELD"].includes(task.state))
          .reduce((sum, task) => sum + task.bountyAmount, 0n)
          .toString(),
      })
    );
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const perPage = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("perPage") ?? 20) || 20)
  );
  const category = url.searchParams.get("category");

  // PENDING tasks are deliberately excluded: their create transaction has not
  // confirmed, so showing them on the docket would advertise bounties that do
  // not exist on-chain.
  const where: Record<string, unknown> = { state: { not: "PENDING" } };
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    where.category = category;
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        onchainTaskId: true,
        title: true,
        clauses: true,
        bountyAmount: true,
        deadline: true,
        category: true,
        state: true,
        creatorAddress: true,
        confidence: true,
      },
    }),
    prisma.task.count({ where }),
  ]);

  const totalEscrow = await prisma.task.aggregate({
    where: { state: { in: ["OPEN", "SUBMITTED", "HELD"] } },
    _sum: { bountyAmount: true },
  });

  return NextResponse.json(
    serializeBigInts({
      tasks: tasks.map((t) => ({
        ...t,
        clauseCount: t.clauses.length,
        clauses: undefined,
      })),
      page,
      perPage,
      total,
      totalEscrow: (totalEscrow._sum.bountyAmount ?? 0n).toString(),
    })
  );
}
