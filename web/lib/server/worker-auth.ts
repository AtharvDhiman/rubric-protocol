import "server-only";

import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import {
  MAX_CLOCK_SKEW_MS,
  workerAuthMessage,
  type WorkerProof,
} from "@/lib/worker-auth";

/**
 * Proof that whoever posted a submission actually holds the worker's wallet.
 *
 * Without this, `workerAddress` is just a string in a request body. Anyone could
 * post as anyone, and while that cannot redirect a bounty - `submit_work` is
 * signed by the worker's own key and the escrow pays whoever the CHAIN records -
 * it lets a stranger overwrite an honest worker's staged submission, so the hash
 * they go on to sign no longer matches what is stored and their task is held.
 *
 * The fix is an ed25519 signature over a message that names exactly what is
 * being authorised. Three properties matter, and each one is a real attack if
 * you drop it:
 *
 *   - It binds the CONTENT, via its hash. Otherwise a signature captured for one
 *     submission could be replayed to authorise a different one.
 *   - It binds the TASK. Otherwise a signature for a cheap task could be
 *     replayed against an expensive one.
 *   - It binds a TIMESTAMP, checked against a short window. Otherwise a
 *     signature is valid forever, and one leaked request authorises overwrites
 *     for the life of the task.
 *
 * This is authentication, not authorisation to move money. Nothing here signs a
 * transaction; the wallet still signs `submit_work` itself.
 */

export type WorkerAuthResult =
  | { ok: true }
  | { ok: false; reason: string; status: 400 | 401 };

/**
 * Verify a worker's proof. Returns a reason rather than throwing, because the
 * caller has to turn every outcome into an HTTP response anyway.
 */
export function verifyWorkerProof(params: {
  taskId: string;
  workerAddress: string;
  submissionHash: string;
  proof: WorkerProof | undefined;
  /** Injectable so tests do not depend on the wall clock. */
  now?: number;
}): WorkerAuthResult {
  const { taskId, workerAddress, submissionHash, proof } = params;
  const now = params.now ?? Date.now();

  if (!proof || typeof proof.signature !== "string" || typeof proof.issuedAt !== "string") {
    return { ok: false, reason: "This submission is not signed.", status: 401 };
  }

  const issued = Date.parse(proof.issuedAt);
  if (!Number.isFinite(issued)) {
    return { ok: false, reason: "The signature's timestamp is not a valid date.", status: 400 };
  }
  // Bounded in BOTH directions. A future-dated signature is as suspect as a
  // stale one, and allowing it would hand an attacker a signature good for as
  // far ahead as they cared to date it.
  if (Math.abs(now - issued) > MAX_CLOCK_SKEW_MS) {
    return {
      ok: false,
      reason: "The signature has expired. Sign and submit again.",
      status: 401,
    };
  }

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(workerAddress);
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
    workerAuthMessage({ taskId, workerAddress, submissionHash, issuedAt: proof.issuedAt })
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
