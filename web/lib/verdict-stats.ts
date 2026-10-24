/**
 * Which decided tasks count as a VERDICT on the docket's headline figures.
 *
 * "Verdicts today" and "median time to verdict" are both claims about the judge, so the
 * only tasks that may feed them are ones the judge (or a reviewer) actually ruled on:
 *
 *   - SETTLED: always a ruling. The verdict approved the work and the escrow was paid.
 *   - REFUNDED: a ruling only if the stored verdict is a rejection (`refundWasRuling`).
 *     The poster can also reclaim an UNDECIDED task after the deadline and grace period,
 *     which also lands in REFUNDED. That is the money going home, not a verdict.
 *
 * Counting on `state` alone gets the second case wrong in two ways. A task held for a
 * judgement reason keeps the `decidedAt` from when the hold was recorded, so a later
 * reclaim would be counted as a verdict on the day it was HELD. And its hold-to-submit
 * gap would enter the median, stretching a figure that is supposed to be how fast the
 * judge answers.
 *
 * Pure and dependency-free on purpose, so the page can use it for both the database and
 * the demo branch and the rule is tested once.
 */

import { refundWasRuling } from "./outcome";

/** The fields of a task row these figures read. A Prisma `Task` and a `DemoTask` both fit. */
export interface DecisionRecord {
  state: string;
  verdictJson: unknown;
  decidedAt: Date | null;
  submittedAt: Date | null;
}

/**
 * True if this task is a real verdict with a time on it.
 *
 * A task without a `decidedAt` has no verdict time, so it cannot be placed in a day or
 * timed, whatever its state says.
 */
export function countsAsVerdict<T extends DecisionRecord>(
  task: T
): task is T & { decidedAt: Date } {
  if (task.decidedAt === null) return false;
  if (task.state === "SETTLED") return true;
  return task.state === "REFUNDED" && refundWasRuling(task.verdictJson);
}

/** How many verdicts were decided at or after `since` (inclusive, like Prisma's `gte`). */
export function verdictsSince(tasks: readonly DecisionRecord[], since: Date): number {
  return tasks.filter(
    (task) => countsAsVerdict(task) && task.decidedAt.getTime() >= since.getTime()
  ).length;
}

/**
 * Median seconds from submission to verdict, or null if there is nothing to measure.
 *
 * A negative gap (decided before submitted) can only be clock skew, not a real duration,
 * and is dropped. Whole seconds, since that is how the figure is printed.
 */
export function medianVerdictSeconds(tasks: readonly DecisionRecord[]): number | null {
  const durations: number[] = [];
  for (const task of tasks) {
    if (!countsAsVerdict(task) || task.submittedAt === null) continue;
    const seconds = (task.decidedAt.getTime() - task.submittedAt.getTime()) / 1000;
    if (seconds >= 0) durations.push(seconds);
  }
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  return Math.round(durations[Math.floor(durations.length / 2)]);
}
