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
  | "submitted";

const LABELS: Record<StampVariant, string> = {
  approved: "Approved",
  rejected: "Rejected",
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

/** Map a task state string from the API onto a stamp variant. */
export function stampForState(state: string): StampVariant {
  switch (state) {
    case "OPEN":
      return "open";
    case "SUBMITTED":
      return "inReview";
    case "SETTLED":
      return "approved";
    case "REFUNDED":
      return "rejected";
    case "HELD":
      return "held";
    default:
      return "open";
  }
}
