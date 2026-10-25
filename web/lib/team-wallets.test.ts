import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { TeamWalletsError, parseTeamWallets, requireTeamWallets } from "./team-wallets";

const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const C = Keypair.generate().publicKey.toBase58();
// A fixed, real address (mainnet USDC) for the malformed-variant cases. A random key would make
// them flaky: a 43-character key with one character appended is itself a valid 32-byte address
// about 1.7% of the time, and the parser is right to accept it.
const FIXED = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("parseTeamWallets", () => {
  it("nothing declared is an empty, usable list", () => {
    for (const input of [undefined, null, "", "   ", "\n\n", " , ; "]) {
      expect(parseTeamWallets(input), JSON.stringify(input)).toEqual({ wallets: [], problems: [] });
    }
  });

  it("splits on commas, semicolons, spaces and new lines", () => {
    const parsed = parseTeamWallets(`${A},${B}; ${C}\n${A}`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.wallets).toEqual([A, B, C]);
  });

  it("tolerates surrounding whitespace and a trailing separator", () => {
    expect(parseTeamWallets(`  ${A} ,\n${B},  `).wallets).toEqual([A, B]);
  });

  it("collapses duplicates, keeping the first occurrence's order", () => {
    expect(parseTeamWallets(`${B} ${A} ${B} ${A}`).wallets).toEqual([B, A]);
  });

  it("accepts a program-derived address, which is not on the curve", () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("vault")], Keypair.generate().publicKey);
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
    expect(parseTeamWallets(pda.toBase58())).toEqual({ wallets: [pda.toBase58()], problems: [] });
  });

  it("accepts the all-ones system address (32 characters, the shortest form)", () => {
    const system = "11111111111111111111111111111111";
    expect(parseTeamWallets(system).wallets).toEqual([system]);
  });
});

describe("rejection", () => {
  it("names each bad entry by position, with a fixed sentence", () => {
    const parsed = parseTeamWallets(`${A} not-an-address ${B} 12345`);
    expect(parsed.problems).toEqual([
      "Entry 2 is not a valid Solana address.",
      "Entry 4 is not a valid Solana address.",
    ]);
    // The good entries are still returned, so a caller can say what it did read; it must
    // still refuse, because the bad ones were meant to be on the list.
    expect(parsed.wallets).toEqual([A, B]);
  });

  it.each([
    ["too short", "abc"],
    ["not base58 (contains 0, O, I and l)", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"],
    ["a valid-looking string of the wrong decoded length", "1".repeat(40)],
    ["a hex string", "a".repeat(64)],
    ["an address with two characters cut off", FIXED.slice(0, -2)],
    ["an address with a character appended", `${FIXED}x`],
  ])("rejects %s", (_name, token) => {
    expect(parseTeamWallets(token).problems).toHaveLength(1);
    expect(parseTeamWallets(token).wallets).toEqual([]);
  });

  it("rejects a secret key pasted by mistake, and never repeats it", () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    const parsed = parseTeamWallets(`${A} ${secret}`);
    expect(parsed.problems).toEqual(["Entry 2 is not a valid Solana address."]);
    expect(JSON.stringify(parsed)).not.toContain(secret);
    expect(parsed.wallets).toEqual([A]);
  });

  it("never repeats a rejected entry, whatever it contains", () => {
    const secret = "SECRET-token-1234";
    expect(JSON.stringify(parseTeamWallets(secret))).not.toContain("SECRET");
  });
});

describe("requireTeamWallets", () => {
  it("returns the list when it is clean", () => {
    expect(requireTeamWallets(`${A},${B}`)).toEqual([A, B]);
    expect(requireTeamWallets(undefined)).toEqual([]);
  });

  it("throws, and does not return a partial list, when any entry is bad", () => {
    expect(() => requireTeamWallets(`${A} oops`)).toThrow(TeamWalletsError);
  });

  it("the error carries positions, not values, and a stable name for logs", () => {
    const secret = bs58.encode(Keypair.generate().secretKey);
    try {
      requireTeamWallets(`${A} ${secret}`);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamWalletsError);
      const e = error as TeamWalletsError;
      expect(e.name).toBe("TeamWalletsError");
      expect(e.problems).toEqual(["Entry 2 is not a valid Solana address."]);
      expect(e.message).not.toContain(secret);
      expect(JSON.stringify(e.problems)).not.toContain(secret);
    }
  });
});
