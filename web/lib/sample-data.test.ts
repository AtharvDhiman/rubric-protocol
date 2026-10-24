/**
 * Sample data must never be served, counted or seeded on mainnet.
 *
 * The cluster check FAILS CLOSED: solanaCluster() silently reads an unrecognised value as
 * "devnet", so a guard built on it would fail open on a typo, on exactly the deployment it
 * exists to protect.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { treatAsMainnet, isMainnet } from "./env";
import { demoTasks } from "./demo";
import { mainnetBannerText } from "./mainnet-banner";
import {
  SAMPLE_CREATORS,
  SAMPLE_ID_PREFIX,
  SAMPLE_ROW_WHERE,
  SEED_FAKE_TX,
  demoModeFor,
  hideSampleOnMainnet,
  isSampleId,
  isSampleRow,
  withoutSamples,
} from "./sample-data";

describe("treatAsMainnet", () => {
  it("is true for mainnet-beta, however it is written", () => {
    for (const v of ["mainnet-beta", "Mainnet-Beta", "MAINNET-BETA", " mainnet-beta"]) {
      expect(treatAsMainnet(v), v).toBe(true);
    }
  });

  it("FAILS CLOSED: a typo that merely looks like mainnet counts", () => {
    // solanaCluster() reads all of these as devnet. A guard on isMainnet() would fail open.
    for (const v of ["mainnet", "main-net", "mainet-beta", "mainnet_beta", "mainnet-beta "]) {
      expect(treatAsMainnet(v), v).toBe(true);
    }
  });

  it("is false for the clusters that are not mainnet, and for nothing at all", () => {
    for (const v of ["devnet", "testnet", "localnet", "", undefined]) {
      expect(treatAsMainnet(v), String(v)).toBe(false);
    }
  });

  it("isMainnet() alone would have missed the typo: that is why the guard does not use it", () => {
    const saved = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "mainnet";
    try {
      expect(isMainnet()).toBe(false); // reads as devnet
      expect(treatAsMainnet()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
      else process.env.NEXT_PUBLIC_SOLANA_CLUSTER = saved;
    }
  });
});

describe("demoModeFor", () => {
  it("is on only with no database AND no mainnet", () => {
    expect(demoModeFor(undefined, "devnet")).toBe(true);
    expect(demoModeFor("", "devnet")).toBe(true);
    expect(demoModeFor(undefined, undefined)).toBe(true);
  });

  it("is NEVER on for mainnet, even with no database: it must say unavailable, not invent tasks", () => {
    expect(demoModeFor(undefined, "mainnet-beta")).toBe(false);
    expect(demoModeFor("", "mainnet-beta")).toBe(false);
    expect(demoModeFor(undefined, "mainnet")).toBe(false); // the typo
  });

  it("is off whenever a database is configured, on any cluster", () => {
    for (const cluster of ["devnet", "testnet", "mainnet-beta", undefined]) {
      expect(demoModeFor("postgresql://x", cluster)).toBe(false);
    }
  });
});

describe("what a sample row is", () => {
  const real = { id: "cmthhlx300003ubfnmxdxvbnp", creatorAddress: "RealCreator11111111111111111111111111111111", txCreate: "realsig" };

  it("a real row is not a sample", () => {
    expect(isSampleRow(real)).toBe(false);
  });

  it("any ONE marker makes a row a sample: the id prefix, a creator nobody holds, or the placeholder signature", () => {
    expect(isSampleRow({ ...real, id: `${SAMPLE_ID_PREFIX}anything` })).toBe(true);
    for (const creator of SAMPLE_CREATORS) expect(isSampleRow({ ...real, creatorAddress: creator })).toBe(true);
    expect(isSampleRow({ ...real, txCreate: SEED_FAKE_TX })).toBe(true);
  });

  it("recognises the rows prisma/seed.ts wrote under ordinary ids, which the id prefix alone would miss", () => {
    // Matters 42-45 from the old seed script: a generated id, the seed creator, the
    // placeholder signature. In a real database they looked like real tasks.
    const legacy = { id: "cmabc123generated", creatorAddress: SAMPLE_CREATORS[1], txCreate: SEED_FAKE_TX };
    expect(isSampleId(legacy.id)).toBe(false);
    expect(isSampleRow(legacy)).toBe(true);
  });

  it("copes with missing fields", () => {
    expect(isSampleRow({ id: "x" })).toBe(false);
    expect(isSampleRow({ id: "x", creatorAddress: null, txCreate: null })).toBe(false);
  });

  it("every record in the demo data is a sample by this definition", () => {
    for (const t of demoTasks()) expect(isSampleRow(t), t.id).toBe(true);
  });

  it("the placeholder signature is exactly what the seed script writes", () => {
    expect(SEED_FAKE_TX).toBe("5".repeat(87));
  });
});

describe("withoutSamples", () => {
  const where = { state: { not: "PENDING" as const } };

  it("leaves a query alone off mainnet: samples are labelled there, and wanted", () => {
    expect(withoutSamples(where, false)).toBe(where);
  });

  it("on mainnet keeps the original filter AND excludes every sample marker", () => {
    expect(withoutSamples(where, true)).toEqual({ AND: [where, { NOT: SAMPLE_ROW_WHERE }] });
  });

  it("the exclusion covers all three markers", () => {
    const text = JSON.stringify(SAMPLE_ROW_WHERE);
    expect(text).toContain(SAMPLE_ID_PREFIX);
    for (const c of SAMPLE_CREATORS) expect(text).toContain(c);
    expect(text).toContain(SEED_FAKE_TX);
  });

  it("defaults to the environment: a mainnet env wraps, a devnet env does not", () => {
    const saved = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
    try {
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "mainnet-beta";
      expect(withoutSamples(where)).not.toBe(where);
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER = "devnet";
      expect(withoutSamples(where)).toBe(where);
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
      else process.env.NEXT_PUBLIC_SOLANA_CLUSTER = saved;
    }
  });
});

describe("hideSampleOnMainnet", () => {
  const sample = { id: `${SAMPLE_ID_PREFIX}x` };
  const real = { id: "cmreal" };

  it("on mainnet a sample row does not exist", () => {
    expect(hideSampleOnMainnet(sample, true)).toBeNull();
  });

  it("on mainnet a real row is returned untouched", () => {
    expect(hideSampleOnMainnet(real, true)).toBe(real);
  });

  it("off mainnet a sample row is returned, to be labelled SAMPLE", () => {
    expect(hideSampleOnMainnet(sample, false)).toBe(sample);
  });

  it("null stays null", () => {
    expect(hideSampleOnMainnet(null, true)).toBeNull();
    expect(hideSampleOnMainnet(null, false)).toBeNull();
  });
});

describe("DEMO_MODE itself, as the app computes it", () => {
  // The function above is tested in isolation; this proves lib/demo.ts actually USES it.
  // DEMO_MODE is evaluated when the module is imported, so each case imports it afresh.
  const demoModeWith = async (database: string, cluster: string) => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", database);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_CLUSTER", cluster);
    return (await import("./demo")).DEMO_MODE;
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is on with no database on devnet", async () => {
    expect(await demoModeWith("", "devnet")).toBe(true);
  });

  it("is OFF with no database on mainnet: it says unavailable, it does not invent tasks", async () => {
    expect(await demoModeWith("", "mainnet-beta")).toBe(false);
  });

  it("is OFF with no database on a typo'd mainnet", async () => {
    expect(await demoModeWith("", "mainnet")).toBe(false);
  });

  it("is off with a database", async () => {
    expect(await demoModeWith("postgresql://x/y", "devnet")).toBe(false);
  });
});

describe("every place that lists or looks up a task applies the sample rule (source)", () => {
  // These pages and routes need a database, so they cannot be run here. What can be pinned
  // is that none of them was left out: a listing that forgot the filter would show a seeded
  // task, or count it in a total, on mainnet.
  const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), "utf8");
  const count = (src: string, needle: string) => src.split(needle).length - 1;

  it("the docket filters all four of its queries", () => {
    expect(count(read("app", "(app)", "docket", "page.tsx"), "withoutSamples(")).toBeGreaterThanOrEqual(4);
  });

  it("the list API filters the listing, its total and the escrow aggregate", () => {
    expect(count(read("app", "api", "tasks", "route.ts"), "withoutSamples(")).toBeGreaterThanOrEqual(2);
    // `visible` is used by both the listing and the count, so they cannot disagree.
    expect(read("app", "api", "tasks", "route.ts")).toMatch(/where: visible/);
    expect(count(read("app", "api", "tasks", "route.ts"), "where: visible")).toBeGreaterThanOrEqual(2);
  });

  it("the review queue filters", () => {
    expect(read("app", "(app)", "review", "page.tsx")).toMatch(/withoutSamples\(/);
  });

  it("the task page, the task API and the shared ruling check hide a sample row on mainnet", () => {
    expect(read("app", "(app)", "task", "[id]", "page.tsx")).toMatch(/hideSampleOnMainnet\(/);
    expect(read("app", "api", "tasks", "[id]", "route.ts")).toMatch(/hideSampleOnMainnet\(/);
    expect(read("lib", "server", "judging.ts")).toMatch(/hideSampleOnMainnet\(/);
  });

  it("the banner is on the app shell and the landing page", () => {
    expect(read("components", "AppShell.tsx")).toMatch(/<MainnetBanner \/>/);
    expect(read("app", "page.tsx")).toMatch(/<MainnetBanner \/>/);
  });
});

describe("the seed scripts", () => {
  const root = process.cwd();
  const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

  it("both refuse on mainnet, before connecting to anything", () => {
    for (const file of [["prisma", "seed.ts"], ["scripts", "seed-samples.mjs"]]) {
      const src = read(...file);
      expect(src, file.join("/")).toMatch(/if \(treatAsMainnet\(\)\) \{/);
      const refusal = src.indexOf("treatAsMainnet()");
      const connect = src.indexOf("new PrismaClient");
      expect(refusal, `${file.join("/")}: refuses before it creates a client`).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(connect);
      expect(src).toMatch(/process\.exit\(1\)/);
    }
  });

  it("both load the env files, or the cluster is invisible to the refusal", () => {
    for (const file of [["prisma", "seed.ts"], ["scripts", "seed-samples.mjs"]]) {
      expect(read(...file), file.join("/")).toMatch(/loadEnv\(\{ path: "\.env\.local"/);
    }
  });

  it("prisma/seed.ts gives its rows the demo- id, so the UI labels them", () => {
    expect(read("prisma", "seed.ts")).toMatch(/id: `\$\{SAMPLE_ID_PREFIX\}seed-/);
  });

  it("prisma/seed.ts takes its creator and placeholder signature from the shared module, not its own copies", () => {
    const src = read("prisma", "seed.ts");
    expect(src).toMatch(/SAMPLE_CREATORS\[1\]/);
    expect(src).toMatch(/= SEED_FAKE_TX/);
    expect(src).not.toMatch(/"Co4Q/);
    expect(src).not.toMatch(/"5"\.repeat/);
  });
});

describe("the mainnet banner", () => {
  const limits = (over: Record<string, unknown> = {}) => ({
    initialised: true,
    maxBounty: "50000000",
    paused: false,
    ...over,
  });

  it("always says MAINNET and UNAUDITED", () => {
    for (const l of [null, limits(), limits({ paused: true }), limits({ initialised: false, maxBounty: "0" })]) {
      const text = mainnetBannerText(l);
      expect(text).toMatch(/MAINNET/);
      expect(text).toMatch(/UNAUDITED/);
    }
  });

  it("shows the LIVE cap from the chain", () => {
    expect(mainnetBannerText(limits())).toContain("BOUNTIES CAPPED AT 50.00 USDC");
    expect(mainnetBannerText(limits({ maxBounty: "1000000000" }))).toContain("1000.00 USDC");
    expect(mainnetBannerText(limits({ maxBounty: "5000000" }))).toContain("5.00 USDC");
  });

  it("says capped WITHOUT a number when the cap could not be read: never a guess", () => {
    const text = mainnetBannerText(null);
    expect(text).toMatch(/BOUNTIES ARE CAPPED/);
    expect(text).not.toMatch(/\d/);
  });

  it("says when new tasks are paused, or cannot be sealed yet", () => {
    expect(mainnetBannerText(limits({ paused: true }))).toMatch(/NEW TASKS PAUSED/);
    expect(mainnetBannerText(limits({ initialised: false, maxBounty: "0" }))).toMatch(/CANNOT BE SEALED YET/);
  });

  it("does not claim a cap when the limits are not set up", () => {
    expect(mainnetBannerText(limits({ initialised: false, maxBounty: "0" }))).not.toMatch(/CAPPED AT/);
  });
});
