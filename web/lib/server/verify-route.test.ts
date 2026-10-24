/**
 * POST /api/tasks/[id]/verify, with the database, the chain and the judge mocked.
 *
 * This route had no route-level tests. It has changed twice (the verifier preflight,
 * then operational holds), and what it must never do is exactly what a unit test of a
 * helper cannot see: spend judge quota it cannot settle, settle a task the chain has
 * already decided, or record a hold on the work when the fault was ours.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test/test";
  return {
    findUnique: vi.fn(),
    update: vi.fn(),
    fetchTask: vi.fn(),
    sendVerdict: vi.fn(),
    health: vi.fn(),
    runVerdict: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { task: { findUnique: mocks.findUnique, update: mocks.update } },
  serializeBigInts: (v: unknown) =>
    JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))),
}));
vi.mock("@/lib/server/program", () => ({ fetchTask: mocks.fetchTask, sendVerdict: mocks.sendVerdict }));
vi.mock("@/lib/server/verifier-health", () => ({ getVerifierHealth: mocks.health }));
vi.mock("@/lib/verifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/verifier")>()),
  runVerdict: mocks.runVerdict,
}));

import { POST } from "@/app/api/tasks/[id]/verify/route";
import { isOperationalHold } from "@/lib/holds";
import { SAMPLE_CREATORS } from "@/lib/sample-data";
import { CLAUSES, ctx, makeOnChain, makeTask, postRequest } from "./route-test-kit";

let task = makeTask({ state: "SUBMITTED", heldReason: null });

const published = (over: Record<string, unknown> = {}) => ({
  outcome: "approved",
  approved: true,
  confidence: 95,
  clauses: [
    { index: 0, passed: true, reason: "It says blue." },
    { index: 1, passed: true, reason: "It says green." },
  ],
  summary: "Both satisfied.",
  model: "gemini-2.5-flash",
  rubricTitle: "Two clauses",
  clauseCount: 2,
  ...over,
});

const approvedVerdict = () => ({
  outcome: "approved",
  approved: true,
  confidence: 95,
  clauses: published().clauses,
  summary: "Both satisfied.",
  model: "gemini-2.5-flash",
  published: published(),
});

const call = () => POST(postRequest({}, "/api/tasks/task1/verify"), ctx());

beforeEach(() => {
  vi.clearAllMocks();
  task = makeTask({ state: "SUBMITTED", heldReason: null });
  mocks.findUnique.mockImplementation(async () => task);
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data }));
  mocks.fetchTask.mockResolvedValue(makeOnChain());
  mocks.sendVerdict.mockResolvedValue("SIGNATURE");
  mocks.health.mockResolvedValue({ canSettle: true, ok: true, level: "ok", message: "fine" });
  mocks.runVerdict.mockResolvedValue(approvedVerdict());
});

describe("before any judging", () => {
  it("404s for a task that does not exist, and judges nothing", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("refuses a task that is already decided, and judges nothing", async () => {
    task = makeTask({ state: "SETTLED" });
    expect((await call()).status).toBe(409);
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("refuses a task with no submission", async () => {
    task = makeTask({ state: "SUBMITTED", submissionContent: null });
    expect((await call()).status).toBe(409);
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("if the chain says it is already decided, reconciles the row and judges nothing", async () => {
    mocks.fetchTask.mockResolvedValue(makeOnChain({ state: "refunded" }));
    expect((await call()).status).toBe(409);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "REFUNDED" } }));
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("refuses to judge clauses that are not the sealed ones, and holds the task", async () => {
    task = makeTask({ state: "SUBMITTED", clauses: [...CLAUSES.slice(0, 1), "rewritten"] });
    expect((await call()).status).toBe(409);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "HELD" }) }));
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("refuses to judge a submission the worker did not commit to", async () => {
    task = makeTask({ state: "SUBMITTED", submissionContent: "not what was committed" });
    expect((await call()).status).toBe(409);
    expect(mocks.runVerdict).not.toHaveBeenCalled();
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
  });

  it("holds a mismatched task even when the verifier cannot settle: the mismatch is a fact about the task", async () => {
    mocks.health.mockResolvedValue({ canSettle: false, ok: false, level: "empty", message: "empty" });
    task = makeTask({ state: "SUBMITTED", submissionContent: "not what was committed" });
    await call();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "HELD" }) }));
  });
});

describe("a sample row on mainnet", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not exist: nothing is read from the chain, nothing is judged, nothing is paid", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet-beta");
    task = makeTask({ id: "demo-seed-42", state: "SUBMITTED" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    expect(mocks.runVerdict).not.toHaveBeenCalled();
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("includes the legacy seed rows that have an ordinary generated id", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet-beta");
    task = makeTask({ id: "cmgenerated", state: "SUBMITTED", creatorAddress: SAMPLE_CREATORS[1] });
    expect((await call()).status).toBe(404);
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("fails closed on a typo'd cluster name", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet");
    task = makeTask({ id: "demo-seed-42", state: "SUBMITTED" });
    expect((await call()).status).toBe(404);
  });

  it("is judged normally off mainnet, where samples are labelled and wanted", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "devnet");
    task = makeTask({ id: "demo-seed-42", state: "SUBMITTED" });
    expect((await call()).status).toBe(200);
  });

  it("a REAL row on mainnet is unaffected", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet-beta");
    task = makeTask({ state: "SUBMITTED", heldReason: null });
    expect((await call()).status).toBe(200);
  });
});

describe("the verifier preflight", () => {
  beforeEach(() => {
    mocks.health.mockResolvedValue({ canSettle: false, ok: false, level: "empty", message: "wallet empty" });
  });

  it("does not spend judge quota it could not settle", async () => {
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("VERIFIER_UNAVAILABLE");
    expect(mocks.runVerdict).not.toHaveBeenCalled();
  });

  it("leaves the task EXACTLY as it was: nothing is written, so it is not mistaken for a hold on the work", async () => {
    await call();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
  });
});

describe("when the judge rules", () => {
  it("approves and settles: the worker is paid and the verdict is stored", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.sendVerdict.mock.calls[0][0].approved).toBe(true);
    const data = mocks.update.mock.calls.at(-1)![0].data;
    expect(data.state).toBe("SETTLED");
    expect(data.verdictJson.outcome).toBe("approved");
    expect(data.txSettle).toBe("SIGNATURE");
    expect(data.heldReason).toBeNull();
  });

  it("rejects and refunds", async () => {
    mocks.runVerdict.mockResolvedValue({
      ...approvedVerdict(),
      outcome: "rejected",
      approved: false,
      published: published({ outcome: "rejected", approved: false }),
    });
    await call();
    expect(mocks.sendVerdict.mock.calls[0][0].approved).toBe(false);
    expect(mocks.update.mock.calls.at(-1)![0].data.state).toBe("REFUNDED");
  });
});

describe("when the judge holds", () => {
  const judgementHold = () => ({
    outcome: "needs_manual_review",
    approved: false,
    confidence: 54,
    clauses: [],
    summary: "Unsure.",
    heldReason: "Confidence 54 is below the 70 threshold required to settle automatically.",
    holdKind: "judgement",
    model: "gemini-2.5-flash",
    published: published({ outcome: "needs_manual_review", approved: false, confidence: 54 }),
  });

  it("a JUDGEMENT hold stores its verdict and its reason, and settles nothing", async () => {
    mocks.runVerdict.mockResolvedValue(judgementHold());
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
    const data = mocks.update.mock.calls.at(-1)![0].data;
    expect(data.state).toBe("HELD");
    expect(data.verdictJson).toBeDefined();
    expect(data.confidence).toBe(54);
    expect(isOperationalHold(data.heldReason)).toBe(false);
  });

  it("an OUTAGE hold is operational and stores NO ruling: no verdict, no confidence, no decision time", async () => {
    mocks.runVerdict.mockResolvedValue({
      ...judgementHold(),
      confidence: 0,
      holdKind: "operational",
      heldReason: "The judge service is out of API quota, so this submission was not ruled on and nothing has been decided.",
    });
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("JUDGE_UNAVAILABLE");
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
    const data = mocks.update.mock.calls.at(-1)![0].data;
    expect(data.state).toBe("HELD");
    expect(isOperationalHold(data.heldReason)).toBe(true);
    expect(data).not.toHaveProperty("verdictJson");
    expect(data).not.toHaveProperty("confidence");
    expect(data).not.toHaveProperty("decidedAt");
  });
});

describe("when settlement fails", () => {
  beforeEach(() => {
    mocks.sendVerdict.mockRejectedValue(new Error("rpc: https://secret-rpc.example/?key=SECRET"));
  });

  it("holds the task for an OPERATIONAL reason and stores no ruling", async () => {
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("SETTLEMENT_FAILED");
    const data = mocks.update.mock.calls.at(-1)![0].data;
    expect(data.state).toBe("HELD");
    expect(isOperationalHold(data.heldReason)).toBe(true);
    expect(data).not.toHaveProperty("verdictJson");
    expect(data).not.toHaveProperty("decidedAt");
  });

  it("never leaks the underlying error", async () => {
    const res = await call();
    expect(JSON.stringify(await res.json())).not.toMatch(/SECRET|secret-rpc/);
  });

  it("says why when the wallet is the cause", async () => {
    mocks.health
      .mockResolvedValueOnce({ canSettle: true, ok: true, level: "ok", message: "fine" }) // the preflight
      .mockResolvedValueOnce({ canSettle: false, ok: false, level: "empty", message: "The verifier wallet is empty." });
    await call();
    expect(mocks.update.mock.calls.at(-1)![0].data.heldReason).toMatch(/verifier wallet is empty/);
  });

  it("but if the chain has ALREADY decided it, reconciles instead of recording a false hold", async () => {
    mocks.fetchTask
      .mockResolvedValueOnce(makeOnChain())
      .mockResolvedValueOnce(makeOnChain({ state: "settled" }));
    const res = await call();
    expect(res.status).toBe(409);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "SETTLED" } }));
    const holds = mocks.update.mock.calls.filter(([a]) => a.data.state === "HELD");
    expect(holds).toHaveLength(0);
  });
});
