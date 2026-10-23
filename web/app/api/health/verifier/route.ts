/**
 * GET /api/health/verifier - can the verifier settle a verdict, and for how long?
 *
 * Point an uptime monitor at this URL (UptimeRobot, BetterStack, anything that
 * alerts on a non-2xx). It returns 200 ONLY when the verifier is fully healthy and
 * 503 for everything else - a low balance, an empty one, a key the chain does not
 * trust, a bad NEXT key, or a chain that could not be read - so the monitor's own
 * "down" alert is the low-balance alert. No push integration is needed.
 *
 * WHAT IT REVEALS: the verifier's public key and its balance, both of which are
 * public on-chain already (the key is in the program's Config). It never returns,
 * logs or derives anything from secret material.
 *
 * Not cached: a monitor that is told "healthy" by a CDN after the wallet emptied is
 * worse than no monitor.
 */

import { NextResponse } from "next/server";
import { getVerifierHealth } from "@/lib/server/verifier-health";
import { statusFor } from "@/lib/verifier-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getVerifierHealth();
  return NextResponse.json(health, {
    status: statusFor(health),
    headers: { "cache-control": "no-store" },
  });
}
