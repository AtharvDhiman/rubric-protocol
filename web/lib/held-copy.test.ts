import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { VERDICT_GRACE_MS, holdCopy, reclaimOpensAt, type HoldCopyInput } from "./held-copy";

const DAY = 24 * 60 * 60 * 1000;
const DEADLINE = new Date("2026-10-23T12:00:00Z");
const RECLAIM = reclaimOpensAt(DEADLINE);

const input = (over: Partial<HoldCopyInput> = {}): HoldCopyInput => ({
  operational: false,
  reclaimAt: RECLAIM,
  now: new Date(DEADLINE.getTime() - DAY),
  formatDate: (d) => d.toISOString().slice(0, 10),
  ...over,
});

const allText = (c: ReturnType<typeof holdCopy>) =>
  [c.lead, c.detail, c.notRejected, c.next ?? "", c.deadline].join(" ");

describe("the grace period", () => {
  it("is seven days after the deadline", () => {
    expect(RECLAIM.getTime() - DEADLINE.getTime()).toBe(7 * DAY);
    expect(VERDICT_GRACE_MS).toBe(7 * DAY);
  });

  it("matches the program's VERDICT_GRACE_SECONDS, so the screen cannot show a wrong date", () => {
    // The program is Rust, so the constant is mirrored. Read the source and compare:
    // a changed program constant fails here rather than quietly mis-dating the page.
    const rust = fs.readFileSync(path.join(process.cwd(), "..", "programs", "rubric", "src", "constants.rs"), "utf8");
    const match = rust.match(
      /#\[cfg\(not\(feature = "short-grace"\)\)\]\s*pub const VERDICT_GRACE_SECONDS: i64 = ([\d\s*]+);/
    );
    expect(match, "could not find the default VERDICT_GRACE_SECONDS in constants.rs").not.toBeNull();
    const seconds = match![1]
      .split("*")
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1);
    expect(seconds * 1000).toBe(VERDICT_GRACE_MS);
  });
});

describe("what a hold says", () => {
  it("a judgement hold says nothing was decided and the escrow is untouched", () => {
    const c = holdCopy(input());
    expect(c.lead).toBe("Nothing has been decided.");
    expect(c.detail).toMatch(/escrow is untouched/);
    expect(c.detail).toMatch(/nobody has been paid and nobody has been refunded/);
  });

  it("an operational hold says plainly that it is NOT a ruling on the work", () => {
    const c = holdCopy(input({ operational: true }));
    expect(c.lead).toBe("This is not a ruling on the work.");
    expect(c.detail).toMatch(/reason on our side/);
    expect(c.detail).toMatch(/nobody has been paid and nobody has been refunded/);
  });

  it("both distinguish a hold from a rejection", () => {
    for (const operational of [false, true]) {
      const c = holdCopy(input({ operational }));
      expect(c.notRejected).toMatch(/not a rejection/);
      expect(c.notRejected).toMatch(/refunds the poster/);
      expect(c.notRejected).toMatch(/decides nothing/);
    }
  });

  it("an operational hold says what can be done; a judgement hold promises nothing", () => {
    expect(holdCopy(input({ operational: true })).next).toMatch(/can be run again/);
    expect(holdCopy(input({ operational: false })).next).toBeNull();
  });
});

describe("it never promises what the system does not do", () => {
  it("makes no promise of a reviewer, a re-run or a retry", () => {
    // These are the sentences that used to be on the page. Nothing assigned a
    // reviewer, and nothing re-ran judging unless an operator ran a script.
    for (const operational of [false, true]) {
      for (const now of [new Date(DEADLINE.getTime() - DAY), new Date(RECLAIM.getTime() + DAY)]) {
        const text = allText(holdCopy(input({ operational, now })));
        expect(text, `operational=${operational}`).not.toMatch(/will review|a person will|will be re-?run|will be judged again|will be retried/i);
      }
    }
  });
});

describe("the reclaim date", () => {
  it("names the date while it is still in the future", () => {
    const c = holdCopy(input());
    expect(c.deadline).toContain("2026-10-30");
    expect(c.deadline).toMatch(/If this is still undecided on/);
  });

  it("says 'now' once the program would accept a reclaim", () => {
    const c = holdCopy(input({ now: new Date(RECLAIM.getTime() + 1) }));
    expect(c.deadline).toMatch(/can reclaim the bounty now/);
    expect(c.deadline).not.toMatch(/2026-10-30/);
  });

  it("is strict, exactly like the program: at the instant itself it is still in the future", () => {
    // reclaim_expired requires `now > deadline + grace`, not >=.
    const c = holdCopy(input({ now: new Date(RECLAIM.getTime()) }));
    expect(c.deadline).toMatch(/If this is still undecided on/);
  });

  it("says plainly that the reclaim does not depend on the work being bad", () => {
    for (const now of [new Date(DEADLINE.getTime() - DAY), new Date(RECLAIM.getTime() + DAY)]) {
      expect(holdCopy(input({ now })).deadline).toMatch(/whatever the merit of the work/);
    }
  });
});
