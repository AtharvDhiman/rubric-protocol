import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * The entire type system. IBM Plex Sans and IBM Plex Mono, nothing else.
 *
 * Plex reads as engineering infrastructure rather than as a startup landing
 * page, which is the correct register for an escrow protocol. Deliberately not
 * Inter, Roboto or system-ui - see web/DESIGN.md.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rubric — Pay on proof, not on trust",
  description:
    "Rubric locks the acceptance criteria on-chain before work begins. An AI judge checks each submission against those sealed clauses, and Solana releases the payment the moment it passes.",
};

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
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
