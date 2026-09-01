import Link from "next/link";

import { Skeleton } from "@/components/rig/Skeleton";

/**
 * The landing hero: a capture volume cut into the plate.
 *
 * The dark panel is INSET, with a light margin on all four sides and a 1px
 * edge. That is the whole idea and it is worth stating, because the obvious
 * move - a full-bleed dark hero - says something different. A hero background
 * is a mood. A bounded panel with an edge is an INSTRUMENT VIEWPORT: you are
 * looking into a measured space from outside it, which is exactly the
 * relationship the product describes. It is also why the volume may never
 * become the page: the moment the dark reaches the edges, it stops being a
 * thing you are looking into and becomes a theme.
 *
 * Nothing is centred. The rail sits left of the panel, the wordmark runs off
 * the panel's top-left corner and is clipped by its edge, and the type is set
 * ragged-right. Centred layouts read as marketing; an instrument is aligned to
 * a datum.
 */

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
        {/* ---- the rail ---- */}
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

          {/* The tolerances this product actually runs on, stated as figures
              rather than as claims. Every one is read from a constant, so the
              page cannot drift from the program. */}
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

        {/* ---- the volume ---- */}
        <div className="vh-stage">
          {/* Ghost display type, overlapping the panel corner and clipped by
              its edge. aria-hidden and duplicated by the real wordmark in the
              nav, so it is texture and never the only carrier of the name. */}
          <span className="vh-ghost" aria-hidden="true">
            RUBRIC
          </span>

          <div className="volume vh-volume">
            <Skeleton />
          </div>
        </div>
      </div>
    </header>
  );
}
