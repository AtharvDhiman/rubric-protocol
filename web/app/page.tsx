import { VolumeHero } from "@/components/landing/VolumeHero";
import {
  Figures,
  FinalCta,
  HowItWorks,
  Marquee,
  SiteFooter,
  VerdictLog,
} from "@/components/landing/Sections";

/**
 * The landing page.
 *
 * A light plate with ONE bounded dark viewport in the hero. The page is not
 * dark - the volume is, and only the volume. See web/DESIGN.md.
 */
export default function LandingPage() {
  return (
    <div>
      <VolumeHero />
      <Marquee />
      <HowItWorks />
      <VerdictLog />
      <Figures />
      <FinalCta />
      <SiteFooter />
    </div>
  );
}
