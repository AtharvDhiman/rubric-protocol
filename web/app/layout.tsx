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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
