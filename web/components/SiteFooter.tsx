import { SolanaMark } from "@/components/SolanaMark";
import { Stamp } from "@/components/Stamp";
import { CopyButton } from "@/components/CopyButton";
import { normalizeText, sha256Bytes, toHex, CANONICAL_VERSION } from "@/lib/hash";
import { FooterReveal } from "@/components/FooterReveal";

/**
 * The footer seals its own name.
 *
 * Every other site puts a copyright line here. This product's entire claim is
 * that a piece of text can be committed and then verified by anyone, so the
 * footer demonstrates that claim on itself: the name and the promise, and the
 * SHA-256 that would be written to a PDA if they were sealed as a rubric.
 *
 * THE DIGEST IS REAL. It is computed here by `sha256Bytes` from lib/hash.ts -
 * the same load-bearing function that hashes live clauses at create time and
 * re-derives them at verify time. It is not a decorative hex string, and it is
 * not pasted in. The exact input is printed above it and normalised by the
 * project's own `normalizeText`, so a reader can run the same two steps and get
 * the same 64 characters. That is the only reason it is allowed to be here: a
 * hash nobody can reproduce is a texture pretending to be evidence, which on
 * this product would be the exact lie the whole thing exists to prevent.
 *
 * It sits on --raised, and that is a statement rather than a shade. --raised
 * means COMMITTED ON-CHAIN everywhere else in the product - sealed clause sets,
 * the verdict sheet, settled receipts - so the footer is claiming membership of
 * that set, and the SEALED stamp beside it is the same component the clause
 * panel uses.
 *
 * Computed once at module scope. The value can never change between renders -
 * the input is a constant and the hash is pure - so recomputing it per render
 * would be work that provably produces the same 32 bytes.
 */

/** What is sealed. Printed verbatim below, so the hash is reproducible. */
const SEALED_TEXT = "Pay on proof, not on trust.";

const CANONICAL = normalizeText(SEALED_TEXT);
const DIGEST = toHex(sha256Bytes(CANONICAL));

/**
 * Two lines of 32, in groups of 8.
 *
 * 64 characters do not fit on one line at 375px in any width setting of the
 * mono, and a digest that wraps wherever the box happens to end is unreadable
 * as a figure. Splitting it deliberately means the break is always in the same
 * place, so the two halves can be compared against another copy by eye.
 */
const DIGEST_LINES = [DIGEST.slice(0, 32), DIGEST.slice(32)].map((half) =>
  (half.match(/.{8}/g) ?? []).join(" ")
);

export function SiteFooter() {
  return (
    <footer className="wf">
      {/* Texture. The name is announced by the nav on every page, so nothing
          here is read out again. */}
      <div className="wf-hatch" aria-hidden="true" />

      <FooterReveal>
        <div className="wf-inner">
          <section
            className="wf-seal"
            data-reveal
            aria-label="The project name, sealed"
          >
            <div className="wf-seal-head">
              <span className="label">SEALED RECORD</span>
              <Stamp variant="sealed" small />
            </div>

            <p className="wf-name">RUBRIC</p>
            <p className="wf-claim">{SEALED_TEXT}</p>

            <dl className="wf-seal-grid">
              <dt className="label">SHA-256</dt>
              <dd>
                <span className="data wf-digest">
                  {DIGEST_LINES.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
                <CopyButton value={DIGEST} label="Copy digest" />
              </dd>

              <dt className="label">CANONICAL</dt>
              <dd className="data">
                v{CANONICAL_VERSION} · NFC · {sha256Bytes(CANONICAL).length}{" "}
                bytes
              </dd>
            </dl>

            <p className="wf-note">
              Hashed by the same function that seals every rubric on this
              protocol. Normalise the line above to NFC, take its SHA-256, and
              you get these 64 characters.
            </p>
          </section>

          <div className="wf-facts" data-reveal>
            <span className="wf-fact">
              <SolanaMark size={14} />
              <span className="label">BUILT ON SOLANA · USDC ESCROW</span>
            </span>
            <span className="label">RUBRIC PROTOCOL</span>
          </div>
        </div>
      </FooterReveal>
    </footer>
  );
}

export default SiteFooter;
