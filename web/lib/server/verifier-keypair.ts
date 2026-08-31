/**
 * =============================================================================
 * THIS FILE LOADS THE PROTOCOL'S SINGLE MOST SENSITIVE SECRET.
 * =============================================================================
 *
 * `VERIFIER_SECRET_KEY` is the private key of the ONLY account the on-chain
 * program will accept a verdict from. Whoever holds it can approve or reject any
 * submitted task, which means they can move every escrowed bounty in the
 * protocol. There is no multisig, no timelock, and no second opinion.
 *
 * THIS IS THE MVP's CENTRALIZATION POINT, and it is stated plainly in the
 * README's "Known limitations". v2 replaces the single key with multi-agent
 * consensus; until then, the `MAX_BOUNTY` cap in the Rust program (50 USDC) is
 * what bounds the damage if this key leaks.
 *
 * Rules for this file:
 *   - It is imported ONLY from route handlers and other files under lib/server/.
 *   - It must NEVER be imported, directly or transitively, from a "use client"
 *     file or anything under app/ that renders in the browser.
 *   - The `server-only` guard below turns a mistake into a build error rather
 *     than a silently shipped private key.
 *   - No error message in this file ever includes the key material.
 */

import "server-only";

import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

let cached: Keypair | null = null;

/**
 * Load the verifier keypair from the environment.
 *
 * Accepts either a base58 secret key (what `solana-keygen` prints and what the
 * .env.example documents) or a JSON byte array (what `solana-keygen` writes to
 * a file), because operators reliably paste both.
 */
export function getVerifierKeypair(): Keypair {
  if (cached) return cached;

  const raw = process.env.VERIFIER_SECRET_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "VERIFIER_SECRET_KEY is not set. The verifier cannot sign verdicts without it."
    );
  }

  let secret: Uint8Array;
  try {
    const trimmed = raw.trim();
    secret = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed) as number[])
      : bs58.decode(trimmed);
  } catch {
    // Deliberately vague: never echo the value, not even a prefix of it.
    throw new Error(
      "VERIFIER_SECRET_KEY could not be decoded. Expected base58 or a JSON byte array."
    );
  }

  if (secret.length !== 64) {
    throw new Error(
      `VERIFIER_SECRET_KEY decoded to ${secret.length} bytes; a Solana secret key is 64.`
    );
  }

  cached = Keypair.fromSecretKey(secret);
  return cached;
}

/** The verifier's public key. Safe to log and safe to show in the UI. */
export function verifierPublicKey(): PublicKey {
  return getVerifierKeypair().publicKey;
}

/**
 * Assert that the loaded key is actually the one the on-chain program trusts.
 *
 * If these disagree, every verdict transaction will fail with
 * `NotVerifierAuthority` - but it will fail AFTER the judge has already run and
 * the user has been told their task is being decided. Better to detect it here
 * and say so loudly.
 *
 * Returns an object rather than throwing so a health-check route can report the
 * mismatch without taking the whole app down.
 */
export function checkVerifierMatchesConfig(onChainAuthority: PublicKey): {
  ok: boolean;
  message: string;
} {
  const local = verifierPublicKey();
  if (local.equals(onChainAuthority)) {
    return {
      ok: true,
      message: `Verifier authority matches on-chain config: ${local.toBase58()}`,
    };
  }

  const message =
    `VERIFIER AUTHORITY MISMATCH. The key in VERIFIER_SECRET_KEY is ` +
    `${local.toBase58()} but the on-chain config trusts ` +
    `${onChainAuthority.toBase58()}. No verdict this server signs will be ` +
    `accepted. Fix the env var, or run set_verifier_authority as the admin.`;

  // Loud, as specified. Public keys only - never the secret.
  console.error(`\n${"=".repeat(78)}\n${message}\n${"=".repeat(78)}\n`);
  return { ok: false, message };
}
