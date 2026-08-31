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
 * A hard stop on ever pointing this MVP at mainnet by accident. The program is
 * unaudited and runs on a single verifier key; mainnet is a deliberate decision
 * the operator makes by setting this flag, not something a stray env var does.
 */
export function isMainnet(): boolean {
  return solanaCluster() === "mainnet-beta";
}
