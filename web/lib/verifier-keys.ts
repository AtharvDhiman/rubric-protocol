/**
 * Decoding and selecting verifier keys. Pure: it takes strings and returns keys,
 * and never reads the environment or touches the network.
 *
 * WHY MORE THAN ONE KEY
 * ---------------------
 * The program trusts exactly one verifier key at a time, and the admin changes it
 * with `set_verifier_authority`. The app, until now, held exactly one key too. So
 * a rotation had a window by construction: rotate on-chain first and the app is
 * signing with a key the program no longer trusts; rotate the app first and it
 * signs with a key the program does not trust YET. Either way every verdict in
 * between bounces, and those tasks come back held, in an incident - the one time
 * nobody wants an extra source of failures.
 *
 * With a second key configured as VERIFIER_SECRET_KEY_NEXT the app signs with
 * WHICHEVER configured key the chain currently trusts, chosen at the moment of
 * signing. Rotation becomes: add the next key and redeploy (nothing changes, the
 * current key still matches); the admin rotates on-chain (the app switches by
 * itself, on the next verdict); then retire the old key. There is no window.
 *
 * Selecting by the chain's answer is safe by construction: the program rejects
 * any signature that is not the trusted key, so a wrong choice costs a failed
 * transaction and nothing else.
 *
 * This file handles secrets, so the rule is absolute: NO ERROR MESSAGE CONTAINS
 * ANY PART OF THE INPUT. Tests enforce it.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Decode a secret key written as base58 (what most tools print) or as a JSON byte
 * array (what `solana-keygen` writes to a file) - operators reliably paste both.
 *
 * `name` is the NAME of the variable, used only to tell the operator which one is
 * wrong. The value is never echoed, not even its length unless it decoded.
 */
export function decodeSecretKey(raw: string, name: string): Uint8Array {
  let secret: Uint8Array;
  try {
    const trimmed = raw.trim();
    secret = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed) as number[])
      : bs58.decode(trimmed);
  } catch {
    // Deliberately vague: never echo the value, not even a prefix of it.
    throw new Error(`${name} could not be decoded. Expected base58 or a JSON byte array.`);
  }
  if (secret.length !== 64) {
    throw new Error(`${name} decoded to ${secret.length} bytes; a Solana secret key is 64.`);
  }
  return secret;
}

export function keypairFromSecret(raw: string, name: string): Keypair {
  try {
    return Keypair.fromSecretKey(decodeSecretKey(raw, name));
  } catch (error) {
    // fromSecretKey throws if the public half does not match the secret half. Its
    // message could in principle include key material, so replace it.
    if (error instanceof Error && error.message.startsWith(name)) throw error;
    throw new Error(`${name} is not a valid Solana keypair.`);
  }
}

/** A configured key and the variable it came from. */
export interface LabelledKey {
  label: string;
  keypair: Keypair;
}

export interface ConfiguredKeys {
  keys: LabelledKey[];
  /**
   * Set when VERIFIER_SECRET_KEY_NEXT is present but unusable. Not thrown, because
   * that would stop the CURRENT key signing - but it must not be silent either: a
   * rotation planned around a key the app cannot load fails at the worst moment.
   * The health check reports it.
   */
  nextError: string | null;
}

/**
 * Build the list of usable keys from the two environment values.
 *
 * VERIFIER_SECRET_KEY is required and its failure is thrown: without it nothing
 * can sign. VERIFIER_SECRET_KEY_NEXT is optional and its failure is reported.
 * Duplicates (the same key in both) are collapsed.
 */
export function configuredKeys(current: string | undefined, next: string | undefined): ConfiguredKeys {
  if (!current || current.trim().length === 0) {
    throw new Error("VERIFIER_SECRET_KEY is not set. The verifier cannot sign verdicts without it.");
  }
  const keys: LabelledKey[] = [
    { label: "VERIFIER_SECRET_KEY", keypair: keypairFromSecret(current, "VERIFIER_SECRET_KEY") },
  ];
  let nextError: string | null = null;
  if (next && next.trim().length > 0) {
    try {
      const keypair = keypairFromSecret(next, "VERIFIER_SECRET_KEY_NEXT");
      if (!keys.some((k) => k.keypair.publicKey.equals(keypair.publicKey))) {
        keys.push({ label: "VERIFIER_SECRET_KEY_NEXT", keypair });
      }
    } catch (error) {
      nextError = error instanceof Error ? error.message : "VERIFIER_SECRET_KEY_NEXT is unusable.";
    }
  }
  return { keys, nextError };
}

/** The configured key the chain currently trusts, or null if none of them is. */
export function selectByAuthority(keys: LabelledKey[], authority: PublicKey): LabelledKey | null {
  return keys.find((k) => k.keypair.publicKey.equals(authority)) ?? null;
}

export interface SignerCheck {
  ok: boolean;
  /** Which variable holds the key that will sign, when ok. */
  activeLabel: string | null;
  /** Public keys only - never any secret material. Safe to log and to return. */
  message: string;
}

/**
 * Does any configured key match the chain, and which one will sign?
 *
 * The message lists PUBLIC keys on both sides, because a mismatch is fixed by
 * comparing them.
 */
export function checkSigner(configured: ConfiguredKeys, authority: PublicKey): SignerCheck {
  const chosen = selectByAuthority(configured.keys, authority);
  if (chosen) {
    const promote =
      chosen.label === "VERIFIER_SECRET_KEY_NEXT"
        ? " The NEXT key is now the active one: move it into VERIFIER_SECRET_KEY and remove the old key."
        : "";
    return {
      ok: true,
      activeLabel: chosen.label,
      message: `Verifier authority matches on-chain config: ${authority.toBase58()} (${chosen.label}).${promote}`,
    };
  }
  const held = configured.keys.map((k) => `${k.label}=${k.keypair.publicKey.toBase58()}`).join(", ");
  return {
    ok: false,
    activeLabel: null,
    message:
      `VERIFIER AUTHORITY MISMATCH. The on-chain config trusts ${authority.toBase58()} but ` +
      `this server holds [${held}]. No verdict it signs will be accepted. Fix the env var, ` +
      `or run set_verifier_authority as the admin.`,
  };
}
