/**
 * Copy the Anchor build artefacts into web/ so the app can serve them.
 *
 * Run after `anchor build`:
 *
 *   cd web && npm run sync:idl
 *
 * The IDL is served to the browser by /api/idl and read by the server-side
 * program client. Keeping a copy under web/ means a Vercel deploy (which only
 * uploads the web directory) still has it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "..");

const jobs = [
  {
    from: path.join(repoRoot, "target", "idl", "rubric.json"),
    to: path.join(webRoot, "lib", "idl", "rubric.json"),
    label: "IDL",
  },
  {
    from: path.join(repoRoot, "target", "types", "rubric.ts"),
    to: path.join(webRoot, "lib", "idl", "rubric.ts"),
    label: "types",
  },
];

let copied = 0;
for (const job of jobs) {
  if (!fs.existsSync(job.from)) {
    console.error(`  missing: ${job.label} not found at ${job.from}`);
    continue;
  }
  fs.mkdirSync(path.dirname(job.to), { recursive: true });
  fs.copyFileSync(job.from, job.to);
  console.log(`  copied:  ${job.label} -> ${path.relative(webRoot, job.to)}`);
  copied++;
}

if (copied === 0) {
  console.error(
    "\nNothing copied. Run `anchor build` at the repo root first.\n" +
      "If you have no Rust toolchain yet, see the README's install section."
  );
  process.exit(1);
}

// Record which program id the IDL claims, so a mismatch with
// NEXT_PUBLIC_PROGRAM_ID is easy to spot.
try {
  const idl = JSON.parse(
    fs.readFileSync(path.join(webRoot, "lib", "idl", "rubric.json"), "utf8")
  );
  const address = idl.address ?? idl.metadata?.address;
  if (address) {
    console.log(`\n  Program id in the IDL: ${address}`);
    console.log("  Make sure NEXT_PUBLIC_PROGRAM_ID matches this.");
  }
} catch {
  // Not fatal - the copy already succeeded.
}
