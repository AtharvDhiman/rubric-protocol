/**
 * The notice shown before signing when this site is on a shared hosting address.
 *
 * WHAT IS AND IS NOT KNOWN
 * ------------------------
 * Wallets such as Phantom can warn about a site. Phantom documents two relevant
 * warnings: one for a domain that "is new or has not been reviewed yet", which it says
 * usually clears within a few days, and a separate one when it "can't predict a
 * transaction's outcome". Its documentation does NOT say that shared hosting domains
 * such as *.vercel.app are treated differently, and nothing here claims they are.
 *
 * So this notice names no cause. It says only what is true: the site is on a shared
 * address, wallets may warn about unreviewed domains, and a warning is a reason to check.
 *
 * THE RULE THIS COPY MUST NEVER BREAK
 * -----------------------------------
 * It must never tell a person to ignore, dismiss or click through a wallet warning. That
 * is the instruction a phishing page gives, and a legitimate site that gives it teaches
 * people to follow it. The notice says what to CHECK and ends on "do not sign". A test
 * enforces this.
 */

/**
 * Hosting platforms whose subdomains anyone can claim, so the hostname alone says nothing
 * about who runs the site. Matched as a whole-label suffix: "evil-vercel.app" and
 * "vercel.app.evil.com" are NOT shared hosting of that platform, and must not match.
 */
export const SHARED_HOSTING_SUFFIXES = [
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "github.io",
  "onrender.com",
  "fly.dev",
  "herokuapp.com",
] as const;

export function isSharedHostingDomain(hostname: string): boolean {
  // Case-insensitive, and a trailing dot ("x.vercel.app.") is the same name.
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  // An empty or odd host matches neither condition, so it is simply false.
  return SHARED_HOSTING_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export interface SigningNoticeCopy {
  heading: string;
  body: string;
  /** What to check, in order. The last ends the notice: if anything is off, do not sign. */
  checks: string[];
}

/**
 * The words. `programId` is the program this deployment talks to, if known, so the second
 * check can name the exact thing to compare against.
 */
export function signingNoticeCopy(programId?: string): SigningNoticeCopy {
  return {
    heading: "ABOUT WALLET WARNINGS ON THIS ADDRESS",
    body:
      "During the beta this site runs on a shared hosting address rather than a domain of its own. " +
      "Wallets such as Phantom may warn about a domain they have not reviewed yet, or when they " +
      "cannot predict what a transaction will do. Treat a warning as a reason to check.",
    checks: [
      "Confirm the address bar shows exactly this site, and that you arrived from a link you trust.",
      programId
        ? `Rubric only asks you to sign transactions for its own program, ${programId}. Compare it with the program in your wallet's transaction details.`
        : "Rubric only asks you to sign transactions for its own program. Compare the program in your wallet's transaction details with the one in the project's README.",
      "Rubric never asks for your seed phrase, and never needs approval to spend tokens other than the bounty you are posting.",
      "If anything does not match, do not sign.",
    ],
  };
}
