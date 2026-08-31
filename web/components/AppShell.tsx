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
        background: "var(--surface)",
        borderBottom: "1px solid var(--border-strong)",
        boxShadow: "0 1px 0 rgba(244,244,245,0.06)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
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
          style={{
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
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                style={{
                  fontSize: 14,
                  textDecoration: "none",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  paddingBottom: 4,
                  borderBottom: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                }}
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

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--page)" }}>
      <AppHeader />
      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "var(--surface)",
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
