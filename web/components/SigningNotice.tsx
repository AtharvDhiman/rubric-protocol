"use client";

import { useSyncExternalStore } from "react";
import { explorerAddressUrl, programIdString } from "@/lib/env";
import { isSharedHostingDomain, signingNoticeCopy } from "@/lib/host-notice";

/**
 * Shown next to a button that signs a transaction, but ONLY when this site is on a shared
 * hosting address (*.vercel.app and the like). Once the site has a domain of its own it
 * renders nothing, with no code change.
 *
 * The words, and why they are what they are, live in lib/host-notice.ts. In short: they
 * name no cause for any wallet warning (Phantom's documentation does not say shared
 * hosting is treated differently), and they never tell anyone to ignore one.
 *
 * The hostname is read with useSyncExternalStore so the server render and the first
 * client render agree (both render nothing), and the notice appears on the client without
 * a hydration mismatch.
 */

const subscribe = () => () => {};
const clientHost = () => window.location.hostname;
const serverHost = () => "";

export function SigningNotice() {
  const host = useSyncExternalStore(subscribe, clientHost, serverHost);
  if (!isSharedHostingDomain(host)) return null;

  const programId = programIdString();
  const copy = signingNoticeCopy(programId);

  return (
    <aside
      role="note"
      aria-label="About wallet warnings on this address"
      style={{
        border: "1px solid var(--border-strong)",
        background: "var(--surface)",
        padding: "14px 16px",
        marginTop: 16,
      }}
    >
      <p className="label" style={{ margin: 0 }}>
        {copy.heading}
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)", margin: "10px 0 0" }}>
        {copy.body}
      </p>
      <ul
        style={{
          margin: "10px 0 0",
          paddingLeft: 18,
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-2)",
        }}
      >
        {copy.checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
      {programId && (
        <p style={{ fontSize: 14, margin: "10px 0 0" }}>
          <a
            href={explorerAddressUrl(programId)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            View the program on Explorer
          </a>
        </p>
      )}
    </aside>
  );
}
