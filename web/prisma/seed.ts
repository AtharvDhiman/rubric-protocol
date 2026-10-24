/**
 * Seed the docket with representative records.
 *
 * Purpose: let the UI be reviewed and demoed before the Rust toolchain, the
 * program deploy, or a funded wallet exist. These rows carry NO real on-chain
 * state - their transaction signatures are placeholders and their PDAs will not
 * resolve on any cluster.
 *
 *   cd web && npm run db:push && npm run db:seed
 *
 * REFUSES TO RUN ON MAINNET. These rows are not real - fake addresses, placeholder
 * signatures, a "settled" 25 USDC verdict - and on mainnet that would present money that
 * never moved as real activity. The refusal fails closed (lib/env.ts, `treatAsMainnet`).
 * The rows also carry the `demo-` id prefix, so the UI labels every one SAMPLE; before
 * this they had ordinary generated ids and were indistinguishable from real tasks.
 *
 * Do not run this against a database that holds real tasks.
 */

import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashRubricHex, hashSubmissionHex, hashVerdictHex } from "../lib/hash";
import { treatAsMainnet } from "../lib/env";
import { SAMPLE_CREATORS, SAMPLE_ID_PREFIX, SEED_FAKE_TX } from "../lib/sample-data";

// Same order the app uses: .env.local first, then .env. dotenv never overrides a variable
// that is already set, so the real environment wins.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

if (treatAsMainnet()) {
  console.error(
    "\nREFUSING: NEXT_PUBLIC_SOLANA_CLUSTER says mainnet. This script writes SAMPLE records - " +
      "fake addresses, placeholder signatures, a settled verdict with no escrow behind it - and " +
      "on mainnet that would show money that never moved as real activity.\n"
  );
  process.exit(1);
}

// Its own client rather than lib/db.ts, because that module is marked
// `server-only` and this script runs outside Next.js.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

/**
 * Demo addresses. Nobody holds these keys, but they must still be VALID base58
 * pubkeys: the task page derives the Task PDA from the creator address, and an
 * unparseable one makes the derivation throw and the PDA render as "—". Derived
 * from fixed seeds so re-seeding produces the same records.
 */
const CREATOR = SAMPLE_CREATORS[1];
const WORKER = "9fT2ZmQ7xR4nP1sV8cL3wY6bJ5dK2gN4hA7tX9pM3eS";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // devnet USDC
const FAKE_TX = SEED_FAKE_TX; // one definition, so the detector and the writer cannot drift

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

async function main() {
  console.log("Seeding demo records…");

  // ---- The demo money shot: an approved, settled matter -------------------
  const labelling = {
    title: "Label 500 warehouse shelf photos",
    clauses: [
      "Every barcode in the delivered labels is legible and in focus.",
      "Images too blurred to read are excluded rather than guessed at.",
      "There is exactly one label per image.",
    ],
  };

  const submission =
    "Delivered 500 labelled images as labels.jsonl. I sampled 50 and verified " +
    "every barcode is legible and in focus. Twelve frames that were too blurred " +
    "to read were excluded from the set and listed in excluded.txt rather than " +
    "guessed at. Each image carries exactly one label object, verified by a " +
    "uniqueness check on image_id.";

  const verdict = {
    outcome: "approved",
    approved: true,
    confidence: 96,
    model: "claude-opus-5",
    rubricTitle: labelling.title,
    clauseCount: 3,
    summary:
      "All three clauses are satisfied and the exclusions are documented rather than guessed.",
    clauses: [
      {
        index: 0,
        passed: true,
        reason: "Sampled 50 of 500 — barcodes visible and in focus.",
      },
      {
        index: 1,
        passed: true,
        reason: "Twelve blurred frames correctly excluded and listed.",
      },
      {
        index: 2,
        passed: true,
        reason: "Exactly one label per image throughout.",
      },
    ],
  };

  const rows = [
    {
      onchainTaskId: 42n,
      creatorAddress: CREATOR,
      workerAddress: WORKER,
      title: labelling.title,
      clauses: labelling.clauses,
      rubricHash: hashRubricHex(labelling),
      bountyAmount: 25_000_000n,
      mint: MINT,
      deadline: hoursFromNow(-2),
      category: "Labeling",
      state: "SETTLED" as const,
      txCreate: FAKE_TX,
      txSubmit: FAKE_TX,
      txSettle: FAKE_TX,
      submissionContent: submission,
      submissionHash: hashSubmissionHex(submission),
      submittedAt: new Date(Date.now() - 3_600_000),
      verdictJson: verdict as object,
      verdictReasoningHash: hashVerdictHex(verdict),
      confidence: 96,
      decidedAt: new Date(Date.now() - 3_600_000 + 41_000),
    },
    {
      onchainTaskId: 43n,
      creatorAddress: CREATOR,
      title: "Write 8 product descriptions for a coffee catalogue",
      clauses: [
        "Each description is between 40 and 70 words.",
        "No description repeats a phrase from another.",
        "Every description names the origin country of the bean.",
      ],
      rubricHash: hashRubricHex({
        title: "Write 8 product descriptions for a coffee catalogue",
        clauses: [
          "Each description is between 40 and 70 words.",
          "No description repeats a phrase from another.",
          "Every description names the origin country of the bean.",
        ],
      }),
      bountyAmount: 18_000_000n,
      mint: MINT,
      deadline: hoursFromNow(46),
      category: "Content",
      state: "OPEN" as const,
      txCreate: FAKE_TX,
    },
    {
      onchainTaskId: 44n,
      creatorAddress: CREATOR,
      workerAddress: WORKER,
      title: "Port the CSV importer to streaming",
      clauses: [
        "Memory use stays flat for a 2GB input file.",
        "The existing test suite passes unchanged.",
        "No new third-party dependency is added.",
      ],
      rubricHash: hashRubricHex({
        title: "Port the CSV importer to streaming",
        clauses: [
          "Memory use stays flat for a 2GB input file.",
          "The existing test suite passes unchanged.",
          "No new third-party dependency is added.",
        ],
      }),
      bountyAmount: 40_000_000n,
      mint: MINT,
      deadline: hoursFromNow(20),
      category: "Code",
      state: "SUBMITTED" as const,
      txCreate: FAKE_TX,
      txSubmit: FAKE_TX,
      submissionContent:
        "Rewrote the importer around a Node stream pipeline. Peak RSS on the 2GB " +
        "fixture is 94MB, flat across the run (profile attached). Full suite " +
        "passes with no changes. No new dependencies — uses node:stream only.",
      submissionHash: hashSubmissionHex("streaming importer"),
      submittedAt: new Date(Date.now() - 120_000),
    },
    {
      onchainTaskId: 45n,
      creatorAddress: CREATOR,
      workerAddress: WORKER,
      title: "Verify 200 business addresses against the public register",
      clauses: [
        "Each address is matched to a company number.",
        "Unmatched rows are flagged, not deleted.",
      ],
      rubricHash: hashRubricHex({
        title: "Verify 200 business addresses against the public register",
        clauses: [
          "Each address is matched to a company number.",
          "Unmatched rows are flagged, not deleted.",
        ],
      }),
      bountyAmount: 12_000_000n,
      mint: MINT,
      deadline: hoursFromNow(8),
      category: "Verification",
      state: "HELD" as const,
      txCreate: FAKE_TX,
      txSubmit: FAKE_TX,
      submissionContent:
        "Matched 186 of 200 addresses to company numbers. The remaining 14 are " +
        "ambiguous — several companies share the same registered office and the " +
        "register does not disambiguate them.",
      submissionHash: hashSubmissionHex("address verification"),
      submittedAt: new Date(Date.now() - 600_000),
      confidence: 54,
      heldReason:
        "Confidence 54 is below the 70 threshold required to settle automatically.",
      decidedAt: new Date(Date.now() - 580_000),
    },
  ];

  for (const row of rows) {
    await prisma.task.upsert({
      where: {
        creatorAddress_onchainTaskId: {
          creatorAddress: row.creatorAddress,
          onchainTaskId: row.onchainTaskId,
        },
      },
      // The id is set on CREATE only: a row seeded before this existed keeps its old
      // generated id (and is recognised as a sample by its creator and signature instead,
      // lib/sample-data.ts), and an update must never rewrite a primary key.
      create: { ...row, id: `${SAMPLE_ID_PREFIX}seed-${row.onchainTaskId}` },
      update: row,
    });
    console.log(`  ${row.onchainTaskId}  ${row.state.padEnd(9)} ${row.title}`);
  }

  const settled = await prisma.task.findFirst({
    where: { onchainTaskId: 42n },
    select: { id: true },
  });
  console.log(`\nDone. The verdict sheet is at /task/${settled?.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
