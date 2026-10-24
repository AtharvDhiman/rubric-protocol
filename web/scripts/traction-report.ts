/**
 * Print Rubric's traction figures, computed from the chain.
 *
 * THIS SCRIPT SIGNS NOTHING, SENDS NOTHING, READS NO KEY FILE AND WRITES NO FILE.
 *
 * It reads every Task account the program owns, and the program's Config, and works out
 * tasks, unique posters, unique workers and settled volume. Because tasks are never closed,
 * the chain is a complete record: anyone can run this against their own RPC endpoint and
 * get the same numbers, which is the point. A figure from our database would be a claim; a
 * figure anyone can recompute is not.
 *
 *   npx tsx scripts/traction-report.ts --rpc <url>
 *   npx tsx scripts/traction-report.ts --rpc <url> --json
 *
 * Arguments:
 *   --rpc      RPC endpoint (or RPC_URL). There is NO default: a default cluster is how a test
 *              network's numbers get quoted as the real thing. It is never printed back,
 *              because RPC URLs often carry an API key.
 *   --program  the program id, if it is not the one in lib/idl/rubric.json.
 *   --json     machine-readable output. Amounts are exact decimal strings.
 *
 * On any cluster other than mainnet the report is headed TEST NETWORK - NOT TRACTION before
 * a single figure. Read the caveats it prints: this measures activity, not demand, and the
 * logic that produces the numbers (and why volume in particular cannot be trusted on its
 * own) is in lib/traction.ts.
 *
 * Some RPC providers restrict getProgramAccounts. If this fails for that reason, use an
 * endpoint that allows it; this script needs nothing else.
 */

import fs from "node:fs";
import path from "node:path";
import { AnchorProvider, Program, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadTractionReport, readProvenance, type TractionProgram } from "../lib/traction-chain";
import { formatTractionText, tractionToJson } from "../lib/traction-format";

function fatal(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const KNOWN = new Set(["--rpc", "--program", "--json"]);

async function main() {
  // Strict, like the other scripts: a mistyped flag silently doing something else is how a
  // report ends up on the wrong cluster.
  for (const token of process.argv.slice(2)) {
    if (token.startsWith("--") && !KNOWN.has(token)) fatal(`Unknown option ${token}.`);
  }

  const rpc = arg("rpc") ?? process.env.RPC_URL;
  if (!rpc || rpc.startsWith("--")) fatal("Missing --rpc (or RPC_URL). There is no default cluster, on purpose.");

  const idlPath = path.join(process.cwd(), "lib", "idl", "rubric.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & { address: string };

  let programId: PublicKey;
  try {
    programId = new PublicKey(arg("program") ?? idl.address);
  } catch {
    return fatal("--program is not a valid public key.");
  }

  const connection = new Connection(rpc, "confirmed");
  // A provider that cannot sign. Reading never needs to, and it fails loudly if that changes.
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async () => {
        throw new Error("this script never signs");
      },
      signAllTransactions: async () => {
        throw new Error("this script never signs");
      },
    } as never,
    { commitment: "confirmed" }
  );
  const program = new Program({ ...idl, address: programId.toBase58() }, provider);

  const provenance = await readProvenance(connection, programId);
  const { report } = await loadTractionReport(program as unknown as TractionProgram);

  console.log(flag("json") ? tractionToJson(report, provenance) : formatTractionText(report, provenance));
}

main().catch((error: unknown) => {
  // A message we wrote ourselves is safe to show. Anything else is named, not quoted: an RPC
  // or fetch error can carry the endpoint URL, and RPC URLs very often contain an API key.
  const safe = error instanceof Error && error.message.startsWith("Could not read the program's Config");
  if (safe) fatal((error as Error).message);
  const name = error instanceof Error ? error.name : "unknown error";
  fatal(
    `The report failed (${name}). The RPC endpoint may have failed or be rate-limiting, or may restrict ` +
      "getProgramAccounts, which this needs. Retry, or use an endpoint that allows it."
  );
});
