/**
 * One-time DEVNET setup after upgrading to a program that has `Limits`:
 * create the Limits account (the bounty cap and the pause switch).
 *
 *   npx tsx scripts/init-limits.ts --admin ~/.config/solana/id.json
 *   npx tsx scripts/init-limits.ts --admin ~/.config/solana/id.json --max-bounty 50
 *
 * WHY THIS MUST RUN
 * -----------------
 * `create_task` REQUIRES the Limits account, so a deployment that has been
 * upgraded to this program takes no new tasks until this has been run. That is
 * deliberate: a missing account must read as "cannot create", never as "no cap".
 * Existing tasks are unaffected throughout - settle, refund and reclaim never
 * read Limits.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It refuses to run against mainnet. It identifies mainnet by its GENESIS HASH,
 * not by trusting the RPC URL, because a URL is exactly the thing that gets
 * mistyped. For mainnet the admin is a multisig and the instruction is run by it;
 * see scripts/mainnet-init-plan.ts, which prints the instruction and signs nothing.
 *
 * It also checks that the key you passed really is `Config.admin` before sending,
 * so a wrong key fails with a sentence rather than an on-chain error code.
 *
 * Arguments:
 *   --admin        path to the admin keypair JSON (DEVNET key; the file is read here)
 *   --max-bounty   the launch cap in USDC (default: the launch value in lib/constants.ts)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { LAUNCH_MAX_BOUNTY_BASE_UNITS } from "../lib/constants";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";

/** The mainnet-beta genesis hash. A script that must never touch mainnet checks THIS. */
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

function loadKeypair(p: string): Keypair {
  const resolved = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Minimal wallet. Anchor's own Wallet class is not exported from its ESM build. */
class CliWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

/** "50" -> 50_000_000n. Whole USDC only: a cap is a policy number, not a price. */
function usdcToBaseUnits(text: string): bigint {
  if (!/^\d+$/.test(text)) throw new Error(`--max-bounty must be a whole number of USDC, got "${text}"`);
  return BigInt(text) * 1_000_000n;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");

  // ---- Never mainnet --------------------------------------------------------
  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_GENESIS) {
    console.error(
      "\nREFUSING: this RPC is mainnet-beta (genesis hash matches).\n" +
        "This script reads an admin key from a FILE and is for devnet only.\n" +
        "On mainnet the admin is a multisig: use scripts/mainnet-init-plan.ts, which\n" +
        "prints the instruction for the multisig to execute and signs nothing.\n"
    );
    process.exit(1);
  }

  const admin = loadKeypair(arg("admin"));
  const maxBounty = process.argv.includes("--max-bounty")
    ? usdcToBaseUnits(arg("max-bounty"))
    : BigInt(LAUNCH_MAX_BOUNTY_BASE_UNITS);

  const idlPath = path.join(process.cwd(), "lib", "idl", "rubric.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & { address: string };
  const programId = new PublicKey(idl.address);
  const provider = new AnchorProvider(connection, new CliWallet(admin) as never, {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const [limitsPda] = PublicKey.findProgramAddressSync([Buffer.from("limits")], programId);

  console.log("cluster          :", RPC, `(genesis ${genesis.slice(0, 8)}...)`);
  console.log("program          :", programId.toBase58());
  console.log("admin (signer)   :", admin.publicKey.toBase58());
  console.log("launch cap       :", Number(maxBounty) / 1e6, "USDC");
  console.log("limits PDA       :", limitsPda.toBase58());

  // ---- Preflight, so failures are explained rather than raw -----------------
  const idlHasLimits = (idl.instructions ?? []).some((i) => i.name === "initialize_limits");
  if (!idlHasLimits) {
    console.error(
      "\nlib/idl/rubric.json has no initialize_limits instruction. Rebuild the program and\n" +
        "run `npm run sync:idl` first - this IDL predates Limits."
    );
    process.exit(1);
  }
  const accounts = program.account as unknown as Record<
    string,
    { fetch(a: PublicKey): Promise<{ admin: PublicKey }> }
  >;
  let onChainAdmin: PublicKey;
  try {
    onChainAdmin = (await accounts.config.fetch(configPda)).admin;
  } catch {
    console.error("\nNo Config at this address. Is this program initialised on this cluster?");
    process.exit(1);
  }
  if (!onChainAdmin.equals(admin.publicKey)) {
    console.error(
      `\nThe key you passed is NOT this deployment's admin.\n  Config.admin : ${onChainAdmin.toBase58()}\n  you passed   : ${admin.publicKey.toBase58()}\n`
    );
    process.exit(1);
  }
  if (await connection.getAccountInfo(limitsPda)) {
    console.error(
      "\nLimits already exists. initialize_limits runs exactly once.\n" +
        "Use set_max_bounty / set_paused to change it."
    );
    process.exit(1);
  }
  const balance = await connection.getBalance(admin.publicKey);
  if (balance < 2_000_000) {
    console.error(`\nAdmin has ${balance / 1e9} SOL; needs a little for rent and fees.`);
    process.exit(1);
  }

  // ---- Send -----------------------------------------------------------------
  console.log("\nsending initialize_limits...");
  const sig = await (program.methods as never as Record<string, (...a: unknown[]) => {
    accounts(a: Record<string, PublicKey>): { rpc(): Promise<string> };
  }>)
    .initializeLimits(new BN(maxBounty.toString()))
    .accounts({
      admin: admin.publicKey,
      config: configPda,
      limits: limitsPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nDONE. signature:", sig);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
  console.log("New tasks can be sealed again. Existing tasks were never affected.");
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e);
  process.exit(1);
});
