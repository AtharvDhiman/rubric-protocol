/**
 * Human review of a held task: what a reviewer submits, what they sign, and what gets
 * published. Pure, and shared by the client (to build the bytes the wallet signs) and
 * the server (to verify them) - one function, so the two cannot drift. Verification
 * of the signature itself is in lib/server/review-auth.ts.
 *
 * See docs/dispute-design.md for what this is and, as importantly, what it is not.
 *
 * THE REVIEWER MARKS CLAUSES; THE OUTCOME IS DERIVED.
 * ---------------------------------------------------
 * A reviewer is not given an "approve" or "reject" button. They rule on each sealed
 * clause - pass or fail, with a reason - and the outcome follows: approved only if
 * every clause passed. That is the same rule the AI is held to, and it is the only
 * way a person can be stopped from approving a task with a failing clause, or from
 * rejecting one without saying which clause failed. Every rejection cites a sealed
 * clause because it cannot be expressed any other way.
 */

import { normalizeText, sha256Bytes, stableStringify, toHex } from "./hash";

export const MAX_REASON_LENGTH = 400;
export const MAX_SUMMARY_LENGTH = 600;

/**
 * The confidence recorded on a human ruling. A person is not a model with an
 * uncertainty to report: they rule, or they do not. 100 also keeps the existing screens
 * (which print a confidence) coherent. The page labels the ruling as human, so this is
 * never mistaken for a measurement.
 */
export const REVIEW_CONFIDENCE = 100;

export interface ReviewClause {
  index: number;
  passed: boolean;
  reason: string;
}

export interface ReviewDecision {
  clauses: ReviewClause[];
  summary: string;
}

/** base58 ed25519 signature over `reviewAuthMessage(...)`, and when it was made. */
export interface ReviewProof {
  signature: string;
  issuedAt: string;
}

export type DecisionResult =
  | { ok: true; value: ReviewDecision }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate and NORMALISE a ruling. The normalised form is what gets hashed, signed and
 * published, so the client and the server must both run this and get the same bytes:
 * the reviewer's browser calls it before signing, and the server calls it on what
 * arrives.
 */
export function validateDecision(raw: unknown, clauseCount: number): DecisionResult {
  if (!isRecord(raw)) return { ok: false, error: "The ruling is missing." };

  const clauses = raw.clauses;
  if (!Array.isArray(clauses) || clauses.length !== clauseCount) {
    return { ok: false, error: `Rule on every clause: expected ${clauseCount} rulings.` };
  }

  const seen = new Set<number>();
  const out: ReviewClause[] = [];
  for (const c of clauses) {
    if (
      !isRecord(c) ||
      typeof c.index !== "number" ||
      !Number.isInteger(c.index) ||
      typeof c.passed !== "boolean" ||
      typeof c.reason !== "string"
    ) {
      return { ok: false, error: "Each clause ruling needs an index, a pass or fail, and a reason." };
    }
    if (c.index < 0 || c.index >= clauseCount || seen.has(c.index)) {
      return { ok: false, error: "The clause rulings must cover each clause exactly once." };
    }
    seen.add(c.index);

    const reason = normalizeText(c.reason);
    if (reason.length === 0) {
      return { ok: false, error: `Clause ${c.index + 1} needs a reason. Rulings are public.` };
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return { ok: false, error: `The reason for clause ${c.index + 1} is over ${MAX_REASON_LENGTH} characters.` };
    }
    out.push({ index: c.index, passed: c.passed, reason });
  }

  if (typeof raw.summary !== "string") return { ok: false, error: "The ruling needs a summary." };
  const summary = normalizeText(raw.summary);
  if (summary.length === 0) return { ok: false, error: "The ruling needs a summary." };
  if (summary.length > MAX_SUMMARY_LENGTH) {
    return { ok: false, error: `The summary is over ${MAX_SUMMARY_LENGTH} characters.` };
  }

  out.sort((a, b) => a.index - b.index);
  return { ok: true, value: { clauses: out, summary } };
}

/** Approved only if every clause passed. Never chosen by the reviewer. */
export function decisionApproves(decision: ReviewDecision): boolean {
  return decision.clauses.every((c) => c.passed);
}

/**
 * A hash of exactly this ruling, which the reviewer's signature binds. Without it a
 * signature captured for one ruling could be replayed to authorise a different one.
 */
export function decisionHash(decision: ReviewDecision): string {
  return toHex(sha256Bytes(`{"v":1,"review":${stableStringify(decision)}}`));
}

/**
 * The exact bytes the reviewer signs. Written to be readable in a wallet's signing
 * dialog: a person approving it should be able to see that it will release or refund
 * real escrow, and that it is public.
 */
export function reviewAuthMessage(params: {
  taskId: string;
  reviewerAddress: string;
  decisionHash: string;
  issuedAt: string;
}): string {
  return [
    "Rubric: authorise a human ruling",
    "",
    "This signs a ruling onto a held task. It moves no funds from your wallet,",
    "but the ruling will release or refund the escrowed bounty, and it is public",
    "and names you.",
    "",
    `Task:         ${params.taskId}`,
    `Reviewer:     ${params.reviewerAddress}`,
    `Ruling hash:  ${params.decisionHash}`,
    `Issued:       ${params.issuedAt}`,
  ].join("\n");
}

// --- Who may review ---------------------------------------------------------------------

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface Reviewers {
  /** Valid, de-duplicated addresses. Empty means review is OFF. */
  addresses: string[];
  /** Entries that were not valid addresses, for the operator's log. Never silently trusted. */
  invalid: string[];
}

/**
 * Parse REVIEWER_ADDRESSES (comma or whitespace separated). It fails CLOSED: an entry
 * that is not a valid address is reported and ignored, never guessed at, so a typo can
 * only ever remove a reviewer, not add one.
 */
export function parseReviewers(raw: string | undefined): Reviewers {
  const entries = (raw ?? "").split(/[\s,]+/).filter((e) => e.length > 0);
  const addresses: string[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    if (!BASE58_KEY.test(entry)) invalid.push(entry);
    else if (!addresses.includes(entry)) addresses.push(entry);
  }
  return { addresses, invalid };
}

export const isReviewer = (address: string, reviewers: Reviewers): boolean =>
  reviewers.addresses.includes(address);

// --- What gets published ----------------------------------------------------------------

const HUMAN_PREFIX = "human:";

/** The `model` a human ruling is published under. It names the reviewer. */
export const reviewerModel = (address: string): string => `${HUMAN_PREFIX}${address}`;

/** The reviewer's address if this verdict's `model` marks a human ruling, else null. */
export function reviewerOfModel(model: unknown): string | null {
  return typeof model === "string" && model.startsWith(HUMAN_PREFIX) && model.length > HUMAN_PREFIX.length
    ? model.slice(HUMAN_PREFIX.length)
    : null;
}

/**
 * The published verdict, in exactly the shape the AI's has, so it hashes and renders
 * the same way. `outcome` comes from the caller (it went through the same guards the
 * AI's does), not from the reviewer.
 */
export function buildReviewedVerdict(params: {
  decision: ReviewDecision;
  outcome: "approved" | "rejected";
  reviewerAddress: string;
  rubricTitle: string;
  clauseCount: number;
}) {
  return {
    outcome: params.outcome,
    approved: params.outcome === "approved",
    confidence: REVIEW_CONFIDENCE,
    clauses: params.decision.clauses,
    summary: params.decision.summary,
    model: reviewerModel(params.reviewerAddress),
    rubricTitle: params.rubricTitle,
    clauseCount: params.clauseCount,
  };
}
