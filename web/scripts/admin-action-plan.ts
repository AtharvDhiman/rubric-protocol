/**
 * Prepare one admin action for the multisig to execute.
 *
 * THIS SCRIPT SIGNS NOTHING, SENDS NOTHING, READS NO KEY FILE AND WRITES NO FILE.
 *
 * On mainnet the admin is a multisig, so the four admin levers cannot be pulled with
 * a key file the way scripts/init-limits.ts does on devnet. This reads the chain,
 * judges the proposal against it, and - only on a second, confirmed run - prints the
 * ONE instruction for the signers to execute. It exists so that a proposal handed to
 * signers is checked first: addressed to the real admin, not a no-op, and above all
 * not a rotation to a verifier wallet that cannot pay (which would make every task
 * fail to settle the moment it lands).
 *
 * Exactly one action per run:
 *   --pause                         stop NEW tasks. Existing escrow is unaffected.
 *   --unpause                       reopen new tasks.
 *   --set-max-bounty <usdc>         the bounty cap, whole USDC.
 *   --set-fee-destination <wallet>  who collects the protocol fee.
 *   --set-verifier <pubkey>         rotate the verifier key (see docs/verifier-runbook.md).
 *
 *   # 1. Look: prints every check, what the action does, and a fingerprint.
 *   npx tsx scripts/admin-action-plan.ts --rpc <url> --admin <multisig vault> --pause
 *
 *   # 2. Having read it, confirm with the fingerprint to get the instruction.
 *   npx tsx scripts/admin-action-plan.ts <the same arguments> --confirm <fingerprint>
 *
 * Arguments:
 *   --rpc      RPC endpoint (or RPC_URL). There is NO default: a default cluster is how
 *              a rehearsal becomes the real thing. It is never printed back, because
 *              RPC URLs often carry an API key.
 *   --admin    the multisig vault. Must equal Config.admin on-chain or the plan fails.
 *   --confirm  the fingerprint printed by the first run.
 *
 * The judgements live in lib/admin-plan.ts, where each one is unit-tested.
 */

import fs from "node:fs";
import path from "node:path";
import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ADMIN_INSTRUCTIONS,
  describeAction,
  evaluateAdminAction,
  fingerprintAdmin,
  parseAdminArgs,
  type AdminFacts,
  type AdminInputs,
} from "../lib/admin-plan";
import { clusterOf, isBlocked } from "../lib/init-plan";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** A token account is 165 bytes; this is its rent-exempt minimum, read below from the chain. */
const TOKEN_ACCOUNT_BYTES = 165;

function fatal(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** An error whose message names only a field or a file, so it is safe to print. */
class PlanError extends Error {}

/**
 * Read a public key off a decoded account. The accounts are fetched through a loosely
 * typed client, so a misspelt or renamed field is `undefined` rather than a compile
 * error - and a stale lib/idl/rubric.json looks exactly the same. Say which.
 */
function pubkeyField(account: Record<string, unknown>, accountName: string, field: string): PublicKey {
  const value = account[field] as { toBase58?: unknown } | undefined;
  if (!value || typeof value.toBase58 !== "function") {
    throw new PlanError(
      `The ${accountName} account has no "${field}" field. lib/idl/rubric.json may be stale: run \`npm run sync:idl\`.`
    );
  }
  return value as PublicKey;
}

function readLimits(account: Record<string, unknown>): { maxBounty: bigint; paused: boolean } {
  const cap = account.maxBounty as { toString?: () => string } | undefined;
  if (!cap || typeof cap.toString !== "function" || typeof account.paused !== "boolean") {
    throw new PlanError(
      'The Limits account is missing "maxBounty" or "paused". lib/idl/rubric.json may be stale: run `npm run sync:idl`.'
    );
  }
  return { maxBounty: BigInt(cap.toString()), paused: account.paused };
}

type IxLike = { keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer };
type MethodBuilder = (...args: unknown[]) => {
  accounts(a: Record<string, PublicKey>): { instruction(): Promise<IxLike> };
};
type FetchNullable<T> = { fetchNullable(a: PublicKey): Promise<T | null> };

async function main() {
  const parsed = parseAdminArgs(process.argv.slice(2));
  if (!parsed.ok) fatal(parsed.error);
  const { admin: adminText, action, confirm } = parsed.value;

  const rpc = parsed.value.rpc ?? process.env.RPC_URL;
  if (!rpc) fatal("Missing --rpc (or RPC_URL). There is no default cluster, on purpose.");

  let admin: PublicKey;
  try {
    admin = new PublicKey(adminText);
  } catch {
    return fatal(`--admin is not a valid public key: ${adminText}`);
  }

  const idlPath = path.join(process.cwd(), "lib", "idl", "rubric.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & { address: string };
  const programId = new PublicKey(idl.address);
  const spec = ADMIN_INSTRUCTIONS[action.kind];
  if (!(idl.instructions ?? []).some((i) => i.name === spec.idlName)) {
    fatal(`lib/idl/rubric.json has no ${spec.idlName}. Rebuild the program and run \`npm run sync:idl\`.`);
  }

  // ---- Read the chain --------------------------------------------------------
  const connection = new Connection(rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  const cluster = clusterOf(genesis);

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
  const program = new Program(idl, provider);
  const accounts = program.account as unknown as Record<string, FetchNullable<Record<string, unknown>>>;

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [limitsPda] = PublicKey.findProgramAddressSync([Buffer.from("limits")], programId);

  const programInfo = await connection.getAccountInfo(programId);
  const configAccount = await accounts.config.fetchNullable(configPda);
  const limitsAccount = await accounts.limits.fetchNullable(limitsPda);

  const facts: AdminFacts = {
    cluster,
    programDeployed: !!programInfo && programInfo.executable,
    config: configAccount
      ? {
          admin: pubkeyField(configAccount, "Config", "admin").toBase58(),
          verifierAuthority: pubkeyField(configAccount, "Config", "verifierAuthority").toBase58(),
          feeDestination: pubkeyField(configAccount, "Config", "feeDestination").toBase58(),
        }
      : null,
    limits: limitsAccount ? readLimits(limitsAccount) : null,
    feeDestinationTokenAccountExists: null,
    verifierWallet: null,
  };

  // Only the facts this action needs, so an unrelated RPC hiccup cannot block it.
  if (action.kind === "set-fee-destination" && configAccount) {
    const destination = new PublicKey(action.feeDestination);
    const mint = pubkeyField(configAccount, "Config", "bountyMint");
    const [ata] = PublicKey.findProgramAddressSync(
      [destination.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    facts.feeDestinationTokenAccountExists = !!(await connection.getAccountInfo(ata));
  }
  if (action.kind === "set-verifier") {
    try {
      const verifier = new PublicKey(action.verifier);
      const [balance, rentFloor, tokenRent] = await Promise.all([
        connection.getBalance(verifier),
        connection.getMinimumBalanceForRentExemption(0),
        connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_BYTES),
      ]);
      facts.verifierWallet = {
        balanceLamports: balance,
        rentFloorLamports: rentFloor,
        tokenAccountRentLamports: tokenRent,
        isOnCurve: PublicKey.isOnCurve(verifier.toBytes()),
      };
    } catch {
      facts.verifierWallet = null; // the plan then fails, loudly, on VERIFIER_FUNDED
    }
  }

  // ---- Judge -----------------------------------------------------------------
  const inputs: AdminInputs = { admin: admin.toBase58(), action };
  const checks = evaluateAdminAction(inputs, facts, programId.toBase58());
  const fp = fingerprintAdmin(inputs, programId.toBase58(), genesis);
  const brief = describeAction(action);

  console.log(`\nRUBRIC ADMIN ACTION PLAN  (read-only: nothing is signed or sent)\n`);
  console.log(`  action   : ${brief.title}`);
  console.log(`  cluster  : ${cluster} (genesis ${genesis.slice(0, 8)}...)`);
  console.log(`  program  : ${programId.toBase58()}`);
  console.log(`  admin    : ${inputs.admin}`);
  if (facts.config) {
    console.log(`  verifier : ${facts.config.verifierAuthority}   (now)`);
    console.log(`  fee dest : ${facts.config.feeDestination}   (now)`);
  }
  if (facts.limits) {
    console.log(`  cap      : ${Number(facts.limits.maxBounty) / 1e6} USDC   (now)`);
    console.log(`  paused   : ${facts.limits.paused}   (now)`);
  }

  console.log("\nWHAT IT DOES");
  for (const line of brief.effect) console.log(`  - ${line}`);

  console.log("\nCHECKS");
  for (const c of checks) {
    const tag = c.severity === "pass" ? "PASS" : c.severity === "warn" ? "WARN" : "FAIL";
    console.log(`  ${tag}  ${c.message}`);
  }

  if (isBlocked(checks)) {
    fatal("BLOCKED: at least one check failed. Nothing will be printed until they all pass.");
  }

  if (!confirm) {
    console.log("\nRead the lines above, then re-run with the same arguments and:\n");
    console.log(`  --confirm ${fp}\n`);
    return;
  }
  if (confirm !== fp) {
    fatal(
      `The fingerprint you passed (${confirm}) does not match this plan (${fp}).\n` +
        "Something differs from the run you read. Start again from the first run."
    );
  }

  // ---- Print the instruction (unsigned) --------------------------------------
  const methods = program.methods as never as Record<string, MethodBuilder>;
  const args: unknown[] =
    action.kind === "pause"
      ? [true]
      : action.kind === "unpause"
        ? [false]
        : action.kind === "set-max-bounty"
          ? [new BN(action.maxBounty.toString())]
          : action.kind === "set-fee-destination"
            ? [new PublicKey(action.feeDestination)]
            : [new PublicKey(action.verifier)];

  const accountMap: Record<string, PublicKey> = { admin, config: configPda, limits: limitsPda };
  const ix = await methods[spec.method](...args)
    .accounts(Object.fromEntries(spec.accounts.map((name) => [name, accountMap[name]])))
    .instruction();

  const labels = (idl.instructions.find((i) => i.name === spec.idlName)?.accounts ?? []).map((a) =>
    "name" in a ? a.name : "?"
  );

  console.log(`\nCONFIRMED. Execute this ONE instruction as the admin multisig.`);
  if (brief.before.length) {
    console.log("\nBEFORE you execute:");
    for (const line of brief.before) console.log(`  - ${line}`);
  }
  console.log(`\n--- ${spec.idlName} ---`);
  console.log("program :", programId.toBase58());
  ix.keys.forEach((k, i) =>
    console.log(
      `  ${i}  ${k.pubkey.toBase58()}  ${k.isSigner ? "signer" : "      "} ${k.isWritable ? "writable" : "readonly"}  ${labels[i] ?? ""}`
    )
  );
  console.log("data hex   :", ix.data.toString("hex"));
  console.log("data base64:", ix.data.toString("base64"));
  console.log("\n--- as JSON, for tooling that imports instructions ---");
  console.log(
    JSON.stringify(
      {
        programId: programId.toBase58(),
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
        dataBase64: ix.data.toString("base64"),
      },
      null,
      2
    )
  );
  if (brief.after.length) {
    console.log("\nAFTER it lands:");
    for (const line of brief.after) console.log(`  - ${line}`);
  }
  console.log("\nRe-run this script's first step with the same arguments: the change should now show as already made.\n");
}

main().catch((error: unknown) => {
  // The error's NAME only. An RPC or fetch error can carry the endpoint URL, and RPC
  // URLs very often contain an API key; this output ends up in terminals and chat.
  if (error instanceof PlanError) fatal(error.message);
  const name = error instanceof Error ? error.name : "unknown error";
  fatal(
    `The plan failed unexpectedly (${name}). The RPC endpoint may have failed or be rate-limiting ` +
      `(public endpoints do): retry, then check --rpc and that the program is initialised there.`
  );
});
