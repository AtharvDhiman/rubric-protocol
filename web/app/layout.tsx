import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

/**
 * The entire type system. Inter for everything, Instrument Serif italic for a
 * single accented phrase in the headline and nowhere else.
 *
 * Inter is the interface: one variable family covering 100-900, so weight is a
 * free axis rather than another download. Instrument Serif appears italic only,
 * at one size, on one phrase - it is a punctuation mark on the page, not a
 * second voice.
 *
 * There is no monospace family any more. Figures that need to line up use
 * `font-variant-numeric: tabular-nums`, which Inter supports, so columns stay
 * aligned without loading a face purely to align digits.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rubric — Pay on proof, not on trust",
  description:
    "Rubric locks the acceptance criteria on-chain before work begins. An AI judge checks each submission against those sealed clauses, and Solana releases the payment the moment it passes.",
};

/**
 * Strips attributes that browser extensions stamp onto the DOM, so they are
 * gone before React hydrates and there is nothing left to mismatch.
 *
 * Why this exists: `suppressHydrationWarning` only reaches elements we render.
 * Bitdefender writes `bis_skin_checked` onto Next's OWN internal elements,
 * which we cannot annotate, so the dev overlay sat permanently red for a
 * problem that is not in this codebase.
 *
 * Three deliberate constraints:
 *
 *  - DEVELOPMENT ONLY. It is injected only when NODE_ENV is development, so no
 *    visitor ever downloads or runs it. Production ships no overlay anyway, so
 *    there is nothing to fix there and no reason to run DOM-scrubbing code for
 *    real users.
 *  - IT DISCONNECTS. The observer stops after 5 seconds. An extension that
 *    re-adds an attribute every time we remove it would otherwise become an
 *    infinite tug-of-war burning CPU. Hydration is long over by then.
 *  - IT ONLY TOUCHES KNOWN MARKERS. An explicit prefix list, never a blanket
 *    attribute sweep, so nothing functional can be removed by accident.
 */
const STRIP_EXTENSION_ATTRS = `
(function () {
  var RE = /^(bis_skin_checked$|__processed_|bis_register$|bis_size$)/;
  function scrub(el) {
    if (!el || !el.attributes) return;
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var n = el.attributes[i].name;
      if (RE.test(n)) el.removeAttribute(n);
    }
  }
  function scrubAll() {
    scrub(document.documentElement);
    var all = document.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) scrub(all[i]);
  }
  scrubAll();
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'attributes' && m.attributeName && RE.test(m.attributeName)) {
        m.target.removeAttribute(m.attributeName);
      } else if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) scrub(m.addedNodes[j]);
      }
    }
  });
  mo.observe(document.documentElement, { attributes: true, subtree: true, childList: true });
  setTimeout(function () { mo.disconnect(); }, 5000);
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is here for one specific reason: browser
    // extensions (Bitdefender's `bis_skin_checked`, and others that stamp a
    // `__processed_<uuid>__` attribute) mutate the DOM before React hydrates,
    // so React finds attributes on <html>/<body> that are not in its tree and
    // reports a hydration mismatch. That warning is caused by the visitor's
    // browser, not by this app, and it is not actionable from here.
    //
    // It suppresses warnings only ONE level deep on these two elements, which
    // is exactly where extensions inject. It does NOT hide a real mismatch in
    // any component - those still surface normally.
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {/* First child of <body> so it runs during HTML parsing, before React's
            bundle executes and hydrates. Dev only - see the constant above. */}
        {process.env.NODE_ENV === "development" && (
          <script dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRS }} />
        )}
        {children}
      </body>
    </html>
  );
}
