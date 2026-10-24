/**
 * What identifies SAMPLE data, in one place, and how mainnet keeps it out.
 *
 * Rubric's claim is that what you see is what was sealed on-chain. A sample row that
 * looks like a settled task, with no escrow behind it, is the exact lie the protocol
 * exists to rule out - and on mainnet it would be worse than a lie about a demo: it
 * would be a depiction of money that never moved.
 *
 * THERE ARE TWO WAYS SAMPLE ROWS GET INTO A DATABASE, and they were not equally marked:
 *
 *   - scripts/seed-samples.mjs writes lib/demo.ts's records with `demo-` ids, which is what
 *     `isSampleTask` keys off, so the UI labels every one SAMPLE.
 *   - prisma/seed.ts (`npm run db:seed`) wrote matters 42-45 - placeholder signatures, a
 *     settled 25 USDC verdict - under ordinary generated ids. Nothing marked them. In a real
 *     database they showed as real tasks, and counted in the docket's totals.
 *
 * So a sample row is recognised three ways, any one of which is enough: the id prefix, a
 * creator address nobody holds, or the seed script's placeholder transaction signature.
 * prisma/seed.ts now also uses the `demo-` prefix, but a database already seeded keeps
 * its old ids, which is why the other two checks exist.
 *
 * It imports only lib/env.ts, which has no side effects and no server-only code, so the seed
 * scripts can use it too.
 */

import type { Prisma } from "@prisma/client";
import { treatAsMainnet } from "./env";

export const SAMPLE_ID_PREFIX = "demo-";

/**
 * Creator addresses used by the sample data. Nobody holds these keys. There are two
 * because the two seed paths grew separately.
 */
export const SAMPLE_CREATORS = [
  "Co4QhGvJ8sPvKqQhWnqjKZ5m1SjvBpTBRq7ZLLNunMTh", // lib/demo.ts
  "Co4QbmAUyMsRzLst4tMtMWzQZZQMf4japzh4zua2nMTh", // prisma/seed.ts
] as const;

/** The placeholder signature prisma/seed.ts writes. It resolves on no cluster. */
export const SEED_FAKE_TX = "5".repeat(87);

/**
 * Should the app serve sample records instead of a database?
 *
 * Only when no database is configured AND this is not mainnet. A mainnet deployment that
 * has lost its database must say "unavailable", never quietly start serving invented tasks
 * with plausible totals: that is real data going missing and fake data appearing in its
 * place. `cluster` is the raw NEXT_PUBLIC_SOLANA_CLUSTER, and the check fails closed (see
 * `treatAsMainnet`).
 */
export function demoModeFor(databaseUrl: string | undefined, cluster: string | undefined): boolean {
  return !databaseUrl && !treatAsMainnet(cluster);
}

export const isSampleId = (id: string): boolean => id.startsWith(SAMPLE_ID_PREFIX);

/** True if a row is sample data, by any of the three markers. */
export function isSampleRow(row: {
  id: string;
  creatorAddress?: string | null;
  txCreate?: string | null;
}): boolean {
  return (
    isSampleId(row.id) ||
    (row.creatorAddress != null && (SAMPLE_CREATORS as readonly string[]).includes(row.creatorAddress)) ||
    row.txCreate === SEED_FAKE_TX
  );
}

/** The Prisma `where` fragment that matches sample rows. */
export const SAMPLE_ROW_WHERE: Prisma.TaskWhereInput = {
  OR: [
    { id: { startsWith: SAMPLE_ID_PREFIX } },
    { creatorAddress: { in: [...SAMPLE_CREATORS] } },
    { txCreate: SEED_FAKE_TX },
  ],
};

/**
 * For a single lookup: on mainnet a sample row does not exist, so a task page or an API
 * answer for one is "not found" - exactly as if it had never been seeded. Off mainnet the
 * row is returned (and labelled SAMPLE by the UI).
 */
export function hideSampleOnMainnet<T extends { id: string; creatorAddress?: string | null; txCreate?: string | null }>(
  row: T | null,
  mainnet: boolean = treatAsMainnet()
): T | null {
  return row !== null && mainnet && isSampleRow(row) ? null : row;
}

/**
 * Narrow a Prisma `where` so it can never return sample rows - but only on mainnet, where
 * sample data must not exist. Elsewhere (devnet, a demo) samples are labelled and wanted,
 * so the filter is left out.
 *
 * `mainnet` defaults to the environment; it is a parameter so the rule can be tested.
 */
export function withoutSamples(
  where: Prisma.TaskWhereInput,
  mainnet: boolean = treatAsMainnet()
): Prisma.TaskWhereInput {
  return mainnet ? { AND: [where, { NOT: SAMPLE_ROW_WHERE }] } : where;
}
