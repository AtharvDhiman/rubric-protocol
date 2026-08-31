/**
 * One-time protocol setup: generate the verifier keypair and call
 * `initialize_config`.
 *
 *   npx tsx scripts/init-config.ts --admin ~/.config/solana/id.json
 *
 * WHAT THIS DECIDES, PERMANENTLY
 * ------------------------------
 * `initialize_config` can only ever succeed once - the Config PDA is created
 * with `init`, so the first caller wins and there is no second attempt. It
 * records:
 *
 *   admin              the signer. Only account that can rotate the verifier.
 *   verifier_authority the ONLY key the program accepts a verdict from, which
 *                      means the only key that can move escrowed money.
 *   bounty_mint        the single SPL mint this deployment escrows in.
 *   fee_destination    wallet that receives the protocol fee.
 *
 * WHO CAN RUN IT
 * --------------
 * The signer must be the program's UPGRADE AUTHORITY. That is enforced
 * on-chain (see initialize_config.rs) and it is what stops a bystander from
 * front-running setup between deploy and init. Transfer the upgrade authority
 * first if the intended admin is a different wallet:
 *
 *   solana program set-upgrade-authority <PROGRAM_ID> \
 *     --new-upgrade-authority <ADMIN_PUBKEY> --url devnet
 *
 * THE VERIFIER SECRET
 * -------------------
 * This script writes the verifier keypair to `verifier.json` in the repo root
 * and prints ONLY its public key. `.gitignore` already excludes `verifier.json`
 * and `keypair*.json`. Put the secret in VERIFIER_SECRET_KEY server-side and
 * nowhere else. Anyone holding it can approve or reject any task, which is why
 * MAX_BOUNTY caps a single task at 50 USDC.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AnchorProvider, Program, type Idl } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);
/** Circle's devnet USDC. NOT the mainnet mint. */
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const FEE_BPS = 200;

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

async function main() {
  const admin = loadKeypair(arg("admin"));
  const mint = new PublicKey(arg("mint", DEVNET_USDC));
  const feeDestination = new PublicKey(
    arg("fee-destination", admin.publicKey.toBase58())
  );

  const idlPath = path.join(process.cwd(), "lib", "idl", "rubric.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl & {
    address: string;
  };
  const programId = new PublicKey(idl.address);

  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new CliWallet(admin) as never, {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  const [programData] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  );

  console.log("cluster          :", RPC);
  console.log("program          :", programId.toBase58());
  console.log("admin (signer)   :", admin.publicKey.toBase58());
  console.log("bounty mint      :", mint.toBase58());
  console.log("fee destination  :", feeDestination.toBase58());
  console.log("fee              :", FEE_BPS / 100 + "%");
  console.log("config PDA       :", configPda.toBase58());

  // ---- Preflight, so failures are explained rather than raw ----------------
  if (await connection.getAccountInfo(configPda)) {
    console.error(
      "\nConfig already exists. initialize_config runs exactly once and cannot " +
        "be re-run.\nUse set_verifier_authority to rotate the verifier instead."
    );
    process.exit(1);
  }
  const pdAccount = await connection.getAccountInfo(programData);
  if (!pdAccount) {
    console.error("\nNo ProgramData account. Is the program deployed to this cluster?");
    process.exit(1);
  }
  // ProgramData layout: 4-byte enum, 8-byte slot, 1-byte Option, 32-byte pubkey.
  const hasAuthority = pdAccount.data[12] === 1;
  const upgradeAuthority = hasAuthority
    ? new PublicKey(pdAccount.data.subarray(13, 45))
    : null;
  console.log("upgrade authority:", upgradeAuthority?.toBase58() ?? "none (immutable)");

  if (!upgradeAuthority || !upgradeAuthority.equals(admin.publicKey)) {
    console.error(
      "\nThe admin you passed is NOT the program's upgrade authority, and the " +
        "program requires that.\nTransfer it first:\n\n" +
        `  solana program set-upgrade-authority ${programId.toBase58()} \\\n` +
        `    --new-upgrade-authority ${admin.publicKey.toBase58()} --url devnet\n`
    );
    process.exit(1);
  }

  const balance = await connection.getBalance(admin.publicKey);
  if (balance < 3_000_000) {
    console.error(`\nAdmin has ${balance / 1e9} SOL; needs a little for rent and fees.`);
    process.exit(1);
  }

  // ---- The verifier keypair ------------------------------------------------
  const verifierPath = path.resolve(process.cwd(), "..", "verifier.json");
  let verifier: Keypair;
  if (fs.existsSync(verifierPath)) {
    verifier = loadKeypair(verifierPath);
    console.log("verifier         :", verifier.publicKey.toBase58(), "(existing)");
  } else {
    verifier = Keypair.generate();
    fs.writeFileSync(verifierPath, JSON.stringify(Array.from(verifier.secretKey)));
    console.log("verifier         :", verifier.publicKey.toBase58(), "(new)");
  }

  // ---- Send ----------------------------------------------------------------
  console.log("\nsending initialize_config...");
  const sig = await (program.methods as never as Record<string, (...a: unknown[]) => {
    accounts(a: Record<string, PublicKey>): { rpc(): Promise<string> };
  }>)
    .initializeConfig(verifier.publicKey, mint, FEE_BPS, feeDestination)
    .accounts({
      admin: admin.publicKey,
      config: configPda,
      program: programId,
      programData,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("\nDONE. signature:", sig);
  console.log(
    `https://explorer.solana.com/tx/${sig}?cluster=devnet\n`
  );
  console.log("Put this in web/.env, server-side only:");
  console.log(`VERIFIER_SECRET_KEY=${bs58.encode(verifier.secretKey)}`);
  console.log(`\nThe secret is also at ${verifierPath} (gitignored). Back it up.`);
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message ?? e);
  process.exit(1);
});
