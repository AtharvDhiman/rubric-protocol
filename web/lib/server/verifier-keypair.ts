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
 * consensus; until then it is managed, not removed.
 *
 * What bounds the damage if it leaks, honestly stated: the bounty cap limits what
 * ONE task can lose, but anyone may claim any open task, so a leaked key can reach
 * the cap times the number of open tasks - the cap is a launch-caution dial, not a
 * guarantee (docs/security-review.md, R-02). What actually limits the damage is
 * speed: `set_verifier_authority` cuts a leaked key off in one transaction, and
 * docs/verifier-runbook.md is the plan for doing that quickly.
 *
 * TWO KEYS, FOR ROTATION. `VERIFIER_SECRET_KEY_NEXT` is optional. When set, the
 * app signs with whichever configured key the chain currently trusts, so a
 * rotation has no window in which every verdict bounces. See lib/verifier-keys.ts.
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
import {
  checkSigner,
  configuredKeys,
  selectByAuthority,
  type ConfiguredKeys,
  type SignerCheck,
} from "../verifier-keys";

let cached: ConfiguredKeys | null = null;

/**
 * The keys this server holds, read from the environment once.
 *
 * Throws if VERIFIER_SECRET_KEY is missing or unusable - without it nothing can
 * sign. A bad VERIFIER_SECRET_KEY_NEXT is NOT thrown (it would stop the current
 * key signing); it is surfaced by `verifierNextKeyError` and the health check.
 */
export function getConfiguredKeys(): ConfiguredKeys {
  if (cached) return cached;
  cached = configuredKeys(
    process.env.VERIFIER_SECRET_KEY,
    process.env.VERIFIER_SECRET_KEY_NEXT
  );
  return cached;
}

/**
 * The CURRENT verifier keypair (VERIFIER_SECRET_KEY).
 *
 * Kept for callers that only need an identity. Anything that SIGNS a verdict
 * should use `selectVerifierKeypair`, which follows the chain through a rotation.
 */
export function getVerifierKeypair(): Keypair {
  return getConfiguredKeys().keys[0].keypair;
}

/** The current verifier's public key. Safe to log and safe to show in the UI. */
export function verifierPublicKey(): PublicKey {
  return getVerifierKeypair().publicKey;
}

/**
 * The configured key that the on-chain config currently trusts, or null if none of
 * them is. This is the key a verdict must be signed with.
 */
export function selectVerifierKeypair(onChainAuthority: PublicKey): Keypair | null {
  return selectByAuthority(getConfiguredKeys().keys, onChainAuthority)?.keypair ?? null;
}

/** Why VERIFIER_SECRET_KEY_NEXT is unusable, if it is set and unusable. */
export function verifierNextKeyError(): string | null {
  return getConfiguredKeys().nextError;
}

/**
 * Assert that a configured key is actually the one the on-chain program trusts.
 *
 * If none is, every verdict transaction will fail with `NotVerifierAuthority` - but
 * it will fail AFTER the judge has already run and the user has been told their
 * task is being decided. Better to detect it here and say so loudly.
 *
 * Returns an object rather than throwing so a health-check route can report the
 * mismatch without taking the whole app down.
 */
export function checkVerifierMatchesConfig(onChainAuthority: PublicKey): SignerCheck {
  const check = checkSigner(getConfiguredKeys(), onChainAuthority);
  if (!check.ok) {
    // Loud, as specified. Public keys only - never the secret.
    console.error(`\n${"=".repeat(78)}\n${check.message}\n${"=".repeat(78)}\n`);
  }
  return check;
}
