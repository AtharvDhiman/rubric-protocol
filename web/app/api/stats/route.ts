/**
 * GET /api/stats - Rubric's traction figures, computed from the chain.
 *
 * The same numbers as /stats and as `scripts/traction-report.ts`, as JSON. Amounts are exact
 * decimal strings, never numbers, so nothing is rounded through a double. The response says
 * which cluster it came from (found by genesis hash), whether that is a test network, the
 * slot it was read at, and whether this is a copy kept after a failed read.
 *
 * Public and read-only. One chain read serves everyone for a minute (lib/server/traction.ts),
 * so this cannot be used to drive load onto the RPC endpoint.
 *
 * A failure says only that the figures could not be read. The reason stays in the server log,
 * and only as an error name: an RPC error message can carry the endpoint URL, and RPC URLs
 * very often contain an API key.
 */

import { getTraction } from "@/lib/server/traction";
import { tractionToJson } from "@/lib/traction-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_TYPE = "application/json; charset=utf-8";

export async function GET() {
  try {
    const { value, ageMs, stale } = await getTraction();
    const body = tractionToJson(value.report, value.provenance, {
      stale,
      ageSeconds: Math.round(ageMs / 1000),
    });
    return new Response(body, {
      headers: {
        "content-type": JSON_TYPE,
        // A shared cache may hold a good reading briefly. It must never pin a copy that was
        // served because the chain could not be read.
        "cache-control": stale ? "no-store" : "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Could not read the traction figures from the chain." }), {
      status: 503,
      headers: { "content-type": JSON_TYPE, "cache-control": "no-store" },
    });
  }
}
