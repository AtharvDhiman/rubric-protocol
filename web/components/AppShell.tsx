"use client";

/**
 * The app chrome: a document column on a desk.
 *
 * One continuous surface with side borders, not a grid of floating cards. The
 * sticky header carries the single permitted shadow in the product - a 1px
 * hairline - and everything else uses borders.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SolanaMark } from "./SolanaMark";
import { ConnectWallet } from "./ConnectWallet";

const NAV = [
  { href: "/docket", label: "Docket" },
  { href: "/create", label: "Create" },
  { href: "/my-work", label: "My work" },
];

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "var(--page)",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div
        className="app-header-inner"
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "0 32px",
          height: 64,
          display: "flex",
          alignItems: "center",
          gap: 32,
        }}
      >
        <Link
          href="/"
          className="appear appear--scale"
          style={{
            ["--d" as string]: "0.08s",
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: "-0.01em",
          }}
        >
          <SolanaMark size={16} />
          Rubric
        </Link>

        <nav style={{ display: "flex", gap: 24, flex: 1 }}>
          {NAV.map((item, i) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`nav-pill appear appear--soft${active ? " nav-pill--active" : ""}`}
                style={{ ["--d" as string]: `${0.16 + i * 0.12}s` }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <ConnectWallet />
      </div>
    </header>
  );
}

export function AppShell({
  children,
  demoMode = false,
}: {
  children: React.ReactNode;
  /** Set by the layout. Server-side env is not readable from a client component. */
  demoMode?: boolean;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--page)" }}>
      <AppHeader />

      {/* Sample records must never be mistakable for real ones. This protocol
          exists so that what you see is what was sealed; a demo that blurred
          that line would undercut the whole point. */}
      {demoMode && (
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
            DEMO DATA · no database attached · nothing here is a real task and no
            escrow exists
          </span>
        </div>
      )}
      <main
        className="app-main"
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          background: "var(--page)",
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
          minHeight: "calc(100vh - 64px)",
          padding: "40px 32px 64px",
        }}
      >
        {children}
      </main>
    </div>
  );
}
