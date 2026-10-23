/**
 * Gather the facts `evaluateVerifierHealth` needs. Server-only: it reads the key
 * environment and the chain.
 *
 * The judgement itself is pure and lives in lib/verifier-health.ts, so every
 * threshold is unit-tested; this file only does I/O.
 *
 * FAILURE REASONS ARE FIXED STRINGS, NEVER THE RAW ERROR. An RPC error can include
 * the RPC URL, and RPC URLs routinely carry an API key in the path or query. The
 * raw error goes to the server log; the caller gets a sentence.
 */

import "server-only";

import { PublicKey } from "@solana/web3.js";
import { checkSigner } from "../verifier-keys";
import {
  evaluateVerifierHealth,
  misconfiguredReport,
  unreadableReport,
  warnLamportsFromEnv,
  type HealthReport,
} from "../verifier-health";
import { fetchConfig, serverConnection } from "./program";
import { getConfiguredKeys } from "./verifier-keypair";

export interface VerifierHealth extends HealthReport {
  /** The public key being watched: the one that will sign, else the current key. */
  verifier: string | null;
  /** Which variable holds it. */
  activeKey: string | null;
  checkedAt: string;
}

const stamp = (report: HealthReport, extra: Partial<VerifierHealth> = {}): VerifierHealth => ({
  ...report,
  verifier: null,
  activeKey: null,
  checkedAt: new Date().toISOString(),
  ...extra,
});

export async function getVerifierHealth(): Promise<VerifierHealth> {
  // ---- Is there a key at all? ----------------------------------------------
  let configured;
  try {
    configured = getConfiguredKeys();
  } catch (error) {
    // This message names the variable and is safe: it never contains the value.
    return stamp(misconfiguredReport(error instanceof Error ? error.message : "The verifier key is not configured."));
  }

  // ---- What does the chain trust, and what does the wallet hold? ----------
  try {
    const connection = serverConnection();
    const config = await fetchConfig();
    const check = checkSigner(configured, config.verifierAuthority);

    const watched: PublicKey = check.ok
      ? configured.keys.find((k) => k.keypair.publicKey.equals(config.verifierAuthority))!.keypair.publicKey
      : configured.keys[0].keypair.publicKey;

    const [balanceLamports, rentFloorLamports, tokenAccountRentLamports] = await Promise.all([
      connection.getBalance(watched),
      connection.getMinimumBalanceForRentExemption(0),
      connection.getMinimumBalanceForRentExemption(165),
    ]);

    const report = evaluateVerifierHealth({
      balanceLamports,
      rentFloorLamports,
      tokenAccountRentLamports,
      warnLamports: warnLamportsFromEnv(process.env.VERIFIER_MIN_SOL_WARN),
      signerMatchesChain: check.ok,
      nextKeyError: configured.nextError,
    });
    return stamp(report, {
      verifier: watched.toBase58(),
      activeKey: check.activeLabel,
    });
  } catch (error) {
    console.error("[verifier-health] could not read the chain:", error);
    return stamp(unreadableReport("could not reach the RPC"), {
      verifier: configured.keys[0].keypair.publicKey.toBase58(),
    });
  }
}
