/**
 * Presentation helpers for task screens.
 *
 * These wrap the strict helpers in lib/solana.ts so that a missing
 * NEXT_PUBLIC_PROGRAM_ID renders a dash instead of throwing a 500. A record page
 * should still show the clauses and the verdict even when the chain config is
 * not wired up yet - the sealed text is the point, and it is in the database.
 */

import { PublicKey } from "@solana/web3.js";
import { programIdString } from "./env";
import { taskPda } from "./solana";

export { formatUsdc, parseUsdc, truncateAddress, truncateHash } from "./solana";

/** The program id, or null if it is not configured. Never throws. */
export function programIdSafe(): string | null {
  const id = programIdString();
  if (!id) return null;
  try {
    return new PublicKey(id).toBase58();
  } catch {
    return null;
  }
}

/** The Task PDA as base58, or null if it cannot be derived. Never throws. */
export function taskPdaSafe(
  creatorAddress: string,
  onchainTaskId: bigint
): string | null {
  try {
    const creator = new PublicKey(creatorAddress);
    return taskPda(creator, onchainTaskId).toBase58();
  } catch {
    return null;
  }
}
