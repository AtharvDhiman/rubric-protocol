/**
 * Localnet only: deploy-time setup for the end-to-end run.
 *
 * Initializes the Config PDA against a local validator with a mint we control,
 * so the whole seal -> submit -> judge -> settle path can be exercised without
 * needing Circle's devnet USDC faucet. Never point this at devnet or mainnet:
 * `initialize_config` succeeds exactly once per deployment and cannot be undone.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@anchor-lang/core";

const RPC = "http://127.0.0.1:8899";

const signers = JSON.parse(
  fs.readFileSync(path.join(process.env.TEMP, "e2e-signers.json"), "utf8")
);
const admin = Keypair.fromSecretKey(Uint8Array.from(signers.admin));
const idl = JSON.parse(fs.readFileSync("lib/idl/rubric.json", "utf8"));
const programId = new PublicKey(idl.address);
const conn = new Connection(RPC, "confirmed");

class LocalWallet {
  constructor(kp) {
    this.payer = kp;
    this.publicKey = kp.publicKey;
  }
  async signTransaction(tx) {
    // Legacy Transaction takes varargs; VersionedTransaction takes an array.
    // Same distinction lib/server/program.ts makes.
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs) {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

const provider = new AnchorProvider(conn, new LocalWallet(admin), {
  commitment: "confirmed",
});
const program = new Program(idl, provider);

const mint = new PublicKey(signers.mint);
const verifier = new PublicKey(process.argv[2]);

const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const [programData] = PublicKey.findProgramAddressSync(
  [programId.toBytes()],
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111")
);

const [limits] = PublicKey.findProgramAddressSync([Buffer.from("limits")], programId);

if (await conn.getAccountInfo(config)) {
  console.log("  config already initialized at", config.toBase58());
} else {
  const sig = await program.methods
    .initializeConfig(verifier, mint, 200, admin.publicKey)
    .accounts({
      admin: admin.publicKey,
      config,
      program: programId,
      programData,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("  initialize_config:", sig);
  console.log("  config PDA :", config.toBase58());
  console.log("  admin      :", admin.publicKey.toBase58());
  console.log("  verifier   :", verifier.toBase58());
  console.log("  bounty mint:", mint.toBase58());
}

// `create_task` REQUIRES the Limits account, so a protocol without one takes no
// tasks at all. Created separately from the config, and only if missing, so this
// script is safe to re-run against a validator that was initialised before Limits
// existed. 50 USDC is the launch cap.
if (await conn.getAccountInfo(limits)) {
  console.log("  limits already initialized at", limits.toBase58());
} else {
  const sig = await program.methods
    .initializeLimits(new BN(50_000_000))
    .accounts({
      admin: admin.publicKey,
      config,
      limits,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("  initialize_limits:", sig);
  console.log("  limits PDA :", limits.toBase58(), "(cap 50 USDC, unpaused)");
}
