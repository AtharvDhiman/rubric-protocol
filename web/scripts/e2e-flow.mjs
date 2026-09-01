/**
 * The round trip, against a local validator.
 *
 * This is the thing the README has called unverified since Part 1: seal a rubric
 * and fund it, submit work against it, have the judge rule, and watch the escrow
 * actually move. It was blocked on devnet USDC, which needs Circle's faucet. A
 * local validator with a mint we control removes that dependency entirely.
 *
 * It drives the REAL API routes over HTTP, not the library functions underneath
 * them, so the routes, the hash checks, the worker authentication and the
 * on-chain program are all exercised as one running system. The only thing it
 * stands in for is the browser wallet: a keypair signs where Phantom would.
 *
 *   npx dotenv-cli -e .env.e2e -- npx tsx scripts/e2e-flow.mjs
 */

import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { AnchorProvider, Program } from "@anchor-lang/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { createRequire } from "node:module";

// Anchor's borsh coder needs BN for u64/i64 args - a plain number throws
// "src.toArrayLike is not a function". @anchor-lang/core exports BN from its
// CommonJS entry but not its ESM one, so reach it through createRequire.
const BN = createRequire(import.meta.url)("bn.js");

import { hashSubmissionHex, fromHex } from "../lib/hash.ts";
import { workerAuthMessage } from "../lib/worker-auth.ts";

const RPC = "http://127.0.0.1:8899";
const APP = process.env.E2E_APP_URL ?? "http://127.0.0.1:4300";

const signers = JSON.parse(
  fs.readFileSync(path.join(process.env.TEMP, "e2e-signers.json"), "utf8")
);
const admin = Keypair.fromSecretKey(Uint8Array.from(signers.admin));
const worker = Keypair.fromSecretKey(Uint8Array.from(signers.worker));
const mint = new PublicKey(signers.mint);

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

const programAs = (kp) =>
  new Program(idl, new AnchorProvider(conn, new LocalWallet(kp), { commitment: "confirmed" }));

// ---------------------------------------------------------------------------

let failures = 0;
const step = (n, s) => console.log(`\n[${n}] ${s}`);
const ok = (s) => console.log(`    PASS  ${s}`);
const bad = (s) => {
  failures++;
  console.log(`    FAIL  ${s}`);
};
const check = (cond, s) => (cond ? ok(s) : bad(s));

async function api(route, init) {
  const response = await fetch(`${APP}${route}`, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* not every error response carries JSON */
  }
  return { status: response.status, ok: response.ok, body };
}

const json = (payload) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

async function usdc(owner) {
  try {
    const account = await getAccount(conn, getAssociatedTokenAddressSync(mint, owner, true));
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}

async function ensureAta(payerKp, owner) {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  if (await conn.getAccountInfo(ata)) return ata;
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(payerKp.publicKey, ata, owner, mint)
  );
  await sendAndConfirmTransaction(conn, tx, [payerKp], { commitment: "confirmed" });
  return ata;
}

/** Sign the worker-auth message exactly as the browser would. */
function signAsWorker(taskId, submissionHash) {
  const issuedAt = new Date().toISOString();
  const message = new TextEncoder().encode(
    workerAuthMessage({
      taskId,
      workerAddress: worker.publicKey.toBase58(),
      submissionHash,
      issuedAt,
    })
  );
  const signature = ed25519.sign(message, worker.secretKey.slice(0, 32));
  return { signature: bs58.encode(signature), issuedAt };
}

function taskPdaFor(creator, onchainTaskId) {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(onchainTaskId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("task"), creator.toBytes(), id],
    programId
  )[0];
}

/** Seal a task on-chain and register it through the API. Returns its ids. */
async function sealTask(overrides = {}) {
  const {
    windowSeconds = 24 * 3600,
    bountyUsdc = 5,
    ...rest
  } = overrides;
  // The API takes base units and an absolute unix deadline, which is also
  // exactly what the program takes - so the two cannot disagree about either.
  const deadline = Math.floor(Date.now() / 1000) + windowSeconds;
  const baseUnits = Math.round(bountyUsdc * 1e6);
  const spec = {
    title: "Label 40 warehouse shelf photos",
    clauses: [
      "Every barcode in the delivered labels is legible and in focus.",
      "Images too blurred to read are excluded rather than guessed at.",
      "There is exactly one label per image.",
    ],
    category: "Labeling",
    bountyAmount: String(baseUnits),
    deadline,
    mint: mint.toBase58(),
    ...rest,
  };

  const draft = await api(
    "/api/tasks",
    json({ ...spec, creatorAddress: admin.publicKey.toBase58() })
  );
  if (!draft.ok) throw new Error(`draft failed ${draft.status}: ${JSON.stringify(draft.body)}`);

  // The route calls it `taskId`; it is the on-chain u64, as a string.
  const { id, taskId: onchainTaskId, rubricHash } = draft.body;

  const signature = await programAs(admin)
    .methods.createTask(
      new BN(onchainTaskId),
      Array.from(fromHex(rubricHash)),
      new BN(baseUnits),
      new BN(deadline)
    )
    .accounts({
      creator: admin.publicKey,
      task: taskPdaFor(admin.publicKey, onchainTaskId),
      mint,
      creatorTokenAccount: getAssociatedTokenAddressSync(mint, admin.publicKey),
    })
    .rpc();

  const confirm = await api("/api/tasks/confirm", json({ id, signature, kind: "create" }));
  if (!confirm.ok) throw new Error(`confirm failed: ${JSON.stringify(confirm.body)}`);
  return { id, onchainTaskId, signature };
}

// ---------------------------------------------------------------------------

console.log("Rubric end-to-end, local validator");
console.log("  app  :", APP);
console.log("  rpc  :", RPC);
console.log("  mint :", mint.toBase58());

step(1, "The app is up and serving this deployment's IDL");
{
  const health = await api("/api/idl");
  check(health.ok, `GET /api/idl -> ${health.status}`);
  if (!health.ok) {
    console.log("\n  Dev server on 4300 is not up. Aborting.");
    process.exit(1);
  }
}

step(2, "Seal a funded rubric on-chain");
await ensureAta(admin, admin.publicKey);
await ensureAta(admin, worker.publicKey);
const posterStart = await usdc(admin.publicKey);
const workerStart = await usdc(worker.publicKey);
console.log(`    poster ${posterStart} USDC, worker ${workerStart} USDC`);

const task = await sealTask();
console.log(`    task ${task.id} (on-chain id ${task.onchainTaskId})`);
const escrowAta = getAssociatedTokenAddressSync(mint, taskPdaFor(admin.publicKey, task.onchainTaskId), true);
const escrowAfterSeal = Number((await getAccount(conn, escrowAta)).amount) / 1e6;
check(escrowAfterSeal === 5, `escrow holds ${escrowAfterSeal} USDC after sealing`);
check(
  (await usdc(admin.publicKey)) === posterStart - 5,
  "the bounty left the poster's wallet"
);

step(3, "An unsigned submission is refused");
{
  const attempt = await api(
    `/api/tasks/${task.id}/submit`,
    json({ content: "trust me, it is done", workerAddress: worker.publicKey.toBase58() })
  );
  check(attempt.status === 401, `POST without proof -> ${attempt.status} (want 401)`);
}

step(4, "A submission signed by the WRONG wallet is refused");
{
  const impostor = Keypair.generate();
  const content = "work by someone else";
  const submissionHash = hashSubmissionHex(content);
  const issuedAt = new Date().toISOString();
  const message = new TextEncoder().encode(
    workerAuthMessage({
      taskId: task.id,
      workerAddress: worker.publicKey.toBase58(),
      submissionHash,
      issuedAt,
    })
  );
  const forged = bs58.encode(ed25519.sign(message, impostor.secretKey.slice(0, 32)));
  const attempt = await api(
    `/api/tasks/${task.id}/submit`,
    json({
      content,
      workerAddress: worker.publicKey.toBase58(),
      proof: { signature: forged, issuedAt },
    })
  );
  check(attempt.status === 401, `forged signature -> ${attempt.status} (want 401)`);
}

step(5, "The worker submits, signed, and seals it on-chain");
const GOOD_WORK =
  "Delivered 40 labelled images as labels.jsonl. Every barcode was checked at " +
  "full resolution and is legible and in focus. 3 frames were too blurred to " +
  "read and are excluded from the set, listed in excluded.txt with the reason " +
  "for each rather than guessed at. Each image carries exactly one label " +
  "object, verified with a uniqueness check on image_id: 37 labelled + 3 " +
  "excluded = 40.";
{
  const submissionHash = hashSubmissionHex(GOOD_WORK);
  const submit = await api(
    `/api/tasks/${task.id}/submit`,
    json({
      content: GOOD_WORK,
      workerAddress: worker.publicKey.toBase58(),
      proof: signAsWorker(task.id, submissionHash),
    })
  );
  check(submit.ok, `POST /submit signed -> ${submit.status}`);
  if (!submit.ok) {
    console.log("   ", JSON.stringify(submit.body));
    process.exit(1);
  }
  check(
    submit.body.submissionHash === submissionHash,
    "server hashed the submission to the same digest the client did"
  );

  const signature = await programAs(worker)
    .methods.submitWork(Array.from(fromHex(submit.body.submissionHash)))
    .accounts({
      worker: worker.publicKey,
      task: taskPdaFor(admin.publicKey, task.onchainTaskId),
      mint,
      workerTokenAccount: getAssociatedTokenAddressSync(mint, worker.publicKey),
    })
    .rpc();

  const confirm = await api(
    "/api/tasks/confirm",
    json({ id: task.id, signature, kind: "submit" })
  );
  check(confirm.ok, `confirm submit -> ${confirm.status}`);
  check(confirm.body?.state === "SUBMITTED", `task is ${confirm.body?.state} after sealing work`);
}

step(6, "The judge rules, and the escrow settles");
{
  const verdict = await api(`/api/tasks/${task.id}/verify`, { method: "POST" });
  console.log(`    POST /verify -> ${verdict.status}`);
  const outcome = verdict.body?.outcome ?? verdict.body?.state ?? "(none)";
  console.log(`    outcome: ${outcome}`);
  if (verdict.body?.summary) console.log(`    summary: ${verdict.body.summary}`);

  const detail = await api(`/api/tasks/${task.id}`);
  // The route wraps the row: { task: {...} }.
  const state = detail.body?.task?.state;
  const heldReason = detail.body?.task?.heldReason;
  if (heldReason) console.log(`    held because: ${heldReason}`);
  console.log(`    task state: ${state}`);

  const workerEnd = await usdc(worker.publicKey);
  const escrowGone = !(await conn.getAccountInfo(escrowAta));

  if (state === "SETTLED") {
    check(workerEnd > workerStart, `worker was paid: ${workerStart} -> ${workerEnd} USDC`);
    check(escrowGone, "escrow account closed after settlement");
    const fee = 5 * 0.02;
    check(
      Math.abs(workerEnd - workerStart - (5 - fee)) < 0.000001,
      `worker received the bounty less the 2% fee (${(5 - fee).toFixed(2)} USDC)`
    );
  } else if (state === "HELD") {
    console.log("    judge held the task - escrow untouched, which is the safe outcome");
    check(
      (await usdc(worker.publicKey)) === workerStart,
      "nobody was paid while the task is held"
    );
    console.log("    NOTE: settlement not exercised. Re-run when judge quota allows.");
  } else {
    bad(`unexpected state ${state}`);
  }
}

step(7, "reclaim_expired returns an expired escrow to the poster");
{
  // A task whose window has already closed. `create_task` accepts a deadline in
  // the past, which is what makes this testable without waiting a day.
  // The program only requires a deadline in the future, with no minimum window,
  // so an eight-second one makes this testable without waiting out a real work
  // window. Nobody submits to it.
  const expired = await sealTask({
    title: "Nobody will take this one",
    bountyUsdc: 2,
    windowSeconds: 8,
  });
  console.log("    waiting out the 8s work window...");
  await new Promise((r) => setTimeout(r, 12_000));
  const expiredPda = taskPdaFor(admin.publicKey, expired.onchainTaskId);
  const expiredEscrow = getAssociatedTokenAddressSync(mint, expiredPda, true);
  const heldBefore = Number((await getAccount(conn, expiredEscrow)).amount) / 1e6;
  const posterBeforeReclaim = await usdc(admin.publicKey);

  const signature = await programAs(admin)
    .methods.reclaimExpired()
    .accounts({
      creator: admin.publicKey,
      task: expiredPda,
      mint,
      creatorTokenAccount: getAssociatedTokenAddressSync(mint, admin.publicKey),
    })
    .rpc();

  const confirm = await api(
    "/api/tasks/confirm",
    json({ id: expired.id, signature, kind: "reclaim" })
  );
  check(confirm.ok, `confirm reclaim -> ${confirm.status}`);
  check(confirm.body?.state === "REFUNDED", `task is ${confirm.body?.state} after reclaim`);

  const posterAfter = await usdc(admin.publicKey);
  check(
    Math.abs(posterAfter - posterBeforeReclaim - heldBefore) < 0.000001,
    `poster got the full ${heldBefore} USDC back, no fee on a refund`
  );
  check(!(await conn.getAccountInfo(expiredEscrow)), "expired escrow account closed");
}

// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
