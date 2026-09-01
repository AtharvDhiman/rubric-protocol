/**
 * Prove the deployed judge and verifier keys are not merely present but CORRECT.
 *
 * Setting a secret in a hosting dashboard tells you a value exists. It does not
 * tell you it is the right value, and Vercel's Secret type cannot be read back.
 * The only honest check is to run the thing: submit work through the deployed
 * API, let the deployed judge rule on it, and see whether the deployed verifier
 * key can actually sign `submit_verdict` — which the program only accepts from
 * the pubkey recorded in `config.verifier_authority`.
 *
 * A wrong GEMINI_API_KEY shows up as a held task. A wrong VERIFIER_SECRET_KEY
 * shows up as a settle that the chain rejects. Both are visible from outside.
 *
 *   SIGNER_KEYPAIR_JSON='[...]' TASK_ID=... npx tsx scripts/prove-deployment.mjs
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
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import { hashSubmissionHex, fromHex } from "../lib/hash.ts";
import { workerAuthMessage } from "../lib/worker-auth.ts";

const require_ = createRequire(import.meta.url);
const BN = require_("bn.js");

const APP = process.env.APP_URL ?? "https://rubric-protocol.vercel.app";
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const TASK_ID = process.env.TASK_ID;
const KEYPAIR_JSON = process.env.SIGNER_KEYPAIR_JSON;

if (!KEYPAIR_JSON) {
  console.error("SIGNER_KEYPAIR_JSON is required.");
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
  const r = await fetch(`${APP}${route}`, init);
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* not every response carries JSON */
  }
  return { ok: r.ok, status: r.status, body };
}

const json = (payload) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const SUBMISSION = [
  "Rewrote the importer around a streaming parser rather than reading the file",
  "into memory. Peak RSS on the 2 GB fixture is 190 MB, measured with",
  "/usr/bin/time -v across three runs, so it stays well under the 256 MB ceiling.",
  "The existing suite passes unchanged: 61 tests, no modifications to any",
  "assertion. Malformed rows now raise with the source line number attached and",
  "are collected into a report at the end rather than being skipped silently, so",
  "a bad row is visible instead of vanishing.",
].join(" ");

// ---------------------------------------------------------------------------

/**
 * Seal a throwaway task to prove against, rather than borrowing one someone is
 * mid-way through. Existing tasks may already carry a staged submission from
 * another wallet, and overwriting it is exactly what the submit endpoint's
 * authentication is there to prevent.
 */
async function sealProofTask() {
  const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
  const baseUnits = 1_000_000;
  const cfgMint = new PublicKey(
    process.env.MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
  );
  const draft = await api(
    "/api/tasks",
    json({
      title: "Deployment check — port the CSV importer to streaming",
      clauses: [
        "The importer handles a 2 GB file without exceeding 256 MB of memory.",
        "Existing tests pass unchanged.",
        "Malformed rows are reported with a line number, not swallowed.",
      ],
      category: "Code",
      bountyAmount: String(baseUnits),
      deadline,
      mint: cfgMint.toBase58(),
      creatorAddress: signer.publicKey.toBase58(),
    })
  );
  if (!draft.ok) throw new Error(`draft failed: ${JSON.stringify(draft.body)}`);

  const id8 = Buffer.alloc(8);
  id8.writeBigUInt64LE(BigInt(draft.body.taskId));
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from("task"), signer.publicKey.toBytes(), id8],
    programId
  )[0];

  const sig = await program.methods
    .createTask(
      new BN(draft.body.taskId),
      Array.from(fromHex(draft.body.rubricHash)),
      new BN(baseUnits),
      new BN(deadline)
    )
    .accounts({
      creator: signer.publicKey,
      task: pda,
      mint: cfgMint,
      creatorTokenAccount: getAssociatedTokenAddressSync(cfgMint, signer.publicKey),
    })
    .rpc();

  const ok = await api("/api/tasks/confirm", json({ id: draft.body.id, signature: sig, kind: "create" }));
  if (!ok.ok) throw new Error(`confirm failed: ${JSON.stringify(ok.body)}`);
  console.log("  sealed a fresh task for this check:", draft.body.id);
  return draft.body.id;
}

const taskId = TASK_ID ?? (await sealProofTask());
const detail = await api(`/api/tasks/${taskId}`);
if (!detail.ok) {
  console.error("Could not read the task:", detail.status, JSON.stringify(detail.body));
  process.exit(1);
}
const task = detail.body.task;
console.log("Proving the deployment");
console.log("  app        :", APP);
console.log("  task       :", task.title);
console.log("  state      :", task.state);
console.log("  signer     :", signer.publicKey.toBase58());

const mint = new PublicKey(task.mint);
const ata = getAssociatedTokenAddressSync(mint, signer.publicKey);
const before = Number((await getAccount(conn, ata)).amount) / 1e6;
console.log("  USDC before:", before);

// --- 1. submit through the deployed API, signed --------------------------
const submissionHash = hashSubmissionHex(SUBMISSION);
const issuedAt = new Date().toISOString();
const proofSig = ed25519.sign(
  new TextEncoder().encode(
    workerAuthMessage({
      taskId,
      workerAddress: signer.publicKey.toBase58(),
      submissionHash,
      issuedAt,
    })
  ),
  signer.secretKey.slice(0, 32)
);

const submit = await api(
  `/api/tasks/${taskId}/submit`,
  json({
    content: SUBMISSION,
    workerAddress: signer.publicKey.toBase58(),
    proof: { signature: bs58.encode(proofSig), issuedAt },
  })
);
console.log("\n  [1] POST /submit ->", submit.status, submit.ok ? "accepted" : JSON.stringify(submit.body));
if (!submit.ok) process.exit(1);

// --- 2. seal the submission on-chain -------------------------------------
const id8 = Buffer.alloc(8);
id8.writeBigUInt64LE(BigInt(task.onchainTaskId));
const taskPda = PublicKey.findProgramAddressSync(
  [Buffer.from("task"), new PublicKey(task.creatorAddress).toBytes(), id8],
  programId
)[0];

const sig = await program.methods
  .submitWork(Array.from(fromHex(submit.body.submissionHash)))
  .accounts({
    worker: signer.publicKey,
    task: taskPda,
    mint,
    workerTokenAccount: ata,
  })
  .rpc();
console.log("  [2] submit_work  ->", sig.slice(0, 24) + "…");

const confirm = await api("/api/tasks/confirm", json({ id: taskId, signature: sig, kind: "submit" }));
console.log("  [3] confirm      ->", confirm.status, confirm.body?.state ?? JSON.stringify(confirm.body));
if (!confirm.ok) process.exit(1);

// --- 3. the actual test: the deployed judge, and the deployed verifier key -
console.log("\n  [4] POST /verify — this exercises BOTH keys…");
const verdict = await api(`/api/tasks/${taskId}/verify`, { method: "POST" });
console.log("      status  :", verdict.status);
console.log("      outcome :", verdict.body?.outcome ?? "(none)");
if (verdict.body?.summary) console.log("      summary :", String(verdict.body.summary).slice(0, 160));
if (verdict.body?.error) console.log("      error   :", verdict.body.error);

const after = await api(`/api/tasks/${taskId}`);
const finalState = after.body?.task?.state;
const held = after.body?.task?.heldReason;
console.log("\n  final state:", finalState);
if (held) console.log("  held reason:", held);

const paid = Number((await getAccount(conn, ata)).amount) / 1e6;
console.log("  USDC after :", paid, paid > before ? `(+${(paid - before).toFixed(2)} — escrow released)` : "(unchanged)");

console.log("\n" + "-".repeat(60));
if (finalState === "SETTLED" || finalState === "REFUNDED") {
  console.log("BOTH KEYS CORRECT.");
  console.log("  The judge returned a ruling, and the verifier key was accepted");
  console.log("  by the program — which only accepts config.verifier_authority.");
} else if (finalState === "HELD") {
  console.log("JUDGE REACHABLE, BUT THE TASK WAS HELD.");
  console.log("  Read the held reason above: an API-quota message means the");
  console.log("  Gemini key works but is rate limited; anything else means the");
  console.log("  judge ruled but was not confident enough to settle.");
  console.log("  The verifier key is NOT yet proven — nothing tried to sign.");
} else {
  console.log("SOMETHING IS WRONG. State is", finalState);
}
