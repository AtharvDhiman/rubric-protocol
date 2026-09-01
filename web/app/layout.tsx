import type { Metadata } from "next";
import { AppearMotion } from "@/components/AppearMotion";
import { Archivo, Azeret_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two families, each with a jurisdiction.
 *
 * Archivo is the language of the product. It carries a width axis, and the
 * nameplate uses it expanded and heavy - an expanded grotesk at weight 700
 * reads as lettering stamped into a metal faceplate, which is the whole tone.
 * If the width axis fails to load nothing breaks: no layout depends on it, the
 * type simply sets at normal width.
 *
 * Azeret Mono is mandatory for every figure a person might compare, copy or
 * verify - amounts, confidences, clause numbers, addresses, hashes, durations.
 * Its squared drawing-office figures are what make a hash read as a measured
 * part number rather than as a string, and the visual split between a wide
 * grotesk and a squared mono is doing that work deliberately.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const azeret = Azeret_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-azeret",
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
      className={`${archivo.variable} ${azeret.variable}`}
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
