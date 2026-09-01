/** Localnet helper: seal one OPEN task so the browser wallet has something to submit to. */
import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnchorProvider, Program } from "@anchor-lang/core";
import { createRequire } from "node:module";
const BN = createRequire(import.meta.url)("bn.js");
import { fromHex } from "../lib/hash.ts";

const signers = JSON.parse(fs.readFileSync(path.join(process.env.TEMP, "e2e-signers.json"), "utf8"));
const admin = Keypair.fromSecretKey(Uint8Array.from(signers.admin));
const mint = new PublicKey(signers.mint);
const idl = JSON.parse(fs.readFileSync("lib/idl/rubric.json", "utf8"));
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
class W { constructor(k){this.payer=k;this.publicKey=k.publicKey;}
  async signTransaction(t){
    if (t instanceof VersionedTransaction) t.sign([this.payer]);
    else t.partialSign(this.payer);
    return t;
  }
  async signAllTransactions(ts){ return Promise.all(ts.map(t=>this.signTransaction(t))); } }
const program = new Program(idl, new AnchorProvider(conn, new W(admin), { commitment: "confirmed" }));

const deadline = Math.floor(Date.now()/1000) + 24*3600;
const baseUnits = 6_000_000;
const draft = await (await fetch("http://127.0.0.1:4300/api/tasks", {
  method: "POST", headers: {"content-type":"application/json"},
  body: JSON.stringify({
    title: "Transcribe 20 field recordings",
    clauses: [
      "Every recording has a plain-text transcript.",
      "Inaudible passages are marked rather than guessed at.",
      "Speaker turns are labelled.",
    ],
    category: "Content", bountyAmount: String(baseUnits), deadline,
    mint: mint.toBase58(), creatorAddress: admin.publicKey.toBase58(),
  }),
})).json();

const id8 = Buffer.alloc(8); id8.writeBigUInt64LE(BigInt(draft.taskId));
const taskPda = PublicKey.findProgramAddressSync(
  [Buffer.from("task"), admin.publicKey.toBytes(), id8], new PublicKey(idl.address))[0];

const sig = await program.methods.createTask(
    new BN(draft.taskId), Array.from(fromHex(draft.rubricHash)), new BN(baseUnits), new BN(deadline))
  .accounts({ creator: admin.publicKey, task: taskPda, mint,
    creatorTokenAccount: getAssociatedTokenAddressSync(mint, admin.publicKey) })
  .rpc();

const confirm = await (await fetch("http://127.0.0.1:4300/api/tasks/confirm", {
  method: "POST", headers: {"content-type":"application/json"},
  body: JSON.stringify({ id: draft.id, signature: sig, kind: "create" }),
})).json();

console.log("  task id   :", draft.id);
console.log("  state     :", confirm.state);
console.log("  url       : http://127.0.0.1:4300/task/" + draft.id);
