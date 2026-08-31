import { ApertureHero } from "@/components/landing/ApertureHero";
import {
  Figures,
  FinalCta,
  HowItWorks,
  Marquee,
  SiteFooter,
  VerdictLog,
} from "@/components/landing/Sections";

/**
 * The landing page. Dark, with one strong animated visual in the hero and plain
 * dense sections below it. See web/DESIGN.md.
 */
export default function LandingPage() {
  return (
    <div className="on-dark" style={{ background: "var(--d-ground)" }}>
      <ApertureHero />
      <Marquee />
      <HowItWorks />
      <VerdictLog />
      <Figures />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}
