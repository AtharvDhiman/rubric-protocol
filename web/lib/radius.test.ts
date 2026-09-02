import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

/**
 * Radius zero, enforced by machine rather than by review.
 *
 * DESIGN.md: "border-radius: 0 everywhere." An instrument is milled, not
 * moulded. That rule has now been broken and repaired twice, and both times
 * the repair was a CSS reset that could not possibly work:
 *
 *   - A :where() block. :where() contributes ZERO specificity, so every
 *     component rule with a class selector beat it. .btn kept a 6px radius and
 *     the verdict stamp kept 4px, under a reset that read as if it had settled
 *     the question.
 *   - Then the same reset at real specificity, with the project's class names
 *     enumerated. Better, and still beaten - because six of the eight radii
 *     that actually shipped were inline `style={{ borderRadius: 2 }}` props,
 *     and an inline declaration outranks every author rule in the cascade no
 *     matter how specific the selector is.
 *
 * The lesson is that this invariant is not a cascade problem. A stylesheet can
 * only ever argue with other stylesheets, and the violations were not in a
 * stylesheet. The rule holds when the radius is never written down, so that is
 * what this test checks: it reads the real shipped sources - not a copy of the
 * values, the actual files - and fails on any radius that is not 0 or 50%,
 * whether it is written as CSS, as a React style prop, or as a Tailwind
 * `rounded` utility (Tailwind is imported in globals.css, so `className="rounded"`
 * is a live way to get a corner without ever typing the word radius).
 *
 * 50% is allowed on purpose and is NOT a rounded rectangle: the status dots are
 * a shape channel. --negative against --positive is 1.04:1, so a disc, a ring
 * and a square are how PASS, PENDING and FAIL stay distinguishable without
 * colour. The last case below asserts those survive, so that a future pass at
 * "radius 0 everywhere" cannot take the non-colour channel with it.
 */

const ROOT = process.cwd();
const SCANNED_DIRS = ["app", "components", "lib"];
const SCANNED_EXT = new Set([".css", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "generated", "dist"]);

/** Every source file we ship UI from, found by walking rather than by a list -
 *  a list would miss the next file somebody adds, which is the failure mode
 *  this whole test exists to close. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }
      // Tests are not rendered, and this file necessarily contains the very
      // strings it bans.
      if (/\.test\.tsx?$/.test(entry)) continue;
      if (SCANNED_EXT.has(extname(entry))) out.push(full);
    }
  };
  for (const d of SCANNED_DIRS) walk(join(ROOT, d));
  return out;
}

/** Comments are prose, and this project's comments discuss the banned values at
 *  length. Strip them before matching or the documentation fails the build. */
function stripComments(text: string, isCss: boolean): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Line comments in TS only, and never when the `//` is preceded by a colon,
  // which is how a URL inside a string literal survives intact.
  if (!isCss) out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

/** 0 in any unit, or a full 50% circle. Nothing else is a legal corner. */
function tokenAllowed(token: string): boolean {
  const t = token.replace(/["'`]/g, "").trim();
  if (t === "") return true;
  return /^0(px|%|em|rem|rlh)?$/.test(t) || t === "50%";
}

function valueAllowed(value: string): boolean {
  // The shorthand takes a `/` between the horizontal and vertical radii.
  return value
    .split(/[\s/]+/)
    .filter(Boolean)
    .every(tokenAllowed);
}

type Violation = { file: string; snippet: string };

// `border-radius`, plus every longhand and logical form: border-top-left-radius,
// border-start-end-radius, and so on. Banning only the shorthand would leave the
// rule one hyphen away from being bypassed.
const CSS_RADIUS = /border-[\w-]*radius\s*:\s*([^;{}]+)/g;
// The same set in camelCase, as React writes it in a style object.
const JS_RADIUS = /border(?:[A-Z]\w*?)?Radius\s*:\s*([^,\n}]+)/g;
// class="..." / className="..." / className={`...`}
const CLASS_ATTR = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`|\{\s*"([^"]*)")/g;

function scan(): Violation[] {
  const found: Violation[] = [];
  for (const file of sources()) {
    const isCss = extname(file) === ".css";
    const rel = relative(ROOT, file).split(sep).join("/");
    const text = stripComments(readFileSync(file, "utf8"), isCss);

    for (const m of text.matchAll(CSS_RADIUS)) {
      if (!valueAllowed(m[1])) found.push({ file: rel, snippet: m[0].trim() });
    }
    if (!isCss) {
      for (const m of text.matchAll(JS_RADIUS)) {
        if (!valueAllowed(m[1])) found.push({ file: rel, snippet: m[0].trim() });
      }
      for (const m of text.matchAll(CLASS_ATTR)) {
        const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
        for (const token of value.split(/[\s${}()]+/).filter(Boolean)) {
          // rounded, rounded-md, rounded-t-lg, md:rounded-full, ...
          if (/(?:^|:)-?rounded(?:-|$)/.test(token)) {
            found.push({ file: rel, snippet: `class token "${token}"` });
          }
        }
      }
    }
  }
  return found;
}

describe("radius 0 everywhere", () => {
  it("scans the files it thinks it is scanning", () => {
    const files = sources();
    // A walk that silently finds nothing would make every other case below
    // pass for the wrong reason.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("globals.css"))).toBe(true);
    expect(files.some((f) => f.endsWith("ConnectWallet.tsx"))).toBe(true);
  });

  it("writes no corner radius other than 0 or a 50% circle", () => {
    const violations = scan();
    const report = violations.map((v) => `  ${v.file}: ${v.snippet}`).join("\n");
    expect(
      violations,
      `DESIGN.md requires border-radius: 0 everywhere. Found:\n${report}\n\n` +
        "A 50% circle is allowed - that is a shape, not a rounded rectangle. " +
        "Anything else must be removed rather than overridden: an inline style " +
        "prop beats any reset this stylesheet can write."
    ).toEqual([]);
  });

  it("keeps the 50% status marks, which are the non-colour channel", () => {
    const circles = sources()
      .map((f) => stripComments(readFileSync(f, "utf8"), extname(f) === ".css"))
      .join("\n")
      .match(/border-radius\s*:\s*50%/g);
    expect(
      circles?.length ?? 0,
      "The disc/ring/square marks carry PASS, PENDING and FAIL without relying " +
        "on colour (--negative vs --positive is 1.04:1). Removing them in the " +
        "name of radius 0 removes an accessibility channel, not a decoration."
    ).toBeGreaterThan(0);
  });
});
