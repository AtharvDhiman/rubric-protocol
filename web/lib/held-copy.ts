/**
 * The words on the screen when a task is held, and the date it can be reclaimed.
 *
 * WHY THIS IS A MODULE
 * --------------------
 * A held task is the state people misread. It is not a rejection, nobody has been
 * paid, nobody has been refunded, and it looks like "the AI is broken" if it is not
 * explained. The copy is therefore tested, because the failure it guards against is
 * a sentence that promises something the system does not do.
 *
 * It used to say "a person will review it" and "judging will be re-run". Neither was
 * true: there was no reviewer, and nothing re-ran judging unless an operator ran a
 * script. A reader who is told a person will look at it waits for one. So the rule
 * here is: say only what happens regardless, and add a promise only when something
 * exists to keep it.
 *
 * What does happen regardless, and is stated: the escrow stays locked, and once the
 * deadline plus the grace period has passed the poster can reclaim the bounty,
 * whatever the merit of the work. That is the program's rule (reclaim_expired), and
 * it is the honest timeout for an undecided task. It is stated plainly, including
 * that it can go against a worker whose work was fine.
 */

/**
 * The program's VERDICT_GRACE_SECONDS, the wait after the deadline before a poster may
 * reclaim a task that was submitted but never decided. Mirrored, not imported: the
 * program is Rust. A test reads constants.rs and fails if the two ever differ.
 */
export const VERDICT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** When the poster of a submitted-but-undecided task may reclaim it. */
export function reclaimOpensAt(deadline: Date): Date {
  return new Date(deadline.getTime() + VERDICT_GRACE_MS);
}

export interface HoldCopy {
  /** What this is, in one bold sentence. */
  lead: string;
  /** The rest of what a hold means for the work and the money. */
  detail: string;
  /** Held is not rejected. */
  notRejected: string;
  /** What can be done about it, or null when nothing is promised. */
  next: string | null;
  /** What happens if nobody resolves it: the poster's reclaim. */
  deadline: string;
}

export interface HoldCopyInput {
  /** True when the judge could not be asked or settlement did not land (lib/holds.ts). */
  operational: boolean;
  /** When the poster may reclaim the bounty (see reclaimOpensAt). */
  reclaimAt: Date;
  now: Date;
  formatDate: (date: Date) => string;
}

export function holdCopy({ operational, reclaimAt, now, formatDate }: HoldCopyInput): HoldCopy {
  // The program requires `now > deadline + grace`, strictly. Match it, so the screen
  // never says "now" a moment before the chain would agree.
  const open = now.getTime() > reclaimAt.getTime();

  return {
    lead: operational ? "This is not a ruling on the work." : "Nothing has been decided.",
    detail: operational
      ? "The judge could not be asked, or could not finish settling, for a reason on our side, so nothing has been decided. The escrow is untouched: nobody has been paid and nobody has been refunded."
      : "The judge could not settle this submission on its own. The escrow is untouched: nobody has been paid and nobody has been refunded.",
    notRejected:
      "A hold is not a rejection. A rejection is a ruling that a sealed clause failed, and it refunds the poster. A hold decides nothing.",
    next: operational ? "Once the cause is fixed, judging can be run again." : null,
    deadline: open
      ? "The poster can reclaim the bounty now, whatever the merit of the work."
      : `If this is still undecided on ${formatDate(reclaimAt)}, the poster can reclaim the bounty, whatever the merit of the work.`,
  };
}
