/**
 * Fixtures for testing the money-moving routes with the database and the chain mocked.
 *
 * Not a test file (vitest only collects *.test.ts), so the `vi.mock` calls stay in each
 * test, where they are hoisted. This only builds data: a task row, the matching
 * on-chain state, and a genuinely signed reviewer request.
 */

import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { hashRubricHex, hashSubmissionHex } from "../hash";
import { decisionHash, reviewAuthMessage, validateDecision, type ReviewDecision } from "../review";

export const CLAUSES = ["The submission mentions blue.", "The submission mentions green."];
export const TITLE = "Two clauses";
export const CONTENT = "blue and green";

export const keys = {
  creator: Keypair.generate().publicKey.toBase58(),
  worker: Keypair.generate().publicKey.toBase58(),
  mint: Keypair.generate().publicKey.toBase58(),
};

/** A task row as Prisma returns it. Override any field. */
export function makeTask(over: Record<string, unknown> = {}) {
  return {
    id: "task1",
    onchainTaskId: 7n,
    creatorAddress: keys.creator,
    workerAddress: keys.worker,
    title: TITLE,
    clauses: CLAUSES,
    rubricHash: hashRubricHex({ title: TITLE, clauses: CLAUSES }),
    bountyAmount: 5_000_000n,
    mint: keys.mint,
    deadline: new Date("2026-10-30T00:00:00Z"),
    category: "Content",
    state: "HELD",
    txCreate: "c",
    txSubmit: "s",
    txSettle: null,
    submissionContent: CONTENT,
    submissionHash: hashSubmissionHex(CONTENT),
    submittedAt: new Date("2026-10-23T00:00:00Z"),
    verdictJson: null,
    verdictReasoningHash: null,
    confidence: null,
    heldReason: "Confidence 54 is below the 70 threshold required to settle automatically.",
    decidedAt: null,
    createdAt: new Date("2026-10-22T00:00:00Z"),
    updatedAt: new Date("2026-10-23T00:00:00Z"),
    ...over,
  };
}

/** What the chain says about the same task. */
export function makeOnChain(over: Record<string, unknown> = {}) {
  return {
    rubricHashHex: hashRubricHex({ title: TITLE, clauses: CLAUSES }),
    submissionHashHex: hashSubmissionHex(CONTENT),
    state: "submitted",
    ...over,
  };
}

export const passing = (): ReviewDecision => ({
  clauses: [
    { index: 0, passed: true, reason: "It says blue." },
    { index: 1, passed: true, reason: "It says green." },
  ],
  summary: "Both clauses are satisfied.",
});

export const failing = (): ReviewDecision => ({
  clauses: [
    { index: 0, passed: true, reason: "It says blue." },
    { index: 1, passed: false, reason: "No mention of green." },
  ],
  summary: "One clause missed.",
});

/** A reviewer with a real keypair. */
export function makeReviewer() {
  const keypair = Keypair.generate();
  return { keypair, address: keypair.publicKey.toBase58() };
}

/** Sign a ruling as a reviewer would, binding the task, the reviewer and the ruling. */
export function signRuling(
  reviewer: { keypair: Keypair; address: string },
  taskId: string,
  decision: ReviewDecision,
  issuedAt = new Date().toISOString()
) {
  const parsed = validateDecision(decision, CLAUSES.length);
  if (!parsed.ok) throw new Error(parsed.error);
  const message = new TextEncoder().encode(
    reviewAuthMessage({
      taskId,
      reviewerAddress: reviewer.address,
      decisionHash: decisionHash(parsed.value),
      issuedAt,
    })
  );
  const signature = ed25519.sign(message, reviewer.keypair.secretKey.slice(0, 32));
  return { signature: bs58.encode(signature), issuedAt };
}

export function postRequest(body: unknown, path = "/api/tasks/task1/review") {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const ctx = (id = "task1") => ({ params: Promise.resolve({ id }) });
