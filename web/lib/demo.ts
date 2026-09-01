/**
 * Demo mode: a working docket with no database behind it.
 *
 * WHEN IT TURNS ON
 * ----------------
 * Only when `DATABASE_URL` is not configured at all. That is a deliberate
 * deployment choice — a public demo with no Postgres attached — and it is the
 * one case where showing sample records is the right answer.
 *
 * It deliberately does NOT turn on when a configured database is merely
 * unreachable. A transient outage on a real deployment must keep saying "the
 * record store is unavailable", not quietly start serving invented tasks. Real
 * data going missing and fake data appearing in its place is exactly the kind of
 * thing this protocol exists to prevent, so the distinction is enforced here
 * rather than left to a comment.
 *
 * WHAT IS AND IS NOT REAL
 * -----------------------
 * The rubric hashes below are genuine SHA-256 digests of the canonical form of
 * each task, produced by the same `lib/hash.ts` the protocol uses — so the hash
 * shown on a demo task really is the hash of the clauses shown next to it, and
 * the "verify it yourself" story holds up. Everything else — addresses,
 * signatures, balances — is sample data for illustration, and the UI says so
 * plainly wherever these records appear.
 *
 * Writes are refused in demo mode rather than pretended. Sealing a rubric moves
 * real money on a real chain; a demo that quietly no-ops a payment would be
 * worse than one that says it cannot.
 */

import { hashRubricHex, hashSubmissionHex } from "./hash";

/** True when this deployment has no database configured at all. */
export const DEMO_MODE = !process.env.DATABASE_URL;

/** What a route or action should say when it cannot write in demo mode. */
export const DEMO_WRITE_MESSAGE =
  "This deployment is running in demo mode with no database attached, so it cannot record new tasks. Run it locally with a Postgres connection to seal a real rubric.";

export type TaskState = "OPEN" | "SUBMITTED" | "HELD" | "SETTLED" | "REFUNDED";

/**
 * A type alias, not an interface, on purpose. Prisma types `verdictJson` as its
 * recursive `JsonValue`, and TypeScript gives object type aliases an implicit
 * index signature while interfaces get none - so an interface here fails to
 * assign into the same array as a real Task row.
 */
export type DemoVerdict = {
  approved: boolean;
  confidence: number;
  summary: string;
  clauses: Array<{ index: number; passed: boolean; reason: string }>;
};

export interface DemoTask {
  id: string;
  onchainTaskId: bigint;
  creatorAddress: string;
  workerAddress: string | null;
  title: string;
  clauses: string[];
  rubricHash: string;
  bountyAmount: bigint;
  mint: string;
  deadline: Date;
  category: string;
  state: TaskState;
  txCreate: string | null;
  txSubmit: string | null;
  txSettle: string | null;
  submissionContent: string | null;
  submissionHash: string | null;
  submittedAt: Date | null;
  verdictJson: DemoVerdict | null;
  verdictReasoningHash: string | null;
  confidence: number | null;
  heldReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const POSTER = "Co4QhGvJ8sPvKqQhWnqjKZ5m1SjvBpTBRq7ZLLNunMTh";
const WORKER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PvvY7YA";

/** Hours from now, as a Date. Negative for the past. */
const hours = (n: number) => new Date(Date.now() + n * 3600_000);

interface Seed {
  id: string;
  n: number;
  title: string;
  clauses: string[];
  category: string;
  usdc: number;
  state: TaskState;
  deadlineHours: number;
  submission?: string;
  verdict?: DemoVerdict;
  heldReason?: string;
  submittedHoursAgo?: number;
  decidedSecondsAfter?: number;
}

const SEEDS: Seed[] = [
  {
    id: "demo-settled-labels",
    n: 42,
    title: "Label 500 warehouse shelf photos",
    clauses: [
      "Every barcode in the delivered labels is legible and in focus.",
      "Images too blurred to read are excluded rather than guessed at.",
      "There is exactly one label per image.",
    ],
    category: "Labeling",
    usdc: 25,
    state: "SETTLED",
    deadlineHours: -30,
    submittedHoursAgo: 34,
    decidedSecondsAfter: 41,
    submission:
      "Delivered 500 labelled images as labels.jsonl. Every barcode was checked at full resolution and is legible and in focus. 12 frames were too blurred to read and are excluded from the set, listed in excluded.txt with the reason for each rather than guessed at. Each image carries exactly one label object, verified with a uniqueness check on image_id: 488 labelled + 12 excluded = 500.",
    verdict: {
      approved: true,
      confidence: 94,
      summary:
        "All three clauses are satisfied. The exclusion count reconciles against the stated total, and the uniqueness check addresses the one-label-per-image requirement directly.",
      clauses: [
        { index: 0, passed: true, reason: "States every barcode was checked at full resolution and is legible." },
        { index: 1, passed: true, reason: "12 unreadable frames were excluded and itemised, not guessed at." },
        { index: 2, passed: true, reason: "A uniqueness check on image_id confirms one label per image." },
      ],
    },
  },
  {
    id: "demo-open-coffee",
    n: 43,
    title: "Write 8 product descriptions for a coffee catalogue",
    clauses: [
      "Each description is between 40 and 60 words.",
      "No description repeats a phrase from another.",
      "Tasting notes name at least two specific flavours.",
    ],
    category: "Content",
    usdc: 18,
    state: "OPEN",
    deadlineHours: 32,
  },
  {
    id: "demo-inreview-csv",
    n: 44,
    title: "Port the CSV importer to streaming",
    clauses: [
      "The importer handles a 2 GB file without exceeding 256 MB of memory.",
      "Existing tests pass unchanged.",
      "Malformed rows are reported with a line number, not swallowed.",
    ],
    category: "Code",
    usdc: 40,
    state: "SUBMITTED",
    deadlineHours: 6,
    submittedHoursAgo: 1,
    submission:
      "Rewrote the importer around a streaming parser. Peak RSS on the 2 GB fixture is 190 MB, measured with /usr/bin/time -v across three runs. The existing suite passes unchanged, 61 tests. Malformed rows now raise with the source line number attached and are collected into a report rather than skipped silently.",
  },
  {
    id: "demo-held-addresses",
    n: 45,
    title: "Verify 200 business addresses against the public register",
    clauses: [
      "Each address is matched to a company number.",
      "Unmatched rows are flagged, not deleted.",
    ],
    category: "Verification",
    usdc: 12,
    state: "HELD",
    deadlineHours: -4,
    submittedHoursAgo: 8,
    decidedSecondsAfter: 52,
    submission:
      "Matched 186 of 200 addresses to company numbers. The remaining 14 are ambiguous — several companies share the same registered office and the register does not disambiguate them.",
    heldReason:
      "The judge was not confident enough to settle this automatically, so the escrow is untouched and a person will review it. Nobody has been paid and nobody has been refunded.",
    verdict: {
      approved: false,
      confidence: 54,
      summary:
        "Clause 1 turns on whether 186 of 200 counts as 'each address matched'. The submission is candid about the 14 it could not resolve, and the clause does not say what to do about genuine ambiguity in the source register.",
      clauses: [
        { index: 0, passed: false, reason: "14 of 200 addresses are unmatched, and the clause reads as requiring all of them." },
        { index: 1, passed: true, reason: "The unmatched rows are reported rather than dropped." },
      ],
    },
  },
  {
    id: "demo-refunded-transcripts",
    n: 46,
    title: "Transcribe 20 field recordings",
    clauses: [
      "Every recording has a plain-text transcript.",
      "Inaudible passages are marked rather than guessed at.",
      "Speaker turns are labelled.",
    ],
    category: "Content",
    usdc: 15,
    state: "REFUNDED",
    deadlineHours: -50,
    submittedHoursAgo: 52,
    decidedSecondsAfter: 38,
    submission:
      "Transcribed the recordings. Some parts were hard to hear so I filled in what seemed most likely from context. Did not mark speakers separately.",
    verdict: {
      approved: false,
      confidence: 91,
      summary:
        "Two clauses fail on the submission's own account of the work. Guessing at inaudible passages is the specific thing clause 2 rules out, and clause 3 is not addressed at all.",
      clauses: [
        { index: 0, passed: true, reason: "Transcripts were produced for the recordings." },
        { index: 1, passed: false, reason: "States that unclear passages were filled in from context, which clause 2 forbids." },
        { index: 2, passed: false, reason: "Says speakers were not labelled separately." },
      ],
    },
  },
];

/** A deterministic stand-in signature, so Explorer links are obviously samples. */
const sampleSig = (n: number, kind: string) =>
  `${kind}${String(n)}`.padEnd(11, "0").repeat(8).slice(0, 88);

function build(seed: Seed): DemoTask {
  const submittedAt =
    seed.submittedHoursAgo != null ? hours(-seed.submittedHoursAgo) : null;
  const decidedAt =
    submittedAt && seed.decidedSecondsAfter != null
      ? new Date(submittedAt.getTime() + seed.decidedSecondsAfter * 1000)
      : null;

  return {
    id: seed.id,
    onchainTaskId: BigInt(seed.n),
    creatorAddress: POSTER,
    workerAddress: seed.submission ? WORKER : null,
    title: seed.title,
    clauses: seed.clauses,
    // A real digest of these exact clauses, from the same function the protocol
    // seals with. The hash on screen genuinely is the hash of the text beside it.
    rubricHash: hashRubricHex({ title: seed.title, clauses: seed.clauses }),
    bountyAmount: BigInt(Math.round(seed.usdc * 1e6)),
    mint: MINT,
    deadline: hours(seed.deadlineHours),
    category: seed.category,
    state: seed.state,
    txCreate: sampleSig(seed.n, "create"),
    txSubmit: seed.submission ? sampleSig(seed.n, "submit") : null,
    txSettle:
      seed.state === "SETTLED" || seed.state === "REFUNDED"
        ? sampleSig(seed.n, "settle")
        : null,
    submissionContent: seed.submission ?? null,
    submissionHash: seed.submission ? hashSubmissionHex(seed.submission) : null,
    submittedAt,
    verdictJson: seed.verdict ?? null,
    verdictReasoningHash: seed.verdict
      ? hashSubmissionHex(JSON.stringify(seed.verdict))
      : null,
    confidence: seed.verdict?.confidence ?? null,
    heldReason: seed.heldReason ?? null,
    decidedAt,
    createdAt: hours(seed.deadlineHours - 24),
    updatedAt: decidedAt ?? submittedAt ?? hours(seed.deadlineHours - 24),
  };
}

/** The sample docket, newest first, matching how the real query orders. */
export function demoTasks(): DemoTask[] {
  return SEEDS.map(build).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export function demoTaskById(id: string): DemoTask | null {
  return demoTasks().find((t) => t.id === id) ?? null;
}
