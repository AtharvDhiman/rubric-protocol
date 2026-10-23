/**
 * POST /api/tasks/[id]/review, with the database and the chain mocked.
 *
 * This route moves real escrow on a person's say-so, so each refusal is pinned: not the
 * logic in isolation (lib/review.test.ts does that) but the ORDER, because the order is
 * the security property. Authentication happens before any chain read; the allowlist
 * before any signature work; nothing settles unless every check has passed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // DEMO_MODE is "no DATABASE_URL", evaluated when lib/demo is first imported.
  process.env.DATABASE_URL = "postgresql://test/test";
  return {
    findUnique: vi.fn(),
    update: vi.fn(),
    fetchTask: vi.fn(),
    sendVerdict: vi.fn(),
    health: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { task: { findUnique: mocks.findUnique, update: mocks.update } },
  serializeBigInts: (v: unknown) =>
    JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))),
}));
vi.mock("@/lib/server/program", () => ({
  fetchTask: mocks.fetchTask,
  sendVerdict: mocks.sendVerdict,
}));
vi.mock("@/lib/server/verifier-health", () => ({ getVerifierHealth: mocks.health }));

import { POST } from "@/app/api/tasks/[id]/review/route";
import { hashVerdict } from "@/lib/hash";
import { reviewerModel } from "@/lib/review";
import {
  CLAUSES,
  ctx,
  failing,
  keys,
  makeOnChain,
  makeReviewer,
  makeTask,
  passing,
  postRequest,
  signRuling,
} from "./route-test-kit";

const reviewer = makeReviewer();
let task = makeTask();

/** A well-formed, correctly signed request from `who`, ruling `decision`. */
function request(
  who = reviewer,
  decision = failing(),
  extra: Record<string, unknown> = {},
  signAs = who,
  signed = decision
) {
  return postRequest({
    reviewerAddress: who.address,
    decision,
    proof: signRuling(signAs, "task1", signed),
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REVIEWER_ADDRESSES = reviewer.address;
  task = makeTask();
  mocks.findUnique.mockImplementation(async () => task);
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...task, ...data }));
  mocks.fetchTask.mockResolvedValue(makeOnChain());
  mocks.sendVerdict.mockResolvedValue("SIGNATURE");
  mocks.health.mockResolvedValue({ canSettle: true, ok: true, level: "ok", message: "fine" });
});

afterEach(() => {
  delete process.env.REVIEWER_ADDRESSES;
});

/** Nothing may have been settled, written or even read from the chain. */
const untouched = () => {
  expect(mocks.sendVerdict).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
};

describe("who may ask", () => {
  it("is off unless REVIEWER_ADDRESSES is set, and touches nothing", async () => {
    delete process.env.REVIEWER_ADDRESSES;
    const res = await POST(request(), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("REVIEW_DISABLED");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    untouched();
  });

  it("is off if the list holds only invalid entries (a typo can only remove a reviewer)", async () => {
    process.env.REVIEWER_ADDRESSES = "not-a-key, 0OIl";
    const res = await POST(request(), ctx());
    expect(res.status).toBe(404);
  });

  it("refuses a wallet that is not on the list, before any database or chain access", async () => {
    const stranger = makeReviewer();
    const res = await POST(request(stranger), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NOT_A_REVIEWER");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    untouched();
  });

  it("refuses a body that is not JSON", async () => {
    const res = await POST(postRequest("{not json"), ctx());
    expect(res.status).toBe(400);
    untouched();
  });

  it("refuses a body with no reviewer address", async () => {
    const res = await POST(postRequest({ decision: failing() }), ctx());
    expect(res.status).toBe(403);
  });
});

describe("authentication comes before any chain read", () => {
  it("refuses an unsigned ruling without reading the chain", async () => {
    const res = await POST(postRequest({ reviewerAddress: reviewer.address, decision: failing() }), ctx());
    expect(res.status).toBe(401);
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    untouched();
  });

  it("refuses a signature made by a different wallet, even though the claimed wallet is a reviewer", async () => {
    const impostor = makeReviewer();
    const res = await POST(request(reviewer, failing(), {}, impostor), ctx());
    expect(res.status).toBe(401);
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    untouched();
  });

  it("refuses a signature replayed onto a DIFFERENT RULING (reject signed, approve sent)", async () => {
    // The attack: capture a signed rejection, then send an approval with it.
    const res = await POST(request(reviewer, passing(), {}, reviewer, failing()), ctx());
    expect(res.status).toBe(401);
    untouched();
  });

  it("refuses a stale signature", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const res = await POST(
      postRequest({ reviewerAddress: reviewer.address, decision: failing(), proof: signRuling(reviewer, "task1", failing(), stale) }),
      ctx()
    );
    expect(res.status).toBe(401);
    untouched();
  });

  it("refuses a signature made for another task", async () => {
    const res = await POST(
      postRequest({ reviewerAddress: reviewer.address, decision: failing(), proof: signRuling(reviewer, "other-task", failing()) }),
      ctx()
    );
    expect(res.status).toBe(401);
    untouched();
  });
});

describe("the ruling must be complete", () => {
  it("refuses a ruling that skips a clause, without reading the chain", async () => {
    const partial = { clauses: [failing().clauses[0]], summary: "x" };
    const res = await POST(
      postRequest({ reviewerAddress: reviewer.address, decision: partial, proof: { signature: "x", issuedAt: new Date().toISOString() } }),
      ctx()
    );
    expect(res.status).toBe(400);
    // The MESSAGE matters: the dummy signature above is itself a 400 at the auth step,
    // so the status alone cannot tell which check refused it.
    expect((await res.json()).error).toMatch(/Rule on every clause/);
    expect(mocks.fetchTask).not.toHaveBeenCalled();
    untouched();
  });

  it("refuses a ruling with a clause and no reason", async () => {
    const noReason = { ...failing(), clauses: [failing().clauses[0], { index: 1, passed: false, reason: "  " }] };
    const res = await POST(
      postRequest({ reviewerAddress: reviewer.address, decision: noReason, proof: { signature: "x", issuedAt: new Date().toISOString() } }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Clause 2 needs a reason/);
    untouched();
  });

  it("404s for a task that does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await POST(request(), ctx());
    expect(res.status).toBe(404);
    untouched();
  });
});

describe("conflict of interest", () => {
  it("a reviewer cannot rule on a task they POSTED", async () => {
    task = makeTask({ creatorAddress: reviewer.address });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CONFLICT_OF_INTEREST");
    untouched();
  });

  it("a reviewer cannot rule on a task they WORKED on", async () => {
    task = makeTask({ workerAddress: reviewer.address });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CONFLICT_OF_INTEREST");
    untouched();
  });
});

describe("the same checks as the AI judge", () => {
  it("only a HELD task may be ruled on", async () => {
    task = makeTask({ state: "SUBMITTED" });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    untouched();
  });

  it("a task already decided is refused", async () => {
    task = makeTask({ state: "SETTLED" });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    untouched();
  });

  it("if the CHAIN says it is already decided, the row is reconciled and nothing settles", async () => {
    mocks.fetchTask.mockResolvedValue(makeOnChain({ state: "settled" }));
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "SETTLED" } }));
  });

  it("refuses if the chain says the task is not Submitted", async () => {
    mocks.fetchTask.mockResolvedValue(makeOnChain({ state: "open" }));
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
  });

  it("refuses if the chain cannot be read", async () => {
    mocks.fetchTask.mockRejectedValue(new Error("rpc down"));
    const res = await POST(request(), ctx());
    expect(res.status).toBe(503);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
  });

  it("refuses if the stored CLAUSES are not the sealed ones", async () => {
    task = makeTask({ clauses: [...CLAUSES.slice(0, 1), "A clause someone rewrote."] });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "HELD" }) }));
  });

  it("refuses if the stored SUBMISSION is not the one the worker committed", async () => {
    task = makeTask({ submissionContent: "something else entirely" });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    expect(mocks.sendVerdict).not.toHaveBeenCalled();
  });

  it("refuses without spending anything if the verifier cannot settle, and leaves the task alone", async () => {
    mocks.health.mockResolvedValue({ canSettle: false, ok: false, level: "empty", message: "wallet empty" });
    const res = await POST(request(), ctx());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("VERIFIER_UNAVAILABLE");
    untouched();
  });
});

describe("the outcome is derived, and it settles", () => {
  it("a failed clause means REJECTED: the poster is refunded, and the ruling names the reviewer", async () => {
    const res = await POST(request(reviewer, failing()), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("rejected");
    expect(body.state).toBe("REFUNDED");

    const call = mocks.sendVerdict.mock.calls[0][0];
    expect(call.approved).toBe(false);
    expect(call.confidence).toBe(100);
    expect(call.taskId).toBe(7n);

    const data = mocks.update.mock.calls.at(-1)![0].data;
    expect(data.state).toBe("REFUNDED");
    expect(data.heldReason).toBeNull();
    expect(data.txSettle).toBe("SIGNATURE");
    expect(data.verdictJson.model).toBe(reviewerModel(reviewer.address));
    expect(data.verdictJson.outcome).toBe("rejected");
  });

  it("the hash sent on-chain is the hash of the ruling that is stored and published", async () => {
    await POST(request(reviewer, failing()), ctx());
    const sent = mocks.sendVerdict.mock.calls[0][0].reasoningHash as Uint8Array;
    const stored = mocks.update.mock.calls.at(-1)![0].data.verdictJson;
    expect(Buffer.from(sent).toString("hex")).toBe(Buffer.from(hashVerdict(stored)).toString("hex"));
  });

  it("every clause passing means APPROVED: the worker is paid", async () => {
    const res = await POST(request(reviewer, passing()), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("SETTLED");
    expect(mocks.sendVerdict.mock.calls[0][0].approved).toBe(true);
  });

  it("a reviewer cannot approve a task with a failing clause by claiming `approved`", async () => {
    // The outcome is not an input. Smuggle both of the fields an attacker would try.
    const res = await POST(
      request(reviewer, { ...failing(), approved: true, outcome: "approved" } as never),
      ctx()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("rejected");
    expect(mocks.sendVerdict.mock.calls[0][0].approved).toBe(false);
  });

  it("never settles more than once for one request", async () => {
    await POST(request(), ctx());
    expect(mocks.sendVerdict).toHaveBeenCalledTimes(1);
  });
});

describe("when settlement fails", () => {
  beforeEach(() => {
    mocks.sendVerdict.mockRejectedValue(new Error("rpc: blockhash not found https://secret-rpc.example/?key=SECRET"));
  });

  it("leaves the task EXACTLY as it was: not marked operational, so the retry script cannot hand it to the AI", async () => {
    const res = await POST(request(), ctx());
    expect(res.status).toBe(502);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await res.json()).code).toBe("SETTLEMENT_FAILED");
  });

  it("never leaks the underlying error to the caller", async () => {
    const res = await POST(request(), ctx());
    expect(JSON.stringify(await res.json())).not.toMatch(/SECRET|secret-rpc|blockhash/);
  });

  it("but if the chain has ALREADY decided the task, the row is reconciled, not left stale", async () => {
    mocks.fetchTask
      .mockResolvedValueOnce(makeOnChain()) // the checks before settling
      .mockResolvedValueOnce(makeOnChain({ state: "refunded" })); // after the failure
    const res = await POST(request(), ctx());
    expect(res.status).toBe(409);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: "REFUNDED" } }));
  });
});

describe("keys", () => {
  it("the fixtures use distinct wallets", () => {
    expect(new Set([keys.creator, keys.worker, reviewer.address]).size).toBe(3);
  });
});
