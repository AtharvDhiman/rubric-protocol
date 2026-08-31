/**
 * Shared Solana helpers: PDA derivation, connection, and IDL loading.
 *
 * PDA derivation is pure and runs on both client and server - the browser needs
 * it to build transactions, the API needs it to read on-chain state. It contains
 * no secrets and imports nothing server-only.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { programIdString, rpcUrl, usdcMintString } from "./env";
import { USDC_DECIMALS } from "./constants";

/** Must match `constants.rs`. Duplicated on purpose - a drift is a bug. */
export const CONFIG_SEED = Buffer.from("config");
export const TASK_SEED = Buffer.from("task");

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export function programId(): PublicKey {
  const id = programIdString();
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_PROGRAM_ID is not set. Run `anchor keys sync`, deploy, and put the program id in .env.local."
    );
  }
  return new PublicKey(id);
}

export function usdcMint(): PublicKey {
  const mint = usdcMintString();
  if (!mint) {
    throw new Error(
      "NEXT_PUBLIC_USDC_MINT is not set. Use the devnet USDC mint for dev - do not hardcode the mainnet address."
    );
  }
  return new PublicKey(mint);
}

export function connection(): Connection {
  return new Connection(rpcUrl(), "confirmed");
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

export function configPda(program = programId()): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], program)[0];
}

/** `task_id` as the 8 little-endian bytes the program uses in its seeds. */
export function taskIdBytes(taskId: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(taskId);
  return buf;
}

export function taskPda(
  creator: PublicKey,
  taskId: bigint,
  program = programId()
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [TASK_SEED, creator.toBuffer(), taskIdBytes(taskId)],
    program
  )[0];
}

/**
 * The canonical associated token address. Re-implemented here rather than
 * importing @solana/spl-token so this module stays light enough for the client
 * bundle; the derivation is fixed and defined by the ATA program.
 */
export function associatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/** The escrow for a task: an ATA owned by the Task PDA. */
export function escrowAddress(task: PublicKey, mint = usdcMint()): PublicKey {
  return associatedTokenAddress(mint, task);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 25000000n -> "25.00". Never use a float for money. */
export function formatUsdc(baseUnits: bigint | number | string): string {
  const value = BigInt(baseUnits);
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = value / divisor;
  const frac = value % divisor;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

/** "25.5" -> 25500000n. Rejects anything that would lose precision. */
export function parseUsdc(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d*(\.\d{0,6})?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Enter an amount with at most 6 decimal places.");
  }
  const [whole, frac = ""] = trimmed.split(".");
  const padded = frac.padEnd(USDC_DECIMALS, "0");
  return BigInt(whole || "0") * BigInt(10 ** USDC_DECIMALS) + BigInt(padded);
}

/** "4kTkabc...8wHK" -> "4kTk…8wHK". Used for every address in the UI. */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Hashes are shown as the first 8 and last 4 hex characters. */
export function truncateHash(hex: string): string {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}
