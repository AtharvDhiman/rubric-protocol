/**
 * runVerdict under failure: what kind of hold an outage is, and when a fallback model
 * may be asked.
 *
 * Offline: the model call, the clock and the jitter are all faked, so these run on
 * every `npm test`. The two properties that matter most are pinned here.
 *
 *  1. An outage is not a ruling. Quota, a timeout or an unreachable judge produce an
 *     OPERATIONAL hold, which the app does not present as the judge's view of the work.
 *  2. A fallback model is asked only when the first gave NO answer. Never because of
 *     what it said. That is the difference between resilience and judge-shopping.
 */

import { afterEach, describe, expect, it } from "vitest";
import { runVerdict, type JudgeResponse, type RunVerdictOptions } from "./verifier";

const RUBRIC = {
  title: "Two clauses",
  clauses: ["The submission mentions blue.", "The submission mentions green."],
};
const SUB = {
  workerAddress: "4kTkVfPqXn1s8pQx9hZmR3wJdG7bN2cY6vL5tA8wHK",
  content: "blue and green",
};

const PRIMARY = "primary-model";
const FALLBACK = "fallback-model";

const ruling = (over: Record<string, unknown> = {}): JudgeResponse => ({
  kind: "ok",
  value: {
    approved: true,
    confidence: 95,
    summary: "Both clauses are satisfied.",
    clauses: [
      { index: 0, passed: true, reason: "It says blue." },
      { index: 1, passed: true, reason: "It says green." },
    ],
    ...over,
  },
});

const lowConfidence = ruling({ confidence: 40 });
const confidentRejection = ruling({
  approved: false,
  confidence: 95,
  clauses: [
    { index: 0, passed: true, reason: "It says blue." },
    { index: 1, passed: false, reason: "No mention of green." },
  ],
});
const refused: JudgeResponse = { kind: "refused" };
const unusable: JudgeResponse = { kind: "unusable", reason: "The judge's response was not valid JSON." };
const quota = () => Object.assign(new Error("429 RESOURCE_EXHAUSTED"), { status: 429 });
const network = () => new TypeError("fetch failed");

type Reply = JudgeResponse | Error;

/** Scripted replies per model; the last reply repeats. Records which models were asked. */
function judge(script: Record<string, Reply[]>) {
  const calls: string[] = [];
  const seen: Record<string, number> = {};
  const ask: NonNullable<RunVerdictOptions["ask"]> = async (_provider, model) => {
    calls.push(model);
    const list = script[model] ?? [];
    const i = (seen[model] = (seen[model] ?? 0) + 1);
    const reply = list[Math.min(i - 1, list.length - 1)];
    if (!reply) throw new Error(`no scripted reply for ${model}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { ask, calls, count: (m: string) => calls.filter((c) => c === m).length };
}

const run = (script: Record<string, Reply[]>, options: RunVerdictOptions = {}) => {
  const j = judge(script);
  return runVerdict(RUBRIC, SUB, {
    provider: "gemini",
    model: PRIMARY,
    fallbackModel: null,
    ask: j.ask,
    sleep: async () => {},
    random: () => 0.5,
    ...options,
  }).then((result) => ({ result, ...j }));
};

describe("an outage is an operational hold, never a ruling", () => {
  it("quota: held, operational, says so, and approves nothing", async () => {
    const { result } = await run({ [PRIMARY]: [quota()] });
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.holdKind).toBe("operational");
    expect(result.approved).toBe(false);
    expect(result.heldReason).toMatch(/out of API quota/);
    expect(result.heldReason).toMatch(/nothing has been decided/);
  });

  it("an unreachable judge: held, operational", async () => {
    const { result } = await run({ [PRIMARY]: [network()] });
    expect(result.holdKind).toBe("operational");
    expect(result.heldReason).toMatch(/could not be reached/);
  });

  it("a timeout: held, operational", async () => {
    const { result } = await run({ [PRIMARY]: [new Error("The judge did not respond within 45000ms.")] });
    expect(result.holdKind).toBe("operational");
    expect(result.heldReason).toMatch(/did not answer in time/);
  });

  it("quota with no stated wait is not retried on the same model", async () => {
    const { count } = await run({ [PRIMARY]: [quota()] });
    expect(count(PRIMARY)).toBe(1);
  });

  it("a transient failure is retried, and a good answer afterwards stands", async () => {
    const { result, count } = await run({ [PRIMARY]: [network(), ruling()] });
    expect(result.outcome).toBe("approved");
    expect(count(PRIMARY)).toBe(2);
  });

  it("never carries an invented ruling: no confidence, no clauses", async () => {
    const { result } = await run({ [PRIMARY]: [quota()] });
    expect(result.confidence).toBe(0);
    expect(result.clauses).toEqual([]);
  });
});

describe("a judgement hold is not an outage", () => {
  it("a refusal is a judgement hold", async () => {
    const { result } = await run({ [PRIMARY]: [refused] });
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.holdKind).toBe("judgement");
  });

  it("output that is never usable is a judgement hold, with the reason", async () => {
    const { result } = await run({ [PRIMARY]: [unusable] });
    expect(result.holdKind).toBe("judgement");
    expect(result.heldReason).toMatch(/not valid JSON/);
  });

  it("a reply that fails the schema is unusable: it is never trusted as a ruling", async () => {
    // The provider may claim to enforce the schema. The judge validates regardless.
    const { result } = await run({ [PRIMARY]: [{ kind: "ok", value: { approved: true } }] });
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.approved).toBe(false);
    expect(result.holdKind).toBe("judgement");
    expect(result.heldReason).toMatch(/schema validation/);
  });

  it("low confidence is a judgement hold", async () => {
    const { result } = await run({ [PRIMARY]: [lowConfidence] });
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.holdKind).toBe("judgement");
    expect(result.confidence).toBe(40);
  });

  it("an approval or a rejection has no hold kind at all", async () => {
    expect((await run({ [PRIMARY]: [ruling()] })).result.holdKind).toBeUndefined();
    expect((await run({ [PRIMARY]: [confidentRejection] })).result.holdKind).toBeUndefined();
  });

  it("unusable output on one model and quota on the other is still OUR outage", async () => {
    const { result } = await run(
      { [PRIMARY]: [unusable], [FALLBACK]: [quota()] },
      { fallbackModel: FALLBACK }
    );
    expect(result.holdKind).toBe("operational");
  });
});

describe("the fallback model", () => {
  const withFallback = { fallbackModel: FALLBACK };

  it("rules when the primary is out of quota, and the verdict names the model that ruled", async () => {
    const { result, calls } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.outcome).toBe("approved");
    expect(result.model).toBe(FALLBACK);
    expect(result.published.model).toBe(FALLBACK);
    expect(calls).toEqual([PRIMARY, FALLBACK]);
  });

  it("rules when the primary is down", async () => {
    const { result } = await run({ [PRIMARY]: [network()], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.outcome).toBe("approved");
    expect(result.model).toBe(FALLBACK);
  });

  it("JUDGE-SHOPPING: a low-confidence ruling is NOT sent to the fallback", async () => {
    // The fallback would happily approve. It must never be asked.
    const { result, count } = await run({ [PRIMARY]: [lowConfidence], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.holdKind).toBe("judgement");
    expect(count(FALLBACK)).toBe(0);
    expect(result.model).toBe(PRIMARY);
  });

  it("JUDGE-SHOPPING: a confident REJECTION is not sent to the fallback either", async () => {
    const { result, count } = await run({ [PRIMARY]: [confidentRejection], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.outcome).toBe("rejected");
    expect(count(FALLBACK)).toBe(0);
  });

  it("JUDGE-SHOPPING: a refusal is not sent to the fallback", async () => {
    const { result, count } = await run({ [PRIMARY]: [refused], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.holdKind).toBe("judgement");
    expect(count(FALLBACK)).toBe(0);
  });

  it("JUDGE-SHOPPING: a self-contradicting ruling is held, not re-asked", async () => {
    const contradictory = ruling({
      approved: true,
      clauses: [
        { index: 0, passed: true, reason: "It says blue." },
        { index: 1, passed: false, reason: "No mention of green." },
      ],
    });
    const { result, count } = await run({ [PRIMARY]: [contradictory], [FALLBACK]: [ruling()] }, withFallback);
    expect(result.outcome).toBe("needs_manual_review");
    expect(count(FALLBACK)).toBe(0);
  });

  it("the fallback's own ruling goes through the SAME guards: low confidence still holds", async () => {
    const { result } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [lowConfidence] }, withFallback);
    expect(result.outcome).toBe("needs_manual_review");
    expect(result.holdKind).toBe("judgement");
    expect(result.model).toBe(FALLBACK);
  });

  it("the fallback can never approve a task whose clauses did not all pass", async () => {
    const { result } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [confidentRejection] }, withFallback);
    expect(result.approved).toBe(false);
    expect(result.outcome).toBe("rejected");
  });

  it("both models out of quota: held as an operational hold", async () => {
    const { result, calls } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [quota()] }, withFallback);
    expect(result.holdKind).toBe("operational");
    expect(calls).toEqual([PRIMARY, FALLBACK]);
  });

  it("is off unless configured", async () => {
    const { count } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [ruling()] }, { fallbackModel: null });
    expect(count(FALLBACK)).toBe(0);
  });

  it("a fallback equal to the primary is ignored", async () => {
    const { calls } = await run({ [PRIMARY]: [quota()] }, { fallbackModel: PRIMARY });
    expect(calls).toEqual([PRIMARY]);
  });

  it("is Gemini only: with the Anthropic provider it is ignored", async () => {
    const { calls } = await run({ [PRIMARY]: [quota()], [FALLBACK]: [ruling()] }, { provider: "anthropic", fallbackModel: FALLBACK });
    expect(calls).toEqual([PRIMARY]);
  });
});

describe("the fallback from the environment", () => {
  const saved = process.env.JUDGE_FALLBACK_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.JUDGE_FALLBACK_MODEL;
    else process.env.JUDGE_FALLBACK_MODEL = saved;
  });

  it("is used when the option is not given", async () => {
    process.env.JUDGE_FALLBACK_MODEL = FALLBACK;
    const j = judge({ [PRIMARY]: [quota()], [FALLBACK]: [ruling()] });
    const result = await runVerdict(RUBRIC, SUB, {
      provider: "gemini",
      model: PRIMARY,
      ask: j.ask,
      sleep: async () => {},
      random: () => 0.5,
    });
    expect(result.model).toBe(FALLBACK);
  });

  it("an explicit null overrides the environment", async () => {
    process.env.JUDGE_FALLBACK_MODEL = FALLBACK;
    const j = judge({ [PRIMARY]: [quota()], [FALLBACK]: [ruling()] });
    await runVerdict(RUBRIC, SUB, {
      provider: "gemini",
      model: PRIMARY,
      fallbackModel: null,
      ask: j.ask,
      sleep: async () => {},
      random: () => 0.5,
    });
    expect(j.count(FALLBACK)).toBe(0);
  });
});

describe("the time budget", () => {
  it("stops, and holds as operational, rather than running past its allowance", async () => {
    let t = 0;
    const slow: NonNullable<RunVerdictOptions["ask"]> = async () => {
      t += 45_000;
      throw network();
    };
    const result = await runVerdict(RUBRIC, SUB, {
      provider: "gemini",
      model: PRIMARY,
      fallbackModel: null,
      ask: slow,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      random: () => 0.5,
      resilience: { budgetMs: 100_000 },
    });
    expect(result.holdKind).toBe("operational");
    expect(t).toBeLessThanOrEqual(100_000);
  });
});
