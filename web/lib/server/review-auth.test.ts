/**
 * Reviewer authentication.
 *
 * Each replay case below is an attack that works if you drop one field from the signed
 * message, so each is pinned here rather than left to a comment.
 */

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

import { verifyReviewProof } from "./review-auth";
import { reviewAuthMessage, type ReviewProof } from "../review";

const TASK = "cmthhlx300003ubfnmxdxvbnp";
const OTHER_TASK = "cmthhlx2s0002ubfnvg5lyo53";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const NOW = Date.parse("2026-10-23T12:00:00.000Z");

function sign(
  keypair: Keypair,
  fields: { taskId: string; reviewerAddress: string; decisionHash: string; issuedAt: string }
): ReviewProof {
  const message = new TextEncoder().encode(reviewAuthMessage(fields));
  const signature = ed25519.sign(message, keypair.secretKey.slice(0, 32));
  return { signature: bs58.encode(signature), issuedAt: fields.issuedAt };
}

describe("verifyReviewProof", () => {
  const reviewer = Keypair.generate();
  const address = reviewer.publicKey.toBase58();
  const issuedAt = new Date(NOW).toISOString();
  const good = { taskId: TASK, reviewerAddress: address, decisionHash: HASH, issuedAt };

  it("accepts a signature the reviewer really made", () => {
    expect(verifyReviewProof({ ...good, proof: sign(reviewer, good), now: NOW }).ok).toBe(true);
  });

  it("rejects a ruling with no proof at all", () => {
    const r = verifyReviewProof({ ...good, proof: undefined, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects a proof with missing or wrongly typed fields", () => {
    for (const proof of [
      {} as never,
      { signature: 5, issuedAt } as never,
      { signature: "x" } as never,
      { issuedAt } as never,
    ]) {
      expect(verifyReviewProof({ ...good, proof, now: NOW }).ok).toBe(false);
    }
  });

  it("rejects a signature made by a different wallet", () => {
    const r = verifyReviewProof({ ...good, proof: sign(Keypair.generate(), good), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects a signature replayed onto a DIFFERENT RULING", () => {
    // The attack the ruling hash exists to stop: capture a signed rejection, then
    // reuse its signature to submit an approval.
    const proof = sign(reviewer, good);
    expect(verifyReviewProof({ ...good, decisionHash: OTHER_HASH, proof, now: NOW }).ok).toBe(false);
  });

  it("rejects a signature replayed onto a DIFFERENT TASK", () => {
    const proof = sign(reviewer, good);
    expect(verifyReviewProof({ ...good, taskId: OTHER_TASK, proof, now: NOW }).ok).toBe(false);
  });

  it("rejects a signature presented as another reviewer's", () => {
    // Signed by `reviewer`, but claimed to be from someone else.
    const other = Keypair.generate().publicKey.toBase58();
    const proof = sign(reviewer, good);
    expect(verifyReviewProof({ ...good, reviewerAddress: other, proof, now: NOW }).ok).toBe(false);
  });

  it("rejects a stale signature", () => {
    const old = new Date(NOW - 6 * 60 * 1000).toISOString();
    const fields = { ...good, issuedAt: old };
    const r = verifyReviewProof({ ...fields, proof: sign(reviewer, fields), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it("rejects a FUTURE-dated signature, not only a stale one", () => {
    const future = new Date(NOW + 6 * 60 * 1000).toISOString();
    const fields = { ...good, issuedAt: future };
    expect(verifyReviewProof({ ...fields, proof: sign(reviewer, fields), now: NOW }).ok).toBe(false);
  });

  it("accepts a signature just inside the window, in both directions", () => {
    for (const offset of [-4 * 60 * 1000, 4 * 60 * 1000]) {
      const fields = { ...good, issuedAt: new Date(NOW + offset).toISOString() };
      expect(verifyReviewProof({ ...fields, proof: sign(reviewer, fields), now: NOW }).ok).toBe(true);
    }
  });

  it("rejects a timestamp that is not a date", () => {
    const fields = { ...good, issuedAt: "soon" };
    const r = verifyReviewProof({ ...fields, proof: sign(reviewer, fields), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects an address that is not a public key, without throwing", () => {
    const r = verifyReviewProof({ ...good, reviewerAddress: "not-a-key", proof: sign(reviewer, good), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects a signature that is not base58, or the wrong length, without throwing", () => {
    const junk = verifyReviewProof({ ...good, proof: { signature: "0OIl!!", issuedAt }, now: NOW });
    expect(junk.ok).toBe(false);
    if (!junk.ok) {
      expect(junk.status).toBe(400);
      expect(junk.reason).toMatch(/not valid base58/);
    }
    // A signature of the wrong length is a client error (400), named as such, and not
    // merely "does not match" (401): the distinction tells the caller what to fix.
    const short = verifyReviewProof({ ...good, proof: { signature: bs58.encode(new Uint8Array(10)), issuedAt }, now: NOW });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.status).toBe(400);
      expect(short.reason).toMatch(/wrong length/);
    }
  });

  it("never returns the signature or any key material in a reason", () => {
    const secret = bs58.encode(reviewer.secretKey);
    const r = verifyReviewProof({ ...good, proof: sign(Keypair.generate(), good), now: NOW });
    if (!r.ok) {
      expect(r.reason).not.toContain(secret);
      expect(r.reason).not.toContain(address);
    }
  });
});
