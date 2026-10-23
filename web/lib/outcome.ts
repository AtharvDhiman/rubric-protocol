/**
 * Was a refund a RULING against the work, or just the money going home?
 *
 * A task reaches REFUNDED two ways that look identical in the state column:
 *
 *   1. The judge rejected it. The verdict says so and the poster was refunded.
 *   2. The poster reclaimed it (reclaim_expired) after the deadline and grace period,
 *      with the task still undecided. No one ruled against the work.
 *
 * The second leaves the old verdict in place: a task held for a judgement reason keeps
 * its stored `needs_manual_review` verdict, with `approved: false`. Reading `approved`
 * alone therefore stamps REJECTED, and animates a rejection, across a task the judge
 * never rejected. That is the HELD-versus-REJECTED confusion at its worst, because it
 * is permanent: the record would say the work was found wanting when nobody decided.
 *
 * So the question is asked of the verdict's own `outcome`, which the judge publishes:
 * only "rejected" is a ruling against the work.
 */

export type StoredOutcome = "approved" | "rejected" | "needs_manual_review";

/**
 * The published verdict's outcome, or null if there is no verdict or it predates the
 * field. Older records and the seeded samples carry `approved` but no `outcome`.
 */
export function storedOutcome(verdictJson: unknown): StoredOutcome | null {
  if (typeof verdictJson !== "object" || verdictJson === null) return null;
  const outcome = (verdictJson as { outcome?: unknown }).outcome;
  return outcome === "approved" || outcome === "rejected" || outcome === "needs_manual_review"
    ? outcome
    : null;
}

/**
 * True only if the refund was the judge ruling that a clause failed.
 *
 * With an `outcome` it is taken at its word. Without one (a legacy record) a stored
 * `approved: false` is the only evidence there is, and it is read as a rejection, since
 * before holds stored their own outcome a stored not-approved verdict was a rejection.
 * No verdict at all is NOT a rejection.
 */
export function refundWasRuling(verdictJson: unknown): boolean {
  const outcome = storedOutcome(verdictJson);
  if (outcome !== null) return outcome === "rejected";
  if (typeof verdictJson !== "object" || verdictJson === null) return false;
  return (verdictJson as { approved?: unknown }).approved === false;
}
