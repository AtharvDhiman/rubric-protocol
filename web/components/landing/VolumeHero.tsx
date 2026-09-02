import Link from "next/link";

import { ShaderField } from "@/components/rig/ShaderField";
import { Oracle } from "@/components/rig/Oracle";

/**
 * The landing hero.
 *
 * Two motions, and they sit in different places on purpose:
 *
 *   THE BACKGROUND is the plate field - full-bleed, fixed, mounted once in the
 *   root layout so it is the surface the whole product moves over. It is not
 *   part of this component at all.
 *
 *   THE RIGHT SIDE is the instrument: a bounded dark viewport carrying the
 *   judge oracle, framed by corner brackets and annotated by a readout.
 *
 * The dark ground is bounded rather than full-bleed, and that is a rule rather
 * than a preference: --marker measures 1.26:1 on the light page, so the volume
 * inks are only legible inside a panel that redefines the ground under them.
 * A hero background is a mood; a bracketed viewport with a datum readout is an
 * instrument you are looking into.
 */

/** Matter Nº 42 in lib/demo.ts: SETTLED, 3 clauses, all passing, confidence 94. */
const HERO_MATTER = {
  n: "0042",
  confidence: 94,
  threshold: 70,
  clauses: 3,
  passed: 3,
} as const;

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
            <div>
              <dt className="label">MAX BOUNTY</dt>
              <dd className="data">50.00 USDC</dd>
            </div>
            <div>
              <dt className="label">THRESHOLD</dt>
              <dd className="data">70</dd>
            </div>
            <div>
              <dt className="label">VERIFIERS</dt>
              <dd className="data">1</dd>
            </div>
          </dl>
        </div>

        {/* ---- right: the instrument ---- */}
        <div className="vh-stage">
          <span className="vh-ghost" aria-hidden="true">
            RUBRIC
          </span>

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

          <div className="volume vh-volume">
            <ShaderField className="vh-field" />
            <Oracle
              className="vh-oracle"
              state="SETTLED"
              confidence={HERO_MATTER.confidence}
              threshold={HERO_MATTER.threshold}
              clauseCount={HERO_MATTER.clauses}
              passedCount={HERO_MATTER.passed}
            />

            {/* The readout. Every figure here is a real property of the matter
                the object is drawing - Nº 42 in the seeded records - and the
                matter is named, so the numbers are checkable rather than
                atmospheric. The reference this came from printed "LOCATING
                TRUTH VECTORS... CONFIDENCE: 99.9%", which is a number about
                nothing; on a product whose pitch is "pay on proof", a readout
                in the same mono face as figures the user is asked to verify
                does not get to be decorative. */}
            <div className="vh-hud telemetry" aria-hidden="true">
              <div>
                MATTER Nº <span className="vh-hud-key">{HERO_MATTER.n}</span>
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
            The instrument shows matter number {HERO_MATTER.n}, a settled
            matter: {HERO_MATTER.passed} of {HERO_MATTER.clauses} sealed clauses
            passed, at confidence {HERO_MATTER.confidence} against a threshold of{" "}
            {HERO_MATTER.threshold}, and the escrow was released.
          </p>
        </div>
      </div>
    </header>
  );
}
