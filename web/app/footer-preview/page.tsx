import { FooterLedger } from "@/components/footers/FooterLedger";
import { FooterKinetic } from "@/components/footers/FooterKinetic";
import { FooterGrid } from "@/components/footers/FooterGrid";
import { FooterSignature } from "@/components/footers/FooterSignature";
import { FooterCitation } from "@/components/footers/FooterCitation";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * A scratch route for choosing a footer by eye.
 *
 * TEMPORARY. This exists so the four candidates can be looked at rather than
 * read as source, and it is deleted once one is picked. It is not linked from
 * anywhere and is excluded from the sitemap by virtue of not being in one.
 */

export const metadata = {
  title: "Footer options — preview",
  robots: { index: false, follow: false },
};

const OPTIONS = [
  {
    key: "A",
    name: "Live ledger",
    note: "The tail of the protocol's own record: the last settled matters, with real figures.",
    render: () => <FooterLedger />,
  },
  {
    key: "B",
    name: "Kinetic wordmark",
    note: "The name responds to the cursor. One mechanic, executed precisely.",
    render: () => <FooterKinetic />,
  },
  {
    key: "C",
    name: "Utility grid",
    note: "Dense, useful, quiet. Real links to real routes and the protocol's real constants.",
    render: () => <FooterGrid />,
  },
  {
    key: "D",
    name: "Signature",
    note: "One memorable thing that only this product could put at the bottom of a page.",
    render: () => <FooterSignature />,
  },
  {
    key: "F",
    name: "The citation",
    note: "One real refusal, quoted in full: the sealed clause, the submission, and the ruling that connects them.",
    render: () => <FooterCitation />,
  },
  {
    key: "E",
    name: "Current — sealed record",
    note: "What is live today, for comparison.",
    render: () => <SiteFooter />,
  },
];

export default function FooterPreviewPage() {
  return (
    <main style={{ background: "var(--page)", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "40px 32px 8px",
        }}
      >
        <p className="label" style={{ color: "var(--text-muted)", margin: 0 }}>
          SCRATCH ROUTE · NOT LINKED · DELETED AFTER A CHOICE IS MADE
        </p>
        <h1
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 34,
            fontVariationSettings: '"wdth" 112',
            fontWeight: 600,
            letterSpacing: "-0.04em",
            margin: "12px 0 0",
            color: "var(--text)",
          }}
        >
          Footer options
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            maxWidth: "62ch",
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--text-2)",
          }}
        >
          Each block below is a complete, working footer. Scroll through, then
          say which letter to keep — the rest get deleted along with this page.
        </p>
      </div>

      {OPTIONS.map((o) => (
        <section key={o.key} style={{ marginTop: 48 }}>
          <div
            style={{
              maxWidth: 1240,
              margin: "0 auto",
              padding: "0 32px 14px",
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <span
              className="data"
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: "var(--accent)",
              }}
            >
              {o.key}
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--text)",
              }}
            >
              {o.name}
            </span>
            <span
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                maxWidth: "58ch",
              }}
            >
              {o.note}
            </span>
          </div>
          {o.render()}
        </section>
      ))}

      <div style={{ height: 64 }} />
    </main>
  );
}
