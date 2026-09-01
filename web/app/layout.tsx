import type { Metadata } from "next";
import { AppearMotion } from "@/components/AppearMotion";
import { Archivo, Martian_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two families, each with a jurisdiction.
 *
 * Archivo is the language of the product. It carries a width axis, and the
 * nameplate uses it expanded and heavy - an expanded grotesk at weight 700
 * reads as lettering stamped into a faceplate, which is the whole tone. If the
 * width axis fails to load nothing breaks: no layout depends on it, the type
 * simply sets at normal width.
 *
 * Martian Mono replaces Azeret Mono, and the reason is functional rather than
 * aesthetic: Azeret has no width axis. A Solana address is 44 base58
 * characters, and at 375px there is no setting of a fixed-width mono that fits
 * one on a single line. Martian condenses to wdth 75, which does - so the
 * address stays one selectable, copyable string instead of wrapping mid-token
 * or being truncated behind an ellipsis.
 *
 * The jurisdiction rule is enforceable rather than aspirational:
 *
 *   If a human wrote it as a sentence, it is Archivo. Everything else is mono.
 *
 * Because the prose face only ever lands on paragraphs, a figure CANNOT leak
 * into it. That is what makes "every verifiable figure is monospace" a
 * structural property of the stylesheet rather than a discipline someone has
 * to remember. Mono therefore carries most of the visible glyphs: every label,
 * column head, status word, unit, amount, confidence, address, hash, joint
 * angle and timestamp.
 *
 * Note on the API: `weight` must NOT be passed alongside `axes` (next/font
 * rejects the combination), and `wght` must not be listed IN `axes` - it is
 * filtered out of the definable set and throws. Both faces expose wght
 * automatically as variable fonts.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-martian",
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
      className={`${archivo.variable} ${martian.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {/* Wires the entrance sequence: retires each animation when it ends,
            and reveals everything if the animations never ran at all. */}
        <AppearMotion />
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
