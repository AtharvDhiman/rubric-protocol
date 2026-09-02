import { VolumeHero } from "@/components/landing/VolumeHero";
import { SiteFooter } from "@/components/SiteFooter";
import {
  Figures,
  FinalCta,
  HowItWorks,
  Marquee,
  VerdictLog,
} from "@/components/landing/Sections";

/**
 * The landing page.
 *
 * A light plate throughout. There is no dark viewport and no second theme: the
 * hero oracle is drawn straight onto the page in remapped inks, over the
 * full-bleed field mounted once in the root layout. See web/DESIGN.md.
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
