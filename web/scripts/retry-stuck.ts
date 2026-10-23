/**
 * Re-run the judge on tasks that were never decided.
 *
 * WHY: verification is triggered by exactly one thing, the worker's own browser tab.
 * If that call fails, or the tab is closed during a judge run that can take minutes,
 * nothing ever calls it again. See lib/stuck-tasks.ts for what counts as stuck.
 *
 * WHAT IT DOES
 *   1. Reads the database (READ ONLY - this script never writes to it) for tasks that
 *      are Submitted with no verdict, or held for an operational reason.
 *   2. Asks GET /api/health/verifier whether the verifier can settle. If it cannot,
 *      it refuses to start: an empty wallet fails every task identically.
 *   3. With --run, calls POST /api/tasks/<id>/verify for each, one at a time. That
 *      route does the actual judging and settling, and is the only thing that signs.
 *
 * It needs NO secret key. It never sees VERIFIER_SECRET_KEY and cannot sign anything;
 * it can only ask the deployed app to do what the worker's tab would have done.
 * The only secret it reads is DATABASE_URL, to list the tasks.
 *
 *   # Look: lists what would be retried and does nothing else (the default).
 *   npx tsx scripts/retry-stuck.ts --base-url https://your-app.example
 *
 *   # Do it.
 *   npx tsx scripts/retry-stuck.ts --base-url https://your-app.example --run
 *
 * Options:
 *   --base-url       REQUIRED, no default. Which deployment (and so which verifier
 *                    wallet) is asked to judge. http:// is accepted only for localhost.
 *   --run            actually judge. Without it, nothing is called.
 *   --older-than     minutes a task must have waited (default 5). Never below 1: a
 *                    younger task is probably being judged right now.
 *   --limit          most tasks judged in one run (default 5, max 50).
 *   --delay          seconds between judged tasks (default 5).
 *   --max-failures   consecutive failures that stop the run (default 2).
 *
 * Run ONE copy at a time. Two runs at once will judge the same task twice.
 *
 * DATABASE_URL (and DATABASE_SCHEMA, if you use one) are read from the environment,
 * then web/.env.local, then web/.env. The decisions live in lib/retry-stuck.ts and
 * lib/stuck-tasks.ts, where they are unit-tested.
 */

import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { selectStuck, type StuckKind, type StuckRow } from "../lib/stuck-tasks";
import {
  classifyResponse,
  classifyThrown,
  effectiveMinAgeMs,
  formatAge,
  parseRetryArgs,
  runRetries,
  type AttemptResult,
} from "../lib/retry-stuck";

// dotenv never overrides a variable that is already set, so the real environment wins.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

/** The route's own cap is 300 s. A little over, so its answer can arrive. */
const REQUEST_TIMEOUT_MS = 330_000;
/** Enough to see every stuck task; the limit, not this, bounds the work done. */
const MAX_ROWS = 500;

function fatal(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

interface Candidate extends StuckRow {
  kind: StuckKind;
  waitedMs: number;
}

/** Fetch JSON, or null if the response was not JSON. Never throws on a bad body. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const parsed = parseRetryArgs(process.argv.slice(2));
  if (!parsed.ok) fatal(parsed.error);
  const args = parsed.value;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fatal("DATABASE_URL is not set (environment, .env.local or .env).");
  const schema = process.env.DATABASE_SCHEMA || "public";

  // Say which database, without the credentials. Reading the wrong one is the
  // mistake this line exists to catch.
  let dbHost = "(unparseable)";
  try {
    dbHost = new URL(databaseUrl).host;
  } catch {
    /* leave the placeholder; the connection will fail loudly on its own */
  }

  console.log(`\nDeployment : ${args.baseUrl}`);
  console.log(`Database   : ${dbHost}  (schema ${schema}, read-only)`);
  console.log(`Mode       : ${args.run ? "RUN - will judge tasks" : "dry run - will not judge anything"}`);

  // --- The verifier must be able to settle before anything is spent ---------------
  let canSettle = false;
  try {
    const res = await fetch(`${args.baseUrl}/api/health/verifier`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await readJson(res);
    const report = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    canSettle = report.canSettle === true;
    const level = typeof report.level === "string" ? report.level : "unknown";
    const message = typeof report.message === "string" ? report.message : "no message";
    console.log(`Verifier   : ${level} - ${message}`);
    if (level === "low") {
      console.log("             (low, but still able to settle. Top the wallet up soon.)");
    }
  } catch (error) {
    const why = classifyThrown(error);
    console.log(`Verifier   : could not be checked (${why.kind === "failed" ? why.reason : "error"})`);
  }

  if (args.run && !canSettle) {
    fatal(
      "Refusing to start: the verifier cannot settle verdicts right now, so every judge run " +
        "would be spent and then thrown away. Fix the verifier (see docs/verifier-runbook.md), " +
        "then run this again."
    );
  }

  // --- What is stuck? ------------------------------------------------------------
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
  });

  let candidates: Candidate[];
  const now = new Date();
  try {
    const rows = await prisma.task.findMany({
      where: {
        state: { in: ["SUBMITTED", "HELD"] },
        submissionContent: { not: null },
        workerAddress: { not: null },
      },
      select: { id: true, state: true, heldReason: true, submittedAt: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: MAX_ROWS,
    });

    candidates = selectStuck(
      rows.map((r) => ({ ...r, hasSubmission: true })),
      now,
      args.olderThanMs
    ).map(({ row, kind }) => ({
      ...row,
      kind,
      waitedMs: now.getTime() - (row.submittedAt ?? row.updatedAt).getTime(),
    }));
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `Waiting at least ${formatAge(effectiveMinAgeMs(args.olderThanMs))} before a task counts as stuck.\n`
  );

  if (candidates.length === 0) {
    console.log("Nothing is stuck. No task is waiting on a verdict that will not arrive.\n");
    return;
  }

  console.log(`${candidates.length} stuck task(s), oldest first:\n`);
  for (const c of candidates) {
    const what = c.kind === "unjudged" ? "never judged" : "held: settlement did not land";
    console.log(`  ${c.id.padEnd(28)} waited ${formatAge(c.waitedMs).padEnd(8)} ${what}`);
  }

  if (!args.run) {
    const n = Math.min(candidates.length, args.limit);
    console.log(
      `\nDry run. Nothing was judged. Re-run with --run to judge up to ${n} of them ` +
        `(each uses one judge call and can take minutes).\n`
    );
    return;
  }

  // --- Judge them, carefully -----------------------------------------------------
  console.log(
    `\nJudging up to ${args.limit}, one at a time, pausing ${args.delayMs / 1000}s between. ` +
      `Stops after ${args.maxFailures} failure(s) in a row, or at once if the verifier cannot settle.\n`
  );

  const attempt = async (c: Candidate): Promise<AttemptResult> => {
    const res = await fetch(`${args.baseUrl}/api/tasks/${encodeURIComponent(c.id)}/verify`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return classifyResponse(res.status, await readJson(res));
  };

  const describe = (r: AttemptResult): string => {
    switch (r.kind) {
      case "decided":
        return r.outcome;
      case "skipped":
        return `skipped (${r.reason})`;
      case "unavailable":
        return `REFUSED - verifier is ${r.level}`;
      case "failed":
        return `FAILED (${r.reason})`;
    }
  };

  const summary = await runRetries(
    candidates,
    { limit: args.limit, maxFailures: args.maxFailures, delayMs: args.delayMs },
    {
      attempt,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onResult: (c, r) => console.log(`  ${c.id.padEnd(28)} ${describe(r)}`),
    }
  );

  const tally = (kind: AttemptResult["kind"]) => summary.results.filter((x) => x.result.kind === kind).length;
  console.log(
    `\n${tally("decided")} decided, ${tally("skipped")} skipped, ${tally("failed")} failed.`
  );

  if (summary.stoppedBecause === "done") {
    console.log("Every stuck task was attempted.\n");
  } else if (summary.stoppedBecause === "limit") {
    console.log(`Stopped at the limit of ${args.limit}. ${summary.notAttempted} not attempted - run again to continue.\n`);
  } else {
    // Both of the others mean something is wrong, so the exit code says so.
    process.exitCode = 1;
    console.error(
      summary.stoppedBecause === "verifier-unavailable"
        ? `Stopped: the verifier cannot settle. ${summary.notAttempted} not attempted. ` +
            `Check ${args.baseUrl}/api/health/verifier and docs/verifier-runbook.md.\n`
        : `Stopped after ${args.maxFailures} failure(s) in a row. ${summary.notAttempted} not attempted. ` +
            `Check the deployment's logs before trying again.\n`
    );
  }
}

main().catch((error: unknown) => {
  // The error's NAME only. A database driver's message can contain the connection
  // string, and this output ends up in terminals and CI logs.
  const name = error instanceof Error ? error.name : "unknown error";
  fatal(`The retry run failed unexpectedly (${name}). Check DATABASE_URL and --base-url, then try again.`);
});
