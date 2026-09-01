/**
 * Seal real tasks on-chain, through the live app.
 *
 * This replaces the seeded samples with records that actually exist: a Task PDA
 * on the cluster, USDC really moved into an escrow account owned by that PDA,
 * and a transaction signature you can open in Explorer. Nothing about these is
 * illustrative.
 *
 * It goes through the deployed API rather than writing to the database, so the
 * same hash checks, the same confirmation path and the same on-chain reads run
 * as for any task a person creates. The only stand-in is the wallet: a keypair
 * signs where Phantom would.
 *
 *   APP_URL=https://rubric-protocol.vercel.app \
 *   RPC_URL=https://api.devnet.solana.com \
 *   npx tsx scripts/seal-real-tasks.mjs
 *
 * Requires the signing keypair to hold:
 *   - the cluster's SOL, for rent and fees (about 0.004 per task)
 *   - the mint named by the on-chain config, for the bounties themselves
 *
 * Safe to re-run: each call creates new tasks with fresh ids. It never deletes.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { AnchorProvider, Program } from "@anchor-lang/core";

import { fromHex } from "../lib/hash.ts";

const BN = createRequire(import.meta.url)("bn.js");

const APP = process.env.APP_URL ?? "https://rubric-protocol.vercel.app";
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_JSON = process.env.SIGNER_KEYPAIR_JSON;

if (!KEYPAIR_JSON) {
  console.error(
    "SIGNER_KEYPAIR_JSON is not set. Pass the signer's secret key as a JSON byte array."
  );
  process.exit(1);
}

const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(KEYPAIR_JSON)));
const idl = JSON.parse(fs.readFileSync("lib/idl/rubric.json", "utf8"));
const programId = new PublicKey(idl.address);
const conn = new Connection(RPC, "confirmed");

class LocalWallet {
  constructor(kp) {
    this.payer = kp;
    this.publicKey = kp.publicKey;
  }
  async signTransaction(tx) {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs) {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

const program = new Program(
  idl,
  new AnchorProvider(conn, new LocalWallet(signer), { commitment: "confirmed" })
);

async function api(route, init) {
  const response = await fetch(`${APP}${route}`, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* some error responses carry no JSON */
  }
  return { ok: response.ok, status: response.status, body };
}

const json = (payload) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

function taskPdaFor(creator, onchainTaskId) {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(onchainTaskId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("task"), creator.toBytes(), id],
    programId
  )[0];
}

/** Read the deployment's config so we escrow the mint it actually accepts. */
async function readConfig() {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  const info = await conn.getAccountInfo(configPda);
  if (!info) throw new Error(`No config at ${configPda.toBase58()} on ${RPC}`);
  let o = 8;
  const readKey = () => {
    const k = new PublicKey(info.data.subarray(o, o + 32));
    o += 32;
    return k;
  };
  readKey(); // admin
  readKey(); // verifier authority
  return { configPda, bountyMint: readKey() };
}

// The tasks to seal. Deliberately modest bounties: these are real transfers.
const TASKS = [
  {
    title: "Write 8 product descriptions for a coffee catalogue",
    clauses: [
      "Each description is between 40 and 60 words.",
      "No description repeats a phrase from another.",
      "Tasting notes name at least two specific flavours.",
    ],
    category: "Content",
    usdc: 1,
    windowHours: 72,
  },
  {
    title: "Label 200 warehouse shelf photos",
    clauses: [
      "Every barcode in the delivered labels is legible and in focus.",
      "Images too blurred to read are excluded rather than guessed at.",
      "There is exactly one label per image.",
    ],
    category: "Labeling",
    usdc: 1,
    windowHours: 72,
  },
  {
    title: "Port the CSV importer to streaming",
    clauses: [
      "The importer handles a 2 GB file without exceeding 256 MB of memory.",
      "Existing tests pass unchanged.",
      "Malformed rows are reported with a line number, not swallowed.",
    ],
    category: "Code",
    usdc: 1,
    windowHours: 72,
  },
];

// Sealing costs real rent - about 0.0052 SOL per task for the Task PDA and its
// escrow account - so allow a run to be capped rather than failing halfway
// through a sequence that moves money.
const LIMIT = Number(process.env.LIMIT ?? TASKS.length);
TASKS.length = Math.min(TASKS.length, Math.max(1, LIMIT));

const { configPda, bountyMint } = await readConfig();
const signerAta = getAssociatedTokenAddressSync(bountyMint, signer.publicKey);

console.log("Sealing real tasks");
console.log("  app        :", APP);
console.log("  rpc        :", RPC);
console.log("  signer     :", signer.publicKey.toBase58());
console.log("  config     :", configPda.toBase58());
console.log("  bounty mint:", bountyMint.toBase58());

const sol = (await conn.getBalance(signer.publicKey)) / 1e9;
let held = 0;
try {
  held = Number((await getAccount(conn, signerAta)).amount) / 1e6;
} catch {
  held = 0;
}
const needed = TASKS.reduce((sum, t) => sum + t.usdc, 0);
console.log(`  SOL        : ${sol.toFixed(4)}`);
console.log(`  bounty tok : ${held}  (need ${needed})`);

if (held < needed) {
  console.error(
    `\nNot enough of the bounty mint. Need ${needed}, hold ${held}.\n` +
      `Fund ${signer.publicKey.toBase58()} with mint ${bountyMint.toBase58()} and re-run.`
  );
  process.exit(1);
}
if (sol < 0.01) {
  console.error(`\nNot enough SOL for rent and fees. Have ${sol}, want at least 0.01.`);
  process.exit(1);
}

let sealed = 0;
for (const spec of TASKS) {
  const baseUnits = Math.round(spec.usdc * 1e6);
  const deadline = Math.floor(Date.now() / 1000) + spec.windowHours * 3600;

  const draft = await api(
    "/api/tasks",
    json({
      title: spec.title,
      clauses: spec.clauses,
      category: spec.category,
      bountyAmount: String(baseUnits),
      deadline,
      mint: bountyMint.toBase58(),
      creatorAddress: signer.publicKey.toBase58(),
    })
  );
  if (!draft.ok) {
    console.error(`  draft failed (${draft.status}):`, JSON.stringify(draft.body));
    continue;
  }
  const { id, taskId: onchainTaskId, rubricHash } = draft.body;

  const signature = await program.methods
    .createTask(
      new BN(onchainTaskId),
      Array.from(fromHex(rubricHash)),
      new BN(baseUnits),
      new BN(deadline)
    )
    .accounts({
      creator: signer.publicKey,
      task: taskPdaFor(signer.publicKey, onchainTaskId),
      mint: bountyMint,
      creatorTokenAccount: signerAta,
    })
    .rpc();

  const confirm = await api(
    "/api/tasks/confirm",
    json({ id, signature, kind: "create" })
  );
  if (!confirm.ok) {
    console.error(`  confirm failed (${confirm.status}):`, JSON.stringify(confirm.body));
    continue;
  }

  sealed++;
  console.log(`\n  SEALED  ${spec.title}`);
  console.log(`    task     ${id}  (on-chain id ${onchainTaskId})`);
  console.log(`    state    ${confirm.body.state}`);
  console.log(`    tx       ${signature}`);
  console.log(`    explorer https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

console.log(`\n${sealed} of ${TASKS.length} tasks sealed on-chain.`);
process.exit(sealed === TASKS.length ? 0 : 1);
