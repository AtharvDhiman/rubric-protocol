/**
 * Worker authentication.
 *
 * These tests are the reason the signature covers what it covers. Each of the
 * replay cases below is an attack that works if you drop one field from the
 * signed message, so each one is pinned here rather than left to a comment.
 */

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import { verifyWorkerProof } from "./worker-auth";
import { workerAuthMessage, type WorkerProof } from "../worker-auth";

const TASK = "cmthhlx300003ubfnmxdxvbnp";
const OTHER_TASK = "cmthhlx2s0002ubfnvg5lyo53";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const NOW = Date.parse("2026-09-01T12:00:00.000Z");

/** Sign as a worker would, with whatever fields we are testing. */
function sign(
  keypair: Keypair,
  fields: { taskId: string; workerAddress: string; submissionHash: string; issuedAt: string }
): WorkerProof {
  const message = new TextEncoder().encode(workerAuthMessage(fields));
  const signature = ed25519.sign(message, keypair.secretKey.slice(0, 32));
  return { signature: bs58.encode(signature), issuedAt: fields.issuedAt };
}

describe("verifyWorkerProof", () => {
  const worker = Keypair.generate();
  const address = worker.publicKey.toBase58();
  const issuedAt = new Date(NOW).toISOString();
  const good = { taskId: TASK, workerAddress: address, submissionHash: HASH, issuedAt };

  it("accepts a signature the worker really made", () => {
    const result = verifyWorkerProof({
      ...good,
      proof: sign(worker, good),
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a submission with no proof at all", () => {
    const result = verifyWorkerProof({ ...good, proof: undefined, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a signature made by a different wallet", () => {
    const impostor = Keypair.generate();
    // Signed correctly - but by the wrong key, which is the whole point.
    const result = verifyWorkerProof({
      ...good,
      proof: sign(impostor, good),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a signature replayed onto DIFFERENT content", () => {
    // The attack the body hash exists to stop: capture a valid submission, then
    // reuse its signature to overwrite the task with something else.
    const proof = sign(worker, good);
    const result = verifyWorkerProof({
      ...good,
      submissionHash: OTHER_HASH,
      proof,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a signature replayed onto a DIFFERENT task", () => {
    // Without the task id, a signature from a 1 USDC task would authorise a
    // write to a 50 USDC one.
    const proof = sign(worker, good);
    const result = verifyWorkerProof({
      ...good,
      taskId: OTHER_TASK,
      proof,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a signature that has gone stale", () => {
    const proof = sign(worker, good);
    const result = verifyWorkerProof({
      ...good,
      proof,
      now: NOW + 10 * 60 * 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a signature dated into the future", () => {
    // Bounded both ways. A signature good for a month ahead is a signature an
    // attacker can sit on.
    const future = new Date(NOW + 60 * 60 * 1000).toISOString();
    const fields = { ...good, issuedAt: future };
    const result = verifyWorkerProof({
      ...fields,
      proof: sign(worker, fields),
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    for (const proof of [
      { signature: "not base58 !!!", issuedAt },
      { signature: bs58.encode(new Uint8Array(10)), issuedAt },
      { signature: bs58.encode(new Uint8Array(64)), issuedAt },
      { signature: bs58.encode(new Uint8Array(64)), issuedAt: "not a date" },
    ]) {
      const result = verifyWorkerProof({ ...good, proof, now: NOW });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a valid signature presented with a bad wallet address", () => {
    const result = verifyWorkerProof({
      ...good,
      workerAddress: "definitely-not-an-address",
      proof: sign(worker, good),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("workerAuthMessage", () => {
  it("changes whenever any bound field changes", () => {
    const base = {
      taskId: TASK,
      workerAddress: "4kTkVfPqXn1s8pQx9hZmR3wJdG7bN2cY6vL5tA8wHK",
      submissionHash: HASH,
      issuedAt: new Date(NOW).toISOString(),
    };
    const seen = new Set([
      workerAuthMessage(base),
      workerAuthMessage({ ...base, taskId: OTHER_TASK }),
      workerAuthMessage({ ...base, submissionHash: OTHER_HASH }),
      workerAuthMessage({ ...base, workerAddress: Keypair.generate().publicKey.toBase58() }),
      workerAuthMessage({ ...base, issuedAt: new Date(NOW + 1000).toISOString() }),
    ]);
    expect(seen.size).toBe(5);
  });

  it("says in plain words that it moves no money", () => {
    // A person approving this in a wallet dialog should be able to tell that it
    // is not a transaction.
    const message = workerAuthMessage({
      taskId: TASK,
      workerAddress: "4kTkVfPqXn1s8pQx9hZmR3wJdG7bN2cY6vL5tA8wHK",
      submissionHash: HASH,
      issuedAt: new Date(NOW).toISOString(),
    });
    expect(message).toContain("does not move any funds");
  });
});
