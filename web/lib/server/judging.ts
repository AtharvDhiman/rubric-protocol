import "server-only";

import { PublicKey } from "@solana/web3.js";
import type { Prisma, Task } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashRubricHex, hashSubmissionHex, hashVerdict, hashVerdictHex } from "@/lib/hash";
import { operationalHold } from "@/lib/holds";
import { hideSampleOnMainnet } from "@/lib/sample-data";
import { fetchTask, sendVerdict, type OnChainTask } from "@/lib/server/program";
import { getVerifierHealth } from "@/lib/server/verifier-health";

/**
 * The checks that must pass before ANYONE may rule on a task, and the settlement that
 * follows. Shared by the AI judge (app/api/tasks/[id]/verify) and by a human reviewer
 * (app/api/tasks/[id]/review), on purpose.
 *
 * WHY ONE COPY
 * ------------
 * These are the security-relevant steps: the chain is the truth and the database is a
 * cache; a decided task is never ruled on twice; the clauses on record must be the
 * ones that were sealed; the submission on record must be the one the worker committed.
 * Two routes carrying two copies of that would drift, and the one that drifted would be
 * the one that moves money on stale or tampered data. The reviewer is held to exactly
 * the standard the AI is.
 *
 * Failures are returned as { status, body } rather than thrown, because every caller
 * has to turn each one into an HTTP response.
 */

export interface Failure {
  status: number;
  body: Record<string, unknown>;
}

export interface Ready {
  task: Task;
  creator: PublicKey;
  onChain: OnChainTask;
}

const fail = (status: number, body: Record<string, unknown>): { ok: false; failure: Failure } => ({
  ok: false,
  failure: { status, body },
});

/**
 * Load a task and run every check that must pass before it may be ruled on.
 *
 * `onlyState` narrows who may be ruled on: the AI judges anything that is not
 * terminal; a reviewer rules only on a task that is HELD.
 *
 * On a mismatch the task is moved to HELD with a reason, because a task whose record
 * disagrees with the chain must not be ruled on by anyone until a person has looked.
 */
export async function prepareRuling(
  id: string,
  options: { label: string; onlyState?: "HELD" }
): Promise<{ ok: true; ready: Ready } | { ok: false; failure: Failure }> {
  const { label, onlyState } = options;

  // A sample row does not exist on mainnet, so nobody - judge or reviewer - may rule on one.
  const task = hideSampleOnMainnet(await prisma.task.findUnique({ where: { id } }));
  if (!task || task.state === "PENDING") return fail(404, { error: "Task not found." });
  if (task.state === "SETTLED" || task.state === "REFUNDED") {
    return fail(409, { error: "This task has already been decided.", state: task.state });
  }
  if (onlyState && task.state !== onlyState) {
    return fail(409, { error: `Only a ${onlyState.toLowerCase()} task can be ruled on here.`, state: task.state });
  }
  if (!task.submissionContent || !task.workerAddress) {
    return fail(409, { error: "This task has no submission to judge." });
  }

  // --- What does the chain say? ----------------------------------------------------
  const creator = new PublicKey(task.creatorAddress);
  let onChain: OnChainTask | null;
  try {
    onChain = await fetchTask(creator, task.onchainTaskId);
  } catch (error) {
    console.error(`[${label}] chain read failed:`, error);
    return fail(503, { error: "Could not read the task from the chain." });
  }
  if (!onChain) return fail(409, { error: "This task does not exist on-chain." });

  // --- Idempotency -----------------------------------------------------------------
  if (onChain.state === "settled" || onChain.state === "refunded") {
    // The chain already decided. Reconcile our row to match and stop.
    await prisma.task.update({
      where: { id },
      data: { state: onChain.state === "settled" ? "SETTLED" : "REFUNDED" },
    });
    return fail(409, { error: "This task is already terminal on-chain.", state: onChain.state });
  }
  if (onChain.state !== "submitted") {
    return fail(409, {
      error: `Task is ${onChain.state} on-chain; only a submitted task can be ruled on.`,
    });
  }

  // --- The clauses must be the sealed ones -----------------------------------------
  const recomputed = hashRubricHex({ title: task.title, clauses: task.clauses });
  if (recomputed !== onChain.rubricHashHex) {
    console.error(
      `[${label}] REFUSING TO RULE on task ${task.id}: stored clauses hash to ` +
        `${recomputed} but the chain sealed ${onChain.rubricHashHex}.`
    );
    await prisma.task.update({
      where: { id },
      data: {
        state: "HELD",
        heldReason:
          "The clauses on record do not match the clauses sealed on-chain, so " +
          "this task cannot be ruled on until a person has looked at it.",
      },
    });
    return fail(409, { error: "Sealed clause mismatch. The task has been held." });
  }

  // --- ...and so must the submission -----------------------------------------------
  //
  // The clause check exists because nobody should be able to move the goalposts after
  // work starts. The same argument runs the other way: the worker committed
  // `submission_hash` on-chain when they called `submit_work`, so if what is about to be
  // ruled on does not hash to that, the deliverable in this database is not the one they
  // committed to. Ruling on it would settle real money against content the worker never
  // signed for. Whether that came from tampering or a bug does not matter: it is not
  // rulable.
  if (onChain.submissionHashHex) {
    const digest = hashSubmissionHex(task.submissionContent);
    if (digest !== onChain.submissionHashHex) {
      console.error(
        `[${label}] REFUSING TO RULE on task ${task.id}: stored submission hashes ` +
          `to ${digest} but the chain sealed ${onChain.submissionHashHex}.`
      );
      await prisma.task.update({
        where: { id },
        data: {
          state: "HELD",
          heldReason:
            "The submission on record does not match the one sealed on-chain, " +
            "so this task cannot be ruled on until a person has looked at it.",
        },
      });
      return fail(409, { error: "Submission mismatch. The task has been held." });
    }
  }

  return { ok: true, ready: { task, creator, onChain } };
}

/**
 * Can the verifier settle what is about to be decided? Asked BEFORE the expensive step.
 * On failure the task is left exactly as it was (see the verify route).
 */
export async function verifierCanSettle(
  label: string,
  taskId: string
): Promise<{ ok: true } | { ok: false; failure: Failure }> {
  const health = await getVerifierHealth();
  if (health.canSettle) return { ok: true };
  console.error(`[${label}] NOT RULING on task ${taskId}: ${health.message}`);
  return fail(503, {
    error: "Judging is temporarily unavailable. Nothing was decided and this task is unchanged.",
    code: "VERIFIER_UNAVAILABLE",
    level: health.level,
  });
}

export type SettleResult =
  | { ok: true; signature: string; updated: Task }
  | { ok: false; failure: Failure };

/**
 * Send the verdict on-chain and record it.
 *
 * `onFailure` is the one place the two callers differ, and on purpose:
 *
 *  - "hold": the AI judge's task is held for an OPERATIONAL reason, so it is not
 *    mistaken for a ruling and scripts/retry-stuck.ts picks it up. A retry re-runs the
 *    judge, which is the right remedy.
 *  - "leave": a reviewer's task is left exactly as it was. Marking it operational would
 *    let the retry script hand it back to the AI, and a task a PERSON was asked to
 *    decide could then be settled automatically. The reviewer simply submits again.
 *
 * Either way, if the failure was because the chain has ALREADY decided this task (a
 * concurrent ruling beat this one), the row is reconciled to the chain instead of being
 * marked held: recording a hold on a task that is settled would be a false statement.
 */
export async function settleVerdict(params: {
  task: Task;
  creator: PublicKey;
  approved: boolean;
  confidence: number;
  published: object;
  label: string;
  onFailure: "hold" | "leave";
}): Promise<SettleResult> {
  const { task, creator, approved, confidence, published, label, onFailure } = params;

  let signature: string;
  try {
    signature = await sendVerdict({
      creator,
      taskId: task.onchainTaskId,
      worker: new PublicKey(task.workerAddress as string),
      mint: new PublicKey(task.mint),
      approved,
      confidence,
      reasoningHash: hashVerdict(published),
    });
  } catch (error) {
    // Never leak the SDK error to the caller - it can contain RPC internals.
    console.error(`[${label}] submit_verdict failed:`, error);

    // Did something else already decide it?
    const now = await fetchTask(creator, task.onchainTaskId).catch(() => null);
    if (now && (now.state === "settled" || now.state === "refunded")) {
      await prisma.task.update({
        where: { id: task.id },
        data: { state: now.state === "settled" ? "SETTLED" : "REFUNDED" },
      });
      return fail(409, { error: "This task was decided on-chain by another action.", state: now.state });
    }

    if (onFailure === "hold") {
      // Say WHY when we can. An empty wallet, an untrusted key and a flaky RPC need
      // very different fixes, and the reader of the page is not the person who can
      // apply any of them. The health message holds amounts and PUBLIC keys only.
      const cause = await getVerifierHealth().catch(() => null);

      // Deliberately NOT stored: the verdict, its hash, its confidence, or a decision
      // time. A retry re-runs the judge and may rule differently, so showing this run's
      // verdict would display a ruling that may not survive - and "decided at" would
      // claim a decision that did not land.
      await prisma.task.update({
        where: { id: task.id },
        data: {
          state: "HELD",
          heldReason: operationalHold(
            "The judge ran, but the settlement transaction did not land, so nothing was decided on-chain. " +
              (cause && !cause.ok ? `Likely cause: ${cause.message} ` : "") +
              "This is not a ruling on the work: the escrow is untouched and judging can be run again."
          ),
        },
      });
      return fail(502, {
        error: "The verdict could not be settled on-chain. The task is held and will be retried.",
        code: "SETTLEMENT_FAILED",
      });
    }

    return fail(502, {
      error: "The ruling could not be settled on-chain, so nothing was recorded. The task is unchanged: submit it again.",
      code: "SETTLEMENT_FAILED",
    });
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      state: approved ? "SETTLED" : "REFUNDED",
      verdictJson: published as unknown as Prisma.InputJsonValue,
      verdictReasoningHash: hashVerdictHex(published),
      confidence,
      txSettle: signature,
      decidedAt: new Date(),
      heldReason: null,
    },
  });
  return { ok: true, signature, updated };
}
