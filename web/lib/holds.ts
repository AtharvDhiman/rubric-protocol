/**
 * Two different reasons a task can be HELD, kept apart without a database change.
 *
 * A task is HELD for one of two very different reasons, and until now they were
 * indistinguishable:
 *
 *   JUDGEMENT   the judge looked at the work and could not decide, or the evidence
 *               does not match what was sealed. A human is needed. This is a
 *               statement about the WORK.
 *
 *   OPERATIONAL the judge ran but the settlement could not be paid for or did not
 *               land - an empty verifier wallet, a bad RPC, a key the chain does
 *               not trust. Nothing about the work was decided, and re-running
 *               fixes it. This is a statement about OUR infrastructure.
 *
 * Showing an operational failure as "the judge was not confident enough" tells a
 * poster and a worker that their work was found wanting when nobody has read it
 * into a verdict at all. It also hides the cause from whoever could fix it.
 *
 * WHY A PREFIX AND NOT A COLUMN
 * -----------------------------
 * A column means `prisma db push` against the production database, which is a
 * decision for the person who owns it, taken deliberately and not as a side effect
 * of a feature. `heldReason` is already a free-text field shown to the user, so the
 * kind travels in the text itself, in one place, behind these functions. If a
 * column is ever added, these are the only three things that change.
 */

const OPERATIONAL_PREFIX = "[operational] ";

/** Mark a reason as operational. Idempotent: it never stacks prefixes. */
export function operationalHold(detail: string): string {
  return isOperationalHold(detail) ? detail : OPERATIONAL_PREFIX + detail;
}

/** Whether a held task is held for OUR reasons rather than a judgement about the work. */
export function isOperationalHold(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(OPERATIONAL_PREFIX);
}

/** The sentence a person should read: the reason with the marker removed. */
export function holdDetail(reason: string | null | undefined): string {
  if (typeof reason !== "string") return "";
  return isOperationalHold(reason) ? reason.slice(OPERATIONAL_PREFIX.length) : reason;
}
