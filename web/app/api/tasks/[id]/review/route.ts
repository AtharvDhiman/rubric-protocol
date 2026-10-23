/**
 * POST /api/tasks/[id]/review - a human reviewer rules on a HELD task.
 *
 * SERVER ONLY, and it settles real escrow: it signs the on-chain verdict with the
 * VERIFIER key, exactly as the AI route does. The reviewer's wallet authenticates the
 * request; it does not sign the verdict. So a reviewer is an off-chain role the operator
 * grants, as trusted as the verifier. See docs/dispute-design.md - this is operational
 * dispute handling for a single-verifier MVP, not decentralisation.
 *
 * The order is deliberate. Each step refuses before the next, more expensive or more
 * dangerous one:
 *
 *   1. Review is enabled at all (REVIEWER_ADDRESSES is set).
 *   2. The caller names a wallet on the allowlist. Checked BEFORE any signature work.
 *   3. The ruling is complete: a pass or fail and a reason for EVERY clause. The outcome
 *      is not an input; it is derived from the clauses.
 *   4. The signature is valid, fresh, and binds this task, this reviewer and this exact
 *      ruling. Authentication comes BEFORE any chain read, so an unauthenticated caller
 *      cannot make the server spend RPC calls or touch the database.
 *   5. The reviewer is not the poster or the worker.
 *   6. prepareRuling: the task is HELD, the chain agrees it is still Submitted, and the
 *      stored clauses and submission are the sealed ones. The same checks as the AI.
 *   7. The outcome goes through the same guards the AI's does.
 *   8. The verifier can settle (cheap), then settle. A failure here leaves the task
 *      exactly as it was; see settleVerdict.
 */

import { NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WRITE_MESSAGE } from "@/lib/demo";
import { prisma, serializeBigInts } from "@/lib/db";
import { applyVerdictGuards } from "@/lib/verifier";
import {
  REVIEW_CONFIDENCE,
  buildReviewedVerdict,
  decisionApproves,
  decisionHash,
  isReviewer,
  parseReviewers,
  validateDecision,
} from "@/lib/review";
import { verifyReviewProof } from "@/lib/server/review-auth";
import {
  prepareRuling,
  settleVerdict,
  verifierCanSettle,
  type Failure,
} from "@/lib/server/judging";

export const runtime = "nodejs";
export const maxDuration = 60;

const respond = (failure: Failure) =>
  NextResponse.json(failure.body, { status: failure.status });

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (DEMO_MODE) return json({ error: DEMO_WRITE_MESSAGE }, 503);

  // --- 1. Is review on at all? ---------------------------------------------------
  const reviewers = parseReviewers(process.env.REVIEWER_ADDRESSES);
  if (reviewers.invalid.length > 0) {
    // Counts only. A bad entry can only ever REMOVE a reviewer (parseReviewers fails
    // closed), but the operator should know their list is not what they typed.
    console.error(`[review] ignoring ${reviewers.invalid.length} invalid entr(y/ies) in REVIEWER_ADDRESSES.`);
  }
  if (reviewers.addresses.length === 0) {
    return json({ error: "Human review is not enabled on this deployment.", code: "REVIEW_DISABLED" }, 404);
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request body is not valid JSON." }, 400);
  }
  const { reviewerAddress, decision, proof } =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  // --- 2. Is the claimed wallet a reviewer? Before any signature work. -----------
  if (typeof reviewerAddress !== "string" || !isReviewer(reviewerAddress, reviewers)) {
    return json({ error: "That wallet is not a reviewer.", code: "NOT_A_REVIEWER" }, 403);
  }

  // --- 3. Is the ruling complete? ------------------------------------------------
  const known = await prisma.task.findUnique({
    where: { id },
    select: { clauses: true, state: true, creatorAddress: true, workerAddress: true },
  });
  if (!known || known.state === "PENDING") return json({ error: "Task not found." }, 404);

  const parsed = validateDecision(decision, known.clauses.length);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const ruling = parsed.value;

  // --- 4. Does the signature bind THIS task, THIS reviewer and THIS ruling? ------
  const auth = verifyReviewProof({
    taskId: id,
    reviewerAddress,
    decisionHash: decisionHash(ruling),
    proof: proof as never,
  });
  if (!auth.ok) return json({ error: auth.reason }, auth.status);

  // --- 5. Not your own task. -----------------------------------------------------
  // Cheap, and it stops the accidental and the lazy case. It does not stop a reviewer
  // using a second wallet, and is not claimed to: the allowlist is the real control.
  if (reviewerAddress === known.creatorAddress || reviewerAddress === known.workerAddress) {
    return json(
      { error: "A reviewer cannot rule on a task they posted or worked on.", code: "CONFLICT_OF_INTEREST" },
      403
    );
  }

  // --- 6. May this task be ruled on? The same checks as the AI. ------------------
  const prepared = await prepareRuling(id, { label: "review", onlyState: "HELD" });
  if (!prepared.ok) return respond(prepared.failure);
  const { task, creator } = prepared.ready;

  // --- 7. The outcome is derived, then goes through the AI's own guards. ---------
  const approved = decisionApproves(ruling);
  const { outcome, heldReason } = applyVerdictGuards(
    { approved, confidence: REVIEW_CONFIDENCE, summary: ruling.summary, clauses: ruling.clauses },
    task.clauses.length,
    0 // A human has no confidence to gate; the other guards still apply.
  );
  if (outcome === "needs_manual_review") {
    // Validation should make this unreachable. If it is reached anyway, refuse rather
    // than settle on a ruling the guards would not let the AI make.
    return json({ error: heldReason ?? "That ruling cannot be settled." }, 400);
  }

  // --- 8. Settle. ----------------------------------------------------------------
  const preflight = await verifierCanSettle("review", task.id);
  if (!preflight.ok) return respond(preflight.failure);

  const published = buildReviewedVerdict({
    decision: ruling,
    outcome,
    reviewerAddress,
    rubricTitle: task.title,
    clauseCount: task.clauses.length,
  });

  const settled = await settleVerdict({
    task,
    creator,
    approved: outcome === "approved",
    confidence: REVIEW_CONFIDENCE,
    published,
    label: "review",
    // Leave the task as it was: marking it operational would let the retry script hand
    // a task a PERSON was asked to decide back to the AI.
    onFailure: "leave",
  });
  if (!settled.ok) return respond(settled.failure);

  return NextResponse.json(
    serializeBigInts({
      outcome,
      approved: outcome === "approved",
      signature: settled.signature,
      state: settled.updated.state,
      verdict: published,
    })
  );
}
