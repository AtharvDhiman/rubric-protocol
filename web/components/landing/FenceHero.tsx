import Link from "next/link";

import { VerdictReel } from "@/components/VerdictReel";

/**
 * The landing hero: a two-column faceplate.
 *
 * A fixed left rail carries the stamped nameplate, the claim and the two
 * actions. The rest is the mechanism itself, drawn at engineering scale — the
 * same component that runs on `/task/[id]`, here with a scripted verdict.
 *
 * Nothing is centred, and there is no hero graphic separate from the product.
 * The thing you are looking at is the thing that decides whether you get paid.
 */



const navLink: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  textDecoration: "none",
};

export function FenceHero() {
  return (
    <header
      style={{
        background: "var(--page)",
        borderBottom: "3px solid var(--text)",
        position: "relative",
      }}
    >
      {/* The datum edge. It rides ON the 3px graphite rule rather than on the
          Deck: brass is 2.85:1 against zinc, below even the 3:1 non-text floor,
          so it may never sit on the Deck itself. On graphite it is a machined
          reference mark and clears comfortably. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          bottom: -3,
          width: 24,
          height: 3,
          background: "var(--accent)",
          outline: "1px solid var(--border)",
        }}
      />

      <nav className="fence-nav">
        <Link
          href="/"
          className="nameplate appear appear--scale"
          style={{ ["--d" as string]: "0.08s", textDecoration: "none" }}
        >
          RUBRIC
        </Link>

        <div
          className="fence-nav-links appear appear--soft"
          style={{ ["--d" as string]: "0.2s" }}
        >
          <a href="#how-it-works" style={navLink}>
            How it works
          </a>
          <Link href="/docket" style={navLink}>
            The docket
          </Link>
          <a href="#verdict-log" style={navLink}>
            Docs
          </a>
          <Link href="/docket" className="btn">
            Connect wallet
          </Link>
        </div>
      </nav>

      <div className="fence-hero">
        {/* ---- left rail: the faceplate ---- */}
        <div className="fence-rail">
          <p
            className="label appear appear--soft"
            style={{ ["--d" as string]: "0.3s", margin: 0 }}
          >
            AI-JUDGED ESCROW ON SOLANA
          </p>

          <h1
            className="appear appear--soft"
            style={{ ["--d" as string]: "0.42s", margin: "18px 0 0" }}
          >
            Pay on proof,
            <br />
            not on trust.
          </h1>

          <p
            className="appear appear--soft"
            style={{
              ["--d" as string]: "0.58s",
              maxWidth: "56ch",
              margin: "20px 0 0",
              fontSize: 16,
              lineHeight: 1.55,
              color: "var(--text-muted)",
            }}
          >
            The acceptance criteria are hashed and locked on-chain before work
            starts. An AI judge rules on each sealed clause in the open, and the
            escrow only releases when every one of them passes.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 28,
            }}
          >
            <Link
              href="/docket"
              className="btn btn-primary appear appear--btn"
              style={{ ["--d" as string]: "0.74s" }}
            >
              Open the docket
            </Link>
            <a
              href="#how-it-works"
              className="btn appear appear--side"
              style={{ ["--d" as string]: "0.86s" }}
            >
              How it works
            </a>
          </div>
        </div>

        {/* ---- right: the mechanism ---- */}
        <div className="fence-stage">
          <VerdictReel />
        </div>
      </div>
    </header>
  );
}
