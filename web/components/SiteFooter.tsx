import { SolanaMark } from "@/components/SolanaMark";

/**
 * The wordmark footer. One component, every page.
 *
 * A hatched band with the name cut into it as outline type. The wordmark is the
 * same technique as the hero ghost - transparent fill, a stroked edge - so the
 * page opens and closes on the same gesture at two different scales.
 *
 * Two things here are decided by measurement rather than by eye:
 *
 * THE HATCH IS 16%. It darkens the ground it is drawn on, and footer text sits
 * on top of it, so its strength is bounded by the worst text that has to survive
 * it. At 16% of --hairline mixed into --page the ground falls to luminance
 * 0.599, which still gives --text-muted 5.26:1. It is not a free decoration; it
 * spends contrast.
 *
 * THE LABELS MOVED UP A STEP. They were --text-faint, which is 4.92:1 on the
 * bare plate and fails at even a 10% hatch (4.47:1). Rather than thin the hatch
 * until the faintest ink survived, the text takes the next step down in the
 * ramp: --text-muted, with room to spare. The hatch made a text decision, which
 * is the correct direction for that argument.
 */

export function SiteFooter() {
  return (
    <footer className="wf">
      {/* The hatch and the wordmark are texture. The name is already announced
          by the nav on every page, so neither is read out again here. */}
      <div className="wf-hatch" aria-hidden="true" />

      <div className="wf-inner">
        <p className="label wf-eyebrow">Pay on proof, not on trust</p>

        {/* Clipped, so the type can be sized against the band without a wide
            glyph ever becoming horizontal overflow on the page. */}
        <div className="wf-markwrap" aria-hidden="true">
          <span className="wf-mark">RUBRIC</span>
        </div>

        <div className="wf-facts">
          <span className="wf-fact">
            <SolanaMark size={14} />
            <span className="label">BUILT ON SOLANA · USDC ESCROW</span>
          </span>
          <span className="label">RUBRIC PROTOCOL</span>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
