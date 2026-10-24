import Link from "next/link";

import { Oracle } from "@/components/rig/Oracle";
import { DEFAULT_CONFIDENCE_THRESHOLD, LAUNCH_MAX_BOUNTY_BASE_UNITS } from "@/lib/constants";
import { EXAMPLE_HEADING, HERO_EXAMPLE } from "@/lib/landing-content";

/**
 * The landing hero.
 *
 * Two motions, in two places on purpose:
 *
 *   THE BACKGROUND is the plate field - full-bleed, fixed, mounted once in the
 *   root layout so it is the surface the whole product moves over. It is not
 *   part of this component at all.
 *
 *   THE RIGHT SIDE is the judge oracle, drawn straight onto the plate as a
 *   technical drawing and framed by corner ticks, with the field drifting
 *   through the wireframe behind it.
 *
 * There is no panel. Removing it required changing the INK rather than just
 * deleting a background: --marker is 1.26:1 on --page, so an oracle that merely
 * lost its dark ground would have lost the object with it. Every ink is remapped
 * to its light-ground equivalent and each clears 3:1 as a line, and the rig also
 * had to stop asking for an opaque WebGL context - an opaque canvas clears to
 * its ground colour and paints exactly the rectangle this removes.
 *
 * A second shader went with the panel. One ran inside it and one behind the
 * whole page; the page field is the background here now, which is one WebGL
 * context fewer and one less thing that can disagree with itself.
 */

/**
 * An EXAMPLE matter, labelled as one. It used to be named "Nº 42" after a seeded
 * record, which made it read as a real, checkable settled matter - true on a demo
 * deployment and false on mainnet, where a real matter 42 could exist and this would
 * have misdescribed it. The numbers are illustrative; the label says so.
 */
const HERO_MATTER = HERO_EXAMPLE;

export function VolumeHero() {
  return (
    <header className="vh">
      <nav className="vh-nav">
        <Link href="/" className="vh-mark">
          <span className="vh-mark-dot" aria-hidden="true" />
          RUBRIC
        </Link>

        <div className="vh-nav-links">
          <a href="#how-it-works">How it works</a>
          <Link href="/docket">The docket</Link>
          <a href="#verdict-log">Verdicts</a>
          <Link href="/docket" className="btn btn-primary">
            Open the docket
          </Link>
        </div>
      </nav>

      <div className="vh-body">
        {/* ---- left: the claim ---- */}
        <div className="vh-rail">
          <p className="label vh-eyebrow">AI-JUDGED ESCROW ON SOLANA</p>

          <h1 className="vh-title">
            Pay on proof,
            <br />
            not on trust.
          </h1>

          <p className="vh-lede">
            The acceptance criteria are hashed and locked on-chain before work
            starts. An AI judge rules on each sealed clause in the open, and the
            escrow only releases when every one of them passes.
          </p>

          <div className="vh-actions">
            <Link href="/docket" className="btn btn-primary">
              Open the docket
            </Link>
            <a href="#how-it-works" className="btn">
              How it works
            </a>
          </div>

          <dl className="vh-spec">
            {/* Launch values, labelled as such. The cap lives on-chain and the admin
                can change it, and the threshold is an environment setting, so a bare
                "MAX BOUNTY 50.00" is a number that stops being true the day either
                changes. They come from the constants, so they cannot drift from them.
                The live cap is on /create, read from the chain. */}
            <div>
              <dt className="label">LAUNCH CAP</dt>
              <dd className="data">{(LAUNCH_MAX_BOUNTY_BASE_UNITS / 1_000_000).toFixed(2)} USDC</dd>
            </div>
            <div>
              <dt className="label">DEFAULT THRESHOLD</dt>
              <dd className="data">{DEFAULT_CONFIDENCE_THRESHOLD}</dd>
            </div>
            <div>
              <dt className="label">VERIFIERS</dt>
              <dd className="data">1</dd>
            </div>
          </dl>
        </div>

        {/* ---- right: the instrument ---- */}
        <div className="vh-stage">
          {/* The wordmark the object sits ON.

              It used to hang off the stage's top-left corner, which put it
              above the sphere rather than behind it: the two never met, and
              because the letters ran off the top all you saw was the bottom of
              each one - six fragments that did not read as a word.

              Centred on the sphere, the relationship becomes the point. The
              word is the baseline and the object is suspended on it, and the
              overlap is what makes both read as deliberate.

              The wrapper clips. That is the treatment - letters bleeding off
              both edges look intentional in a way that a word politely fitted
              inside a box does not - and it is also structural: the type is
              deliberately WIDER than its column, and without a clip that would
              be horizontal overflow on the page. */}
          <div className="vh-ghostwrap" aria-hidden="true">
            <span className="vh-ghost">RUBRIC</span>
          </div>

          {/* The bracket frame sits OUTSIDE the viewport and is inset from it,
              so the panel reads as a thing held in a fixture rather than as a
              box with a decorated border. Corner ticks only - a full rule would
              just be a second border 12px from the first. */}
          <div className="vh-frame" aria-hidden="true">
            <span className="vh-corner vh-corner--tl" />
            <span className="vh-corner vh-corner--tr" />
            <span className="vh-corner vh-corner--bl" />
            <span className="vh-corner vh-corner--br" />
          </div>

          <div className="vh-volume">
            <Oracle
              className="vh-oracle"
              surface="plate"
              // The full-bleed field is genuinely behind this one - nothing
              // between it and the fixed canvas paints a background - so the
              // core's additive glow has a lower ceiling here than on the app
              // screens, where AppShell paints an opaque --page over the field.
              fieldBacked
              state="SETTLED"
              confidence={HERO_MATTER.confidence}
              threshold={HERO_MATTER.threshold}
              clauseCount={HERO_MATTER.clauses}
              passedCount={HERO_MATTER.passed}
            />

            {/* The readout. It sits in the same mono face as figures the user is
                asked to verify, so it does not get to state a fact that is not real.
                The reference this came from printed "LOCATING TRUTH VECTORS...
                CONFIDENCE: 99.9%", a number about nothing. These numbers describe
                the matter the object is drawing, and that matter is an EXAMPLE, said
                first: it is not a real record on this or any deployment. */}
            <div className="vh-hud telemetry" aria-hidden="true">
              <div>
                <span className="vh-hud-key">{EXAMPLE_HEADING}</span> MATTER
              </div>
              <div>
                CONF <span className="vh-hud-key">{HERO_MATTER.confidence}</span>{" "}
                / {HERO_MATTER.threshold}
              </div>
              <div>
                CLAUSES{" "}
                <span className="vh-hud-key">
                  {HERO_MATTER.passed}/{HERO_MATTER.clauses}
                </span>{" "}
                PASS
              </div>
              <div className="vh-hud-state">SOLVE LOCKED</div>
            </div>
          </div>

          {/* The same statement in text, for a reader who gets none of the
              above: the readout is aria-hidden because it is a duplicate. */}
          <p className="sr-only">
            The instrument shows an example matter, not a real one: {HERO_MATTER.passed}{" "}
            of {HERO_MATTER.clauses} sealed clauses passed, at confidence{" "}
            {HERO_MATTER.confidence} against a threshold of {HERO_MATTER.threshold},
            and the escrow was released.
          </p>
        </div>
      </div>
    </header>
  );
}
