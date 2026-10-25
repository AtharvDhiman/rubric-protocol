/**
 * Reading the list of wallets the team controls.
 *
 * The traction report sets aside any task a declared team wallet posted or worked, so the list
 * is what makes "independent" mean something. That makes a typo dangerous: an entry that is
 * silently dropped lets the team's own volume into the headline. So parsing is strict, and a
 * caller must refuse to produce figures if `problems` is not empty.
 *
 * A REJECTED ENTRY IS NEVER ECHOED. The variable is a list of public addresses, but the most
 * likely mistake is pasting the wrong thing into it, and the wrong thing can be a wallet's
 * secret key. An error message, a log line or a page that repeated it would leak it. Problems
 * name a position, never a value.
 */

import { PublicKey } from "@solana/web3.js";

export interface ParsedTeamWallets {
  /** The valid, distinct addresses, in the order they first appeared. */
  wallets: string[];
  /** One sentence per rejected entry, by position. Empty means the list is usable. */
  problems: string[];
}

/** Commas, semicolons, spaces and new lines all separate entries. */
const SEPARATOR = /[\s,;]+/;

function isAddress(token: string): boolean {
  // Base58 of exactly 32 bytes: the constructor throws for any other length, and the round
  // trip rejects a non-canonical spelling. A program-derived address (a multisig vault, say) is
  // a legitimate team wallet and is not on the ed25519 curve, so that is deliberately not tested.
  try {
    return new PublicKey(token).toBase58() === token;
  } catch {
    return false;
  }
}

export function parseTeamWallets(input: string | undefined | null): ParsedTeamWallets {
  const tokens = (input ?? "").split(SEPARATOR).filter((t) => t.length > 0);
  const wallets: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  tokens.forEach((token, index) => {
    if (!isAddress(token)) {
      problems.push(`Entry ${index + 1} is not a valid Solana address.`);
      return;
    }
    if (seen.has(token)) return;
    seen.add(token);
    wallets.push(token);
  });

  return { wallets, problems };
}

/** Thrown when the declared list cannot be trusted, so no figures are produced from it. */
export class TeamWalletsError extends Error {
  constructor(readonly problems: readonly string[]) {
    super("The list of team-controlled wallets is invalid, so no figures are produced.");
    this.name = "TeamWalletsError";
  }
}

/** The usable list, or a TeamWalletsError. For callers that must not carry on with a bad list. */
export function requireTeamWallets(input: string | undefined | null): string[] {
  const parsed = parseTeamWallets(input);
  if (parsed.problems.length > 0) throw new TeamWalletsError(parsed.problems);
  return parsed.wallets;
}
