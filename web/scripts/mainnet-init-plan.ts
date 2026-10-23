/**
 * Prepare the one-time protocol setup for a multisig to execute.
 *
 * THIS SCRIPT SIGNS NOTHING, SENDS NOTHING, READS NO KEY FILE AND WRITES NO FILE.
 *
 * It reads the chain, judges your plan against it, and - only on a second,
 * confirmed run - prints the two instructions (`initialize_config` and
 * `initialize_limits`) for the admin multisig to execute. It exists because
 * `initialize_config` fixes the admin, the mint, the fee and the fee destination
 * forever, there is no admin rotation, and the devnet script (init-config.ts)
 * loads the admin from a key file and defaults the mint and fee destination. None
 * of that is acceptable on mainnet.
 *
 *   # 1. Look: prints every check and a fingerprint of what you would make permanent.
 *   npx tsx scripts/mainnet-init-plan.ts \
 *     --rpc <url> --admin <multisig vault> --mint <mint> \
 *     --fee-destination <wallet> --verifier <pubkey>
 *
 *   # 2. Having read it, confirm with the fingerprint to get the instructions.
 *   npx tsx scripts/mainnet-init-plan.ts <the same arguments> --confirm <fingerprint>
 *
 * Arguments:
 *   --rpc               RPC endpoint (or RPC_URL). There is NO default: a default
 *                       cluster is how a rehearsal becomes the real thing.
 *   --admin             the multisig vault. Must equal the program's upgrade
 *                       authority, because initialize_config requires the signer to be it.
 *   --mint              REQUIRED, no default. On mainnet it must be Circle's USDC.
 *   --fee-destination   REQUIRED, no default. Not the admin, ideally.
 *   --verifier          the verifier's PUBLIC key. Generate the key on the server;
 *                       it never passes through here.
 *   --fee-bps           default 200 (2%), ceiling 1000, never changeable afterwards.
 *   --max-bounty        launch cap in whole USDC, default the launch value.
 *   --allow-eoa-admin   permit an ordinary keypair address as the mainnet admin.
 *   --confirm           the fingerprint printed by the first run.
 *
 * The judgements live in lib/init-plan.ts, where each one is unit-tested.
 */

import fs from "node:fs";
import path from "node:path";
import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { LAUNCH_MAX_BOUNTY_BASE_UNITS } from "../lib/constants";
import {
  clusterOf,
  evaluatePlan,
  fingerprint,
  isBlocked,
  type Facts,
  type PlanInputs,
} from "../lib/init-plan";

const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function fatal(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string): string {
  const v = arg(name);
  if (!v || v.startsWith("--")) fatal(`Missing --${name}. This script has no defaults for anything permanent.`);
  return v;
}

function pubkey(name: string, value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    return fatal(`--${name} is not a valid public key: ${value}`);
  }
}

function usdcToBaseUnits(text: string): bigint {
  if (!/^\d+$/.test(text)) fatal(`--max-bounty must be a whole number of USDC, got "${text}"`);
  return BigInt(text) * 1_000_000n;
}

async function main() {
  const rpc = arg("rpc") ?? process.env.RPC_URL;
  if (!rpc) fatal("Missing --rpc (or RPC_URL). There is no default cluster, on purpose.");

  const admin = pubkey("admin", required("admin"));
  const mint = pubkey("mint", required("mint"));
  const feeDestination = pubkey("fee-destination", required("fee-destination"));
  const verifier = pubkey("verifier", required("verifier"));
  const feeBps = Number(arg("fee-bps") ?? "200");
  const maxBounty = arg("max-bounty")
    ? usdcToBaseUnits(arg("max-bounty")!)
    : BigInt(LAUNCH_MAX_BOUNTY_BASE_UNITS);

  const inputs: PlanInputs = {
    admin: admin.toBase58(),
    mint: mint.toBase58(),
    feeDestination: feeDestination.toBase58(),
    verifier: verifier.toBase58(),
    feeBps,
    maxBounty,
    allowEoaAdmin: flag("allow-eoa-admin"),
  };

  const idlPath = path.join(process.cwd(), "lib", "idl", "rubric.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & { address: string };
  const programId = new PublicKey(idl.address);
  for (const needed of ["initialize_config", "initialize_limits"]) {
    if (!(idl.instructions ?? []).some((i) => i.name === needed)) {
      fatal(`lib/idl/rubric.json has no ${needed}. Rebuild the program and run \`npm run sync:idl\`.`);
    }
  }

  // ---- Read the chain --------------------------------------------------------
  const connection = new Connection(rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  const cluster = clusterOf(genesis);

  const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [limits] = PublicKey.findProgramAddressSync([Buffer.from("limits")], programId);
  const [feeTokenAccount] = PublicKey.findProgramAddressSync(
    [feeDestination.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [programInfo, pdInfo, configInfo, limitsInfo, mintInfo, feeInfo] = await Promise.all([
    connection.getAccountInfo(programId),
    connection.getAccountInfo(programData),
    connection.getAccountInfo(config),
    connection.getAccountInfo(limits),
    connection.getParsedAccountInfo(mint),
    connection.getAccountInfo(feeTokenAccount),
  ]);

  // ProgramData layout: 4-byte enum tag, 8-byte slot, 1-byte Option tag, 32-byte authority.
  let upgradeAuthority: string | null = null;
  if (pdInfo && pdInfo.data[12] === 1) {
    upgradeAuthority = new PublicKey(pdInfo.data.subarray(13, 45)).toBase58();
  }

  const parsedMint = mintInfo.value;
  const mintParsed =
    parsedMint && !Buffer.isBuffer(parsedMint.data) && "parsed" in parsedMint.data
      ? (parsedMint.data.parsed as { type?: string; info?: { decimals: number; freezeAuthority: string | null } })
      : null;

  const facts: Facts = {
    cluster,
    programDeployed: !!programInfo && programInfo.executable,
    upgradeAuthority,
    configExists: !!configInfo,
    limitsExists: !!limitsInfo,
    mint:
      parsedMint && mintParsed?.type === "mint" && mintParsed.info
        ? {
            owner: parsedMint.owner.toBase58(),
            decimals: mintParsed.info.decimals,
            freezeAuthority: mintParsed.info.freezeAuthority ?? null,
          }
        : null,
    feeDestinationTokenAccountExists: !!feeInfo,
    adminIsOnCurve: PublicKey.isOnCurve(admin.toBytes()),
  };

  // ---- Judge ------------------------------------------------------------------
  const checks = evaluatePlan(inputs, facts, programId.toBase58());
  const fp = fingerprint(inputs, programId.toBase58(), genesis);

  console.log("\nRUBRIC PROTOCOL SETUP PLAN  (read-only: nothing is signed or sent)\n");
  console.log("  cluster          :", cluster, `(genesis ${genesis.slice(0, 8)}...)`);
  console.log("  program          :", programId.toBase58());
  console.log("  admin            :", inputs.admin);
  console.log("  bounty mint      :", inputs.mint);
  console.log("  fee destination  :", inputs.feeDestination);
  console.log("  verifier         :", inputs.verifier);
  console.log("  fee              :", `${feeBps / 100}%`, `(${feeBps} bps)`);
  console.log("  launch cap       :", Number(maxBounty) / 1e6, "USDC");
  console.log("\nCHECKS");
  for (const c of checks) {
    const tag = c.severity === "pass" ? "PASS" : c.severity === "warn" ? "WARN" : "FAIL";
    console.log(`  ${tag}  ${c.message}`);
  }

  if (isBlocked(checks)) {
    fatal("BLOCKED: at least one check failed. Nothing will be printed until they all pass.");
  }

  const confirmed = arg("confirm");
  if (!confirmed) {
    console.log("\nEVERYTHING ABOVE BECOMES PERMANENT except the verifier and the launch cap.");
    console.log("There is no admin rotation, and the mint, fee and fee destination cannot be");
    console.log("changed by anyone, including you. Read the lines above, then re-run with:\n");
    console.log(`  --confirm ${fp}\n`);
    return;
  }
  if (confirmed !== fp) {
    fatal(
      `The fingerprint you passed (${confirmed}) does not match this plan (${fp}).\n` +
        "Something differs from the run you read. Start again from the first run."
    );
  }

  // ---- Print the instructions (unsigned) ----------------------------------------
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
  const methods = program.methods as never as Record<
    string,
    (...a: unknown[]) => {
      accounts(a: Record<string, PublicKey>): { instruction(): Promise<{ keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer }> };
    }
  >;

  const configIx = await methods
    .initializeConfig(verifier, mint, feeBps, feeDestination)
    .accounts({ admin, config, program: programId, programData, systemProgram: SystemProgram.programId })
    .instruction();
  const limitsIx = await methods
    .initializeLimits(new BN(maxBounty.toString()))
    .accounts({ admin, config, limits, systemProgram: SystemProgram.programId })
    .instruction();

  const rentConfig = await connection.getMinimumBalanceForRentExemption(8 + 32 + 32 + 32 + 2 + 32 + 1);
  const rentLimits = await connection.getMinimumBalanceForRentExemption(8 + 8 + 1 + 1);

  const names = (ix: string) =>
    (idl.instructions.find((i) => i.name === ix)?.accounts ?? []).map((a) => ("name" in a ? a.name : "?"));

  const print = (label: string, ixName: string, ix: typeof configIx) => {
    console.log(`\n--- ${label} ---`);
    console.log("program :", programId.toBase58());
    const labels = names(ixName);
    ix.keys.forEach((k, i) =>
      console.log(
        `  ${i}  ${k.pubkey.toBase58()}  ${k.isSigner ? "signer" : "      "} ${k.isWritable ? "writable" : "readonly"}  ${labels[i] ?? ""}`
      )
    );
    console.log("data hex   :", ix.data.toString("hex"));
    console.log("data base64:", ix.data.toString("base64"));
    return {
      programId: programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
      dataBase64: ix.data.toString("base64"),
    };
  };

  console.log("\nCONFIRMED. Instructions follow - execute BOTH as the admin multisig, in ONE");
  console.log("transaction, in this order. The admin is the payer, so the vault needs SOL:");
  console.log(`  rent for Config ${rentConfig} lamports + Limits ${rentLimits} lamports, plus fees.`);
  const json = [
    print("1 of 2: initialize_config", "initialize_config", configIx),
    print("2 of 2: initialize_limits", "initialize_limits", limitsIx),
  ];
  console.log("\n--- as JSON, for tooling that imports instructions ---");
  console.log(JSON.stringify(json, null, 2));
  console.log("\nAfterwards run this script's checks again with the same arguments (it should now");
  console.log("report the Config and Limits as existing) and read the accounts back on an explorer.");
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e);
  process.exit(1);
});
