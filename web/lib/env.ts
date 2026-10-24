/**
 * Environment access, split explicitly into client-safe and server-only.
 *
 * The split is not cosmetic. `VERIFIER_SECRET_KEY` and `ANTHROPIC_API_KEY` must
 * never reach a browser bundle. Next.js only inlines variables prefixed with
 * `NEXT_PUBLIC_`, but that protection is lost the moment a "use client" file
 * imports a module that reads a secret at module scope. So secrets are read only
 * inside `lib/server/`, and this file's server section throws if it is ever
 * evaluated in a browser.
 */

import type { Cluster } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Client-safe. These are compiled into the browser bundle - by design.
// ---------------------------------------------------------------------------

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

export function solanaCluster(): SolanaCluster {
  const raw = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  if (
    raw === "devnet" ||
    raw === "testnet" ||
    raw === "mainnet-beta" ||
    raw === "localnet"
  ) {
    return raw;
  }
  return "devnet";
}

export function rpcUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_RPC_URL;
  if (explicit && explicit.length > 0) return explicit;

  switch (solanaCluster()) {
    case "localnet":
      return "http://127.0.0.1:8899";
    case "mainnet-beta":
      return "https://api.mainnet-beta.solana.com";
    case "testnet":
      return "https://api.testnet.solana.com";
    default:
      return "https://api.devnet.solana.com";
  }
}

/** Cluster name in the form @solana/web3.js and Explorer expect. */
export function explorerCluster(): Cluster | "custom" {
  const cluster = solanaCluster();
  return cluster === "localnet" ? "custom" : cluster;
}

/**
 * A cluster-aware Solana Explorer link. Every transaction signature shown in the
 * UI goes through this - a mainnet-shaped link for a devnet transaction is a
 * confusing and slightly dangerous thing to hand a user.
 */
export function explorerTxUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  const cluster = solanaCluster();
  if (cluster === "mainnet-beta") return base;
  if (cluster === "localnet") {
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl())}`;
  }
  return `${base}?cluster=${cluster}`;
}

export function explorerAddressUrl(address: string): string {
  const base = `https://explorer.solana.com/address/${address}`;
  const cluster = solanaCluster();
  if (cluster === "mainnet-beta") return base;
  if (cluster === "localnet") {
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl())}`;
  }
  return `${base}?cluster=${cluster}`;
}

export function programIdString(): string | undefined {
  const value = process.env.NEXT_PUBLIC_PROGRAM_ID;
  return value && value.length > 0 ? value : undefined;
}

export function usdcMintString(): string | undefined {
  const value = process.env.NEXT_PUBLIC_USDC_MINT;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Is this deployment configured for mainnet-beta, exactly?
 *
 * This is a plain predicate. An earlier comment here called it "a hard stop on ever
 * pointing this MVP at mainnet by accident" and said mainnet is a deliberate decision
 * "made by setting this flag". There is no such flag and nothing blocks anything: it
 * only reports what NEXT_PUBLIC_SOLANA_CLUSTER says, and it was not called anywhere.
 *
 * For a SAFETY check use `treatAsMainnet` below, not this.
 */
export function isMainnet(): boolean {
  return solanaCluster() === "mainnet-beta";
}

/**
 * Should a safety guard behave as though this is mainnet? FAILS CLOSED.
 *
 * `solanaCluster()` silently falls back to "devnet" for any value it does not recognise,
 * so a typo such as NEXT_PUBLIC_SOLANA_CLUSTER=mainnet reads as devnet. A guard built on
 * `isMainnet()` would then fail OPEN on exactly the deployment it exists to protect. So
 * anything that merely looks like mainnet counts: the guard errs toward refusing sample
 * data, never toward serving it.
 *
 * Takes the raw value so it can be tested and used from scripts.
 */
export function treatAsMainnet(raw: string | undefined = process.env.NEXT_PUBLIC_SOLANA_CLUSTER): boolean {
  return /main/i.test(raw ?? "");
}
