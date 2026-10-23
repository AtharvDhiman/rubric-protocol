/**
 * GET /api/limits - the bounty cap and the pause switch, read from the chain.
 *
 * The create page asks this so the poster is told the real cap before they sign.
 * It is a courtesy: `create_task` enforces both limits itself, so a stale answer
 * here can only ever cost a failed transaction, never a wrong settlement.
 *
 * Not cached, on purpose. The pause switch is an incident lever, and a CDN
 * serving "not paused" for a minute after the admin paused is the wrong failure.
 */

import { NextResponse } from "next/server";
import { fetchLimits } from "@/lib/server/program";
import { toPayload } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const limits = await fetchLimits();
    return NextResponse.json(toPayload(limits), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // The RPC being unreachable is not the same as "no limits". Say so, so the
    // page can decline to proceed instead of guessing a cap.
    return NextResponse.json(
      { error: "Could not read the protocol limits from the chain." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
