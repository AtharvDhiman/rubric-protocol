import { describe, expect, it } from "vitest";
import { SHARED_HOSTING_SUFFIXES, isSharedHostingDomain, signingNoticeCopy } from "./host-notice";

describe("isSharedHostingDomain", () => {
  it("recognises a shared hosting subdomain", () => {
    for (const host of [
      "rubric.vercel.app",
      "rubric-git-main-team.vercel.app",
      "a.b.vercel.app",
      "rubric.netlify.app",
      "rubric.pages.dev",
      "someone.github.io",
    ]) {
      expect(isSharedHostingDomain(host), host).toBe(true);
    }
  });

  it("is case-insensitive and treats a trailing dot as the same name", () => {
    expect(isSharedHostingDomain("RUBRIC.VERCEL.APP")).toBe(true);
    expect(isSharedHostingDomain("rubric.vercel.app.")).toBe(true);
    expect(isSharedHostingDomain("  rubric.vercel.app ")).toBe(true);
  });

  it("matches whole labels only: a look-alike is NOT the platform", () => {
    expect(isSharedHostingDomain("evil-vercel.app")).toBe(false);
    expect(isSharedHostingDomain("notvercel.app")).toBe(false);
    expect(isSharedHostingDomain("vercel.app.evil.com")).toBe(false);
    expect(isSharedHostingDomain("rubric.vercel.app.evil.com")).toBe(false);
    expect(isSharedHostingDomain("vercelXapp")).toBe(false);
  });

  it("a domain of its own is not shared hosting, so the notice goes away after the move", () => {
    for (const host of ["rubric.example", "rubric.xyz", "app.rubric.dev", "www.example.com"]) {
      expect(isSharedHostingDomain(host), host).toBe(false);
    }
  });

  it("is false for localhost, an IP, and nothing", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "", "   "]) {
      expect(isSharedHostingDomain(host), JSON.stringify(host)).toBe(false);
    }
  });

  it("the suffix list has no leading dots or wildcards that would break the whole-label match", () => {
    for (const s of SHARED_HOSTING_SUFFIXES) expect(s).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  });
});

describe("signingNoticeCopy", () => {
  const PROGRAM = "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz";
  const all = (c: ReturnType<typeof signingNoticeCopy>) => [c.heading, c.body, ...c.checks].join(" ");

  it("NEVER tells a person to ignore, dismiss or click through a wallet warning", () => {
    // That is the instruction a phishing page gives. A legitimate site that gives it
    // teaches people to follow it.
    for (const text of [all(signingNoticeCopy()), all(signingNoticeCopy(PROGRAM))]) {
      expect(text).not.toMatch(/\bignor/i);
      expect(text).not.toMatch(/\bdismiss/i);
      expect(text).not.toMatch(/click(ing)? through/i);
      expect(text).not.toMatch(/safe to (proceed|continue|sign)/i);
      expect(text).not.toMatch(/proceed anyway|continue anyway/i);
      expect(text).not.toMatch(/false positive|nothing to worry|don'?t worry|harmless|not a real warning/i);
    }
  });

  it("says a warning is a reason to check, and ends on 'do not sign'", () => {
    const c = signingNoticeCopy(PROGRAM);
    expect(c.body).toMatch(/reason to check/i);
    expect(c.checks[c.checks.length - 1]).toMatch(/do not sign/i);
  });

  it("claims no cause for any warning: it does not say a wallet flags this host", () => {
    // Phantom's documentation does not say shared hosting domains are treated differently.
    for (const text of [all(signingNoticeCopy()), all(signingNoticeCopy(PROGRAM))]) {
      expect(text).not.toMatch(/\bflags?\b/i);
      expect(text).not.toMatch(/\bblocklist|blacklist|blocked\b/i);
      expect(text).not.toMatch(/because (phantom|the wallet)/i);
    }
  });

  it("is hedged where it describes a wallet's behaviour", () => {
    expect(signingNoticeCopy().body).toMatch(/\bmay warn\b/);
  });

  it("names the exact program to compare against when it is known", () => {
    expect(all(signingNoticeCopy(PROGRAM))).toContain(PROGRAM);
  });

  it("still gives a way to check when the program id is not configured", () => {
    const text = all(signingNoticeCopy());
    expect(text).toMatch(/Compare/);
    expect(text).not.toContain("undefined");
  });

  it("never asks for, or mentions needing, a seed phrase", () => {
    expect(all(signingNoticeCopy())).toMatch(/never asks for your seed phrase/);
  });
});
