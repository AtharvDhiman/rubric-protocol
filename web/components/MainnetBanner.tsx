"use client";

import { useEffect, useState } from "react";
import { treatAsMainnet } from "@/lib/env";
import type { LimitsPayload } from "@/lib/limits";
import { mainnetBannerText } from "@/lib/mainnet-banner";

/**
 * A banner on every screen, on mainnet only: the program is unaudited and bounties are
 * capped, with the live on-chain cap. Renders nothing anywhere else.
 *
 * It uses the fail-closed `treatAsMainnet`, so a mistyped cluster name shows the banner
 * rather than hiding it. The cap is read from /api/limits after mount; until then, and if
 * the chain cannot be read, it says "capped" without a number (lib/mainnet-banner.ts).
 *
 * Client-side on purpose: the landing page and several app screens are static, and a
 * server-rendered cap would be baked in at build time and go stale the day it changed.
 */
export function MainnetBanner() {
  const mainnet = treatAsMainnet();
  const [limits, setLimits] = useState<LimitsPayload | null>(null);

  useEffect(() => {
    if (!mainnet) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/limits");
        if (!response.ok) return;
        const body = (await response.json()) as LimitsPayload;
        if (!cancelled) setLimits(body);
      } catch {
        // Stays on "bounties are capped". Never a guessed number.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mainnet]);

  if (!mainnet) return null;

  return (
    <div
      role="status"
      style={{
        borderBottom: "1px solid var(--border-strong)",
        background: "var(--surface)",
        padding: "10px 32px",
        textAlign: "center",
      }}
    >
      <span className="label" style={{ color: "var(--warning)" }}>
        {mainnetBannerText(limits)}
      </span>
    </div>
  );
}
