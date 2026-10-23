/**
 * Which tasks are waiting on a verdict that is never going to arrive on its own?
 *
 * WHY THIS EXISTS
 * ---------------
 * Verification has exactly one trigger: the WORKER'S OWN BROWSER TAB, which calls
 * /api/tasks/[id]/verify right after submitting. If that call fails - the wallet
 * was empty, the RPC hiccuped, the judge errored - or the tab is simply closed
 * during a judge run that can take minutes, nothing ever calls it again. The task
 * sits in Submitted until the poster reclaims it a week after the deadline, which
 * means an honest worker is refunded-against for work nobody read.
 *
 * The route is idempotent and can be re-run at any time; what was missing is
 * anything that re-runs it. scripts/retry-stuck.ts does, and this module decides
 * WHICH tasks, as a pure function, because the script spends judge quota and a
 * wrong selection is expensive.
 *
 * WHAT COUNTS AS STUCK
 * --------------------
 *  - unjudged          SUBMITTED with a submission, and old enough that the
 *                      worker's own call has either finished or died. A task younger
 *                      than the minimum age is probably being judged RIGHT NOW, and
 *                      judging it twice at once wastes quota and can race.
 *  - operational-hold  HELD for OUR reasons (lib/holds.ts), meaning the judge ran
 *                      but settlement did not land. Re-running is the fix.
 *
 * Never selected: a task HELD for a judgement reason (a human is needed; retrying
 * would spend quota to reach the same answer), a task with no submission (the route
 * would refuse it), and anything terminal.
 */

import { isOperationalHold } from "./holds";

export type StuckKind = "unjudged" | "operational-hold";

/** The fields of a Task row this decision needs. */
export interface StuckRow {
  id: string;
  state: string;
  heldReason: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
  hasSubmission: boolean;
}

/** A Submitted task younger than this is presumed to be mid-judge. */
export const DEFAULT_MIN_AGE_MS = 5 * 60_000;

/**
 * The shortest age anything is ever retried at, whatever the caller asks for. It
 * stops two operators, or an operator and a worker's own tab, racing each other
 * into judging the same task twice at once.
 */
export const MIN_AGE_FLOOR_MS = 60_000;

export function classifyStuck(
  row: StuckRow,
  now: Date,
  minAgeMs: number = DEFAULT_MIN_AGE_MS
): StuckKind | null {
  if (!row.hasSubmission) return null;

  // One age rule for both kinds: the caller's minimum, never below the floor.
  const wait = Math.max(minAgeMs, MIN_AGE_FLOOR_MS);

  if (row.state === "SUBMITTED") {
    const since = (row.submittedAt ?? row.updatedAt).getTime();
    return now.getTime() - since >= wait ? "unjudged" : null;
  }

  if (row.state === "HELD" && isOperationalHold(row.heldReason)) {
    return now.getTime() - row.updatedAt.getTime() >= wait ? "operational-hold" : null;
  }

  return null;
}

export interface StuckTask<T extends StuckRow = StuckRow> {
  row: T;
  kind: StuckKind;
}

/** The stuck tasks, oldest first: the task that has waited longest is retried first. */
export function selectStuck<T extends StuckRow>(
  rows: T[],
  now: Date,
  minAgeMs: number = DEFAULT_MIN_AGE_MS
): Array<StuckTask<T>> {
  return rows
    .map((row) => ({ row, kind: classifyStuck(row, now, minAgeMs) }))
    .filter((x): x is StuckTask<T> => x.kind !== null)
    .sort(
      (a, b) =>
        (a.row.submittedAt ?? a.row.updatedAt).getTime() -
        (b.row.submittedAt ?? b.row.updatedAt).getTime()
    );
}
