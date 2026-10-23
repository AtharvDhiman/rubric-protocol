/**
 * The verdict stamp. The ONE permitted tilt in the product.
 *
 * Accessibility: the stamp itself is aria-hidden, and the same status is
 * emitted as visually-hidden text. Nothing in this app depends on colour alone -
 * every status colour is paired with a word.
 */

export type StampVariant =
  | "approved"
  | "rejected"
  | "sealed"
  | "held"
  | "open"
  | "inReview"
  | "paid"
  | "expired"
  | "refunded"
  | "submitted";

const LABELS: Record<StampVariant, string> = {
  approved: "Approved",
  rejected: "Rejected",
  // The money went back to the poster and nobody ruled against the work (see
  // lib/outcome.ts). Deliberately plain: it is true however the refund came about.
  refunded: "Refunded",
  sealed: "Sealed",
  held: "Held",
  open: "Open",
  inReview: "In review",
  paid: "Paid",
  expired: "Expired",
  submitted: "In review",
};

const CLASSES: Record<StampVariant, string> = {
  approved: "stamp-approved",
  rejected: "stamp-rejected",
  sealed: "stamp-sealed",
  held: "stamp-held",
  open: "stamp-open",
  inReview: "stamp-inreview",
  paid: "stamp-paid",
  expired: "stamp-expired",
  // Same ink as expired, so no new colour and no new contrast pair to prove. The
  // word is what carries the meaning, as it does for every status.
  refunded: "stamp-expired",
  submitted: "stamp-inreview",
};

export function Stamp({
  variant,
  small = false,
  large = false,
}: {
  variant: StampVariant;
  small?: boolean;
  /** The verdict sheet's headline stamp. The only one that carries a glow. */
  large?: boolean;
}) {
  const label = LABELS[variant];
  const size = small ? "stamp-sm" : large ? "stamp-lg" : "";
  return (
    <>
      <span
        aria-hidden="true"
        className={`stamp ${size} ${CLASSES[variant]}`}
      >
        {label}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * Map a task state string from the API onto a stamp variant.
 *
 * `ruledRefund` says whether a REFUNDED task was refunded by the judge REJECTING it,
 * as opposed to the poster reclaiming an undecided task (lib/outcome.ts). It defaults
 * to false, so a caller that does not know stamps the plain, always-true "Refunded"
 * and never claims a rejection nobody made.
 */
export function stampForState(state: string, ruledRefund = false): StampVariant {
  switch (state) {
    case "OPEN":
      return "open";
    case "SUBMITTED":
      return "inReview";
    case "SETTLED":
      return "approved";
    case "REFUNDED":
      return ruledRefund ? "rejected" : "refunded";
    case "HELD":
      return "held";
    default:
      return "open";
  }
}
