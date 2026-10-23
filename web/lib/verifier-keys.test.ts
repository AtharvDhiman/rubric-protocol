import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  checkSigner,
  configuredKeys,
  decodeSecretKey,
  keypairFromSecret,
  selectByAuthority,
} from "./verifier-keys";

const b58 = (k: Keypair) => bs58.encode(k.secretKey);
const json = (k: Keypair) => JSON.stringify(Array.from(k.secretKey));

describe("decodeSecretKey", () => {
  it("accepts base58 and a JSON byte array, and they decode to the same key", () => {
    const k = Keypair.generate();
    expect(Buffer.from(decodeSecretKey(b58(k), "X"))).toEqual(Buffer.from(k.secretKey));
    expect(Buffer.from(decodeSecretKey(json(k), "X"))).toEqual(Buffer.from(k.secretKey));
    expect(Buffer.from(decodeSecretKey(`  ${b58(k)}\n`, "X"))).toEqual(Buffer.from(k.secretKey));
  });

  it("names the variable that is wrong", () => {
    expect(() => decodeSecretKey("not a key !!", "VERIFIER_SECRET_KEY_NEXT")).toThrow(/VERIFIER_SECRET_KEY_NEXT/);
  });

  it("refuses a key of the wrong length and says how long it was", () => {
    const short = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    expect(() => decodeSecretKey(short, "X")).toThrow(/32 bytes/);
  });
});

describe("no error message ever contains the input", () => {
  // The rule for this file. A secret that ends up in a log line is a leaked secret.
  const k = Keypair.generate();
  const secret = b58(k);
  const attempts: Array<[string, () => unknown]> = [
    ["garbage", () => decodeSecretKey("zzzz" + secret.slice(4, 30), "X")],
    ["truncated", () => decodeSecretKey(secret.slice(0, 40), "X")],
    ["json garbage", () => decodeSecretKey("[1,2,3," + secret.slice(0, 10), "X")],
    ["mismatched halves", () => {
      const bad = Uint8Array.from(k.secretKey);
      bad[40] ^= 0xff; // corrupt the public half so fromSecretKey rejects it
      return keypairFromSecret(bs58.encode(bad), "X");
    }],
  ];
  for (const [name, attempt] of attempts) {
    it(`for ${name}`, () => {
      let message = "";
      try {
        attempt();
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message.length).toBeGreaterThan(0);
      // no substantial slice of the secret, in any encoding
      for (let i = 0; i + 8 <= secret.length; i += 4) {
        expect(message).not.toContain(secret.slice(i, i + 8));
      }
      expect(message).not.toContain(Array.from(k.secretKey).slice(0, 6).join(","));
    });
  }
});

describe("configuredKeys", () => {
  it("requires the current key", () => {
    expect(() => configuredKeys(undefined, undefined)).toThrow(/VERIFIER_SECRET_KEY is not set/);
    expect(() => configuredKeys("   ", undefined)).toThrow(/VERIFIER_SECRET_KEY is not set/);
  });

  it("works with the current key alone", () => {
    const cur = Keypair.generate();
    const { keys, nextError } = configuredKeys(b58(cur), undefined);
    expect(keys.map((x) => x.label)).toEqual(["VERIFIER_SECRET_KEY"]);
    expect(nextError).toBeNull();
  });

  it("holds both keys when a next key is set", () => {
    const cur = Keypair.generate();
    const next = Keypair.generate();
    const { keys } = configuredKeys(json(cur), b58(next));
    expect(keys.map((x) => x.label)).toEqual(["VERIFIER_SECRET_KEY", "VERIFIER_SECRET_KEY_NEXT"]);
  });

  it("a bad NEXT key does not stop the current key signing, but is reported", () => {
    const cur = Keypair.generate();
    const { keys, nextError } = configuredKeys(b58(cur), "definitely not a key");
    expect(keys).toHaveLength(1);
    expect(nextError).toMatch(/VERIFIER_SECRET_KEY_NEXT/);
  });

  it("a bad CURRENT key IS fatal", () => {
    expect(() => configuredKeys("definitely not a key", b58(Keypair.generate()))).toThrow(/VERIFIER_SECRET_KEY/);
  });

  it("collapses the same key set twice", () => {
    const cur = Keypair.generate();
    expect(configuredKeys(b58(cur), json(cur)).keys).toHaveLength(1);
  });
});

describe("zero-downtime rotation: the app signs with whichever key the chain trusts", () => {
  const current = Keypair.generate();
  const next = Keypair.generate();
  const both = () => configuredKeys(b58(current), b58(next));

  it("before the rotation, the CURRENT key signs", () => {
    const check = checkSigner(both(), current.publicKey);
    expect(check.ok).toBe(true);
    expect(check.activeLabel).toBe("VERIFIER_SECRET_KEY");
  });

  it("after the on-chain rotation, the NEXT key signs - with no change to the app", () => {
    const check = checkSigner(both(), next.publicKey);
    expect(check.ok).toBe(true);
    expect(check.activeLabel).toBe("VERIFIER_SECRET_KEY_NEXT");
    expect(check.message).toMatch(/move it into VERIFIER_SECRET_KEY/);
    expect(selectByAuthority(both().keys, next.publicKey)!.keypair.publicKey.equals(next.publicKey)).toBe(true);
  });

  it("if the chain trusts neither, it says so with PUBLIC keys on both sides", () => {
    const stranger = Keypair.generate();
    const check = checkSigner(both(), stranger.publicKey);
    expect(check.ok).toBe(false);
    expect(check.activeLabel).toBeNull();
    expect(check.message).toContain(stranger.publicKey.toBase58());
    expect(check.message).toContain(current.publicKey.toBase58());
    expect(check.message).toContain(next.publicKey.toBase58());
    expect(check.message).not.toContain(b58(current));
    expect(check.message).not.toContain(b58(next));
  });

  it("with only the old key, a completed rotation is a mismatch - the failure this exists to remove", () => {
    const onlyOld = configuredKeys(b58(current), undefined);
    expect(checkSigner(onlyOld, next.publicKey).ok).toBe(false);
  });
});
