/**
 * The traction figures for the /stats page and /api/stats, read from the chain.
 *
 * Read-only: it uses the read-only program handle, which cannot sign and never loads the
 * verifier key. The figures come from the Task accounts and nowhere else, so there is no
 * database in this path and no way for a seeded sample row to be counted.
 *
 * One read serves everyone for a minute. `getProgramAccounts` is the call RPC providers
 * limit first, and this page is public, so it must not cost one call per visitor
 * (lib/ttl-cache.ts). If the chain cannot be read, a reading up to ten minutes old is
 * served and flagged as a copy; older than that, nothing is served.
 */

import "server-only";

import { loadTractionReport, readProvenance, type Provenance, type TractionProgram } from "../traction-chain";
import type { TractionReport } from "../traction";
import { singleFlightCache, type Cached } from "../ttl-cache";
import { readOnlyProgram, serverConnection } from "./program";

export interface TractionSnapshot {
  report: TractionReport;
  provenance: Provenance;
}

export const FRESH_MS = 60_000;
export const STALE_MS = 600_000;

async function readSnapshot(): Promise<TractionSnapshot> {
  const program = readOnlyProgram();
  // The slot first, then the accounts: the accounts are at or after the slot we report.
  const provenance = await readProvenance(serverConnection(), program.programId);
  const { report } = await loadTractionReport(program as unknown as TractionProgram);
  return { report, provenance };
}

/** A source with its own cache. Exported so a test can use a fake reader and clock. */
export function createTractionSource(
  read: () => Promise<TractionSnapshot> = readSnapshot,
  now?: () => number
) {
  const cache = singleFlightCache<TractionSnapshot>({ freshMs: FRESH_MS, staleMs: STALE_MS, now });
  return {
    get(): Promise<Cached<TractionSnapshot>> {
      return cache.get(async () => {
        try {
          return await read();
        } catch (error) {
          // The name only. An RPC error's message can carry the endpoint URL, and RPC URLs
          // very often contain an API key.
          console.error("[stats] could not read the chain:", error instanceof Error ? error.name : "unknown error");
          throw error;
        }
      });
    },
  };
}

const source = createTractionSource();

/** The current reading, from the cache if it is fresh. Throws if there is nothing to show. */
export const getTraction = () => source.get();
