import "server-only";

import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import { MAX_CLOCK_SKEW_MS } from "@/lib/worker-auth";
import { reviewAuthMessage, type ReviewProof } from "@/lib/review";

/**
 * Proof that a ruling really comes from the reviewer's wallet.
 *
 * It mirrors lib/server/worker-auth.ts, deliberately and with the same three binding
 * properties, because each one is a real attack if dropped:
 *
 *   - It binds the RULING, via its hash. Otherwise a signature captured for one ruling
 *     could be replayed to authorise a different one - approving a task the reviewer
 *     rejected.
 *   - It binds the TASK. Otherwise a ruling signed for one task could be replayed
 *     against another.
 *   - It binds a TIMESTAMP, checked in both directions against a short window.
 *     Otherwise a leaked request is valid forever.
 *
 * This is AUTHENTICATION. Whether that wallet is a reviewer at all is a separate
 * question (lib/review.ts, parseReviewers), and the order the route asks them in
 * matters: a non-reviewer is refused before any signature work.
 *
 * Nothing here signs a transaction. The reviewer's signature authenticates the
 * request; the VERIFIER key signs the on-chain verdict. See docs/dispute-design.md.
 */

export type ReviewAuthResult =
  | { ok: true }
  | { ok: false; reason: string; status: 400 | 401 };

export function verifyReviewProof(params: {
  taskId: string;
  reviewerAddress: string;
  decisionHash: string;
  proof: ReviewProof | undefined;
  /** Injectable so tests do not depend on the wall clock. */
  now?: number;
}): ReviewAuthResult {
  const { taskId, reviewerAddress, decisionHash, proof } = params;
  const now = params.now ?? Date.now();

  if (!proof || typeof proof.signature !== "string" || typeof proof.issuedAt !== "string") {
    return { ok: false, reason: "This ruling is not signed.", status: 401 };
  }

  const issued = Date.parse(proof.issuedAt);
  if (!Number.isFinite(issued)) {
    return { ok: false, reason: "The signature's timestamp is not a valid date.", status: 400 };
  }
  // Bounded in BOTH directions. A future-dated signature is as suspect as a stale one:
  // allowing it would hand an attacker a signature good for as far ahead as they dated it.
  if (Math.abs(now - issued) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: "The signature has expired. Sign and submit again.", status: 401 };
  }

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(reviewerAddress);
  } catch {
    return { ok: false, reason: "That is not a valid wallet address.", status: 400 };
  }

  let signature: Uint8Array;
  try {
    signature = bs58.decode(proof.signature);
  } catch {
    return { ok: false, reason: "The signature is not valid base58.", status: 400 };
  }
  if (signature.length !== 64) {
    return { ok: false, reason: "The signature is the wrong length.", status: 400 };
  }

  const message = new TextEncoder().encode(
    reviewAuthMessage({ taskId, reviewerAddress, decisionHash, issuedAt: proof.issuedAt })
  );

  let valid = false;
  try {
    valid = ed25519.verify(signature, message, publicKey.toBytes());
  } catch {
    // A malformed point throws rather than returning false. Same outcome.
    valid = false;
  }
  if (!valid) {
    return {
      ok: false,
      reason: "That signature does not match the wallet it claims to be from.",
      status: 401,
    };
  }
  return { ok: true };
}
