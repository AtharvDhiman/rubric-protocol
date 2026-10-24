import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Text that was UTF-8, got read as Windows-1252, and was saved again. It turns an em dash
 * into three characters of garbage and a middle dot into two, and it shipped once: Windows
 * PowerShell 5.1 does it to a file if you `Get-Content` and `Set-Content` it without naming
 * an encoding. It renders on the page, so it is a user-facing bug, and a type-check or a
 * lint will never see it.
 *
 * What it looks like: a lead character from U+00C2 to U+00F4 immediately followed by a
 * character that Windows-1252 uses for a UTF-8 continuation byte. Real text does not do
 * that, so any hit is damage.
 */
const LEAD = "Â-ô";
const CONTINUATION =
  "\u0080-¿ŒœŠšŸŽžƒˆ˜" +
  "–—‘-„†-•…‰‹›€™";
const MOJIBAKE = new RegExp(`[${LEAD}][${CONTINUATION}]`);

const WEB = process.cwd();
const REPO = path.join(WEB, "..");
const SKIP = new Set(["node_modules", ".next", ".claude", ".git", "target"]);
const EXTENSIONS = /\.(ts|tsx|css|md|json|mjs|prisma)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

function sources(): string[] {
  const dirs = ["app", "components", "lib", "scripts", "prisma"].map((d) => path.join(WEB, d));
  const files = dirs.filter((d) => fs.existsSync(d)).flatMap((d) => walk(d));
  const docs = path.join(REPO, "docs");
  if (fs.existsSync(docs)) files.push(...walk(docs));
  for (const f of [path.join(WEB, "DESIGN.md"), path.join(REPO, "README.md"), path.join(REPO, "CLAUDE.md")]) {
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

/** The first damaged line of a file, with its number, or null. */
function firstDamage(text: string): { line: number; text: string } | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (MOJIBAKE.test(lines[i])) return { line: i + 1, text: lines[i].trim().slice(0, 100) };
  }
  return null;
}

describe("source files are not double-encoded", () => {
  it("the detector recognises the damage it exists to catch", () => {
    // Built from code points so this file does not contain the damage it describes.
    const emDash = "—";
    const middleDot = "·";
    const damagedEmDash = String.fromCharCode(0xe2, 0x20ac, 0x201d);
    const damagedMiddleDot = String.fromCharCode(0xc2, 0xb7);
    expect(firstDamage(`a ${damagedEmDash} b`)).not.toBeNull();
    expect(firstDamage(`a ${damagedMiddleDot} b`)).not.toBeNull();
    // Intact text, including every character this repo uses, is left alone.
    expect(firstDamage(`a ${emDash} b ${middleDot} c º → ×`)).toBeNull();
    expect(firstDamage("plain ascii, with a é accent")).toBeNull();
  });

  it("no file under app, components, lib, scripts, prisma or the docs contains it", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(50);
    const damaged = files.flatMap((file) => {
      const hit = firstDamage(fs.readFileSync(file, "utf8"));
      return hit ? [`${path.relative(REPO, file)}:${hit.line}  ${hit.text}`] : [];
    });
    expect(damaged).toEqual([]);
  });
});
