/**
 * What the mainnet banner says.
 *
 * Shown on mainnet only. The program is unaudited and runs on a single verifier key, and
 * the person looking at a screen with real money behind it is owed that fact in plain
 * words, on every screen, not buried in a README. The mainnet checklist (Phase 6) asked
 * for exactly this banner and it did not exist.
 *
 * The cap is the LIVE on-chain value (GET /api/limits), because it lives in the `Limits`
 * account and the admin can change it: a banner that hard-coded "50 USDC" would be wrong
 * the day it changed. When the cap cannot be read, the banner says the bounties are capped
 * without guessing a number.
 */

import { formatUsdc } from "./solana";
import type { LimitsPayload } from "./limits";

export function mainnetBannerText(limits: LimitsPayload | null): string {
  const parts = ["MAINNET", "UNAUDITED PROGRAM"];

  if (limits === null) {
    // Not read yet, or the chain could not be read. No number is better than a guess.
    parts.push("BOUNTIES ARE CAPPED");
  } else if (!limits.initialised) {
    parts.push("NEW TASKS CANNOT BE SEALED YET");
  } else {
    parts.push(`BOUNTIES CAPPED AT ${formatUsdc(BigInt(limits.maxBounty))} USDC`);
    if (limits.paused) parts.push("NEW TASKS PAUSED");
  }
  return parts.join(" · ");
}
