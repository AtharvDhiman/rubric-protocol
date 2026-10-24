import { describe, expect, it } from "vitest";
import { PAGE_VERIFY, buildTractionView, explorerAddressUrlFor, splitFigures, type TractionView } from "./traction-view";
import { buildTractionReport, type TaskRecord } from "./traction";
import { TEST_NETWORK_HEADING, formatTractionText } from "./traction-format";
import type { Provenance } from "./traction-chain";

const records: TaskRecord[] = [
  { creator: "A", worker: "B", mint: "M", bountyAmount: 5_000_000n, state: "settled", approved: true, decidedAt: 1_790_000_000 },
  { creator: "A", worker: "C", mint: "M", bountyAmount: 2_500_000n, state: "refunded", approved: false, decidedAt: 1_790_000_100 },
  { creator: "D", worker: null, mint: "M", bountyAmount: 1_000_000n, state: "open", approved: null, decidedAt: null },
  { creator: "E", worker: "E", mint: "M", bountyAmount: 9_000_000n, state: "settled", approved: true, decidedAt: 1_790_000_200 },
];
const report = buildTractionReport(records, { mint: "M", feeBps: 200 });

const prov = (cluster: Provenance["cluster"] = "devnet"): Provenance => ({
  programId: "ProgramAddress1111111111111111111111111111111",
  cluster,
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  slot: 514_544_536,
  fetchedAt: "2026-10-24T08:14:37.168Z",
});

const everything = (v: TractionView) =>
  JSON.stringify([v.headline, v.setAside, v.weekly, v.provenance, v.caveats, v.verify, v.command]);

describe("the test-network notice", () => {
  it("is present on every cluster except mainnet, including one it cannot identify", () => {
    for (const cluster of ["devnet", "testnet", "unknown"] as const) {
      const v = buildTractionView(report, prov(cluster));
      expect(v.notice?.heading, cluster).toBe(TEST_NETWORK_HEADING);
      expect(v.notice?.explanation, cluster).toMatch(/no real money moved/);
    }
  });

  it("is absent on mainnet and only there", () => {
    expect(buildTractionView(report, prov("mainnet")).notice).toBeNull();
  });
});

describe("the headline", () => {
  const v = buildTractionView(report, prov());
  const row = (label: string) => v.headline.find((r) => r.label === label);

  it("counts only the independent tasks", () => {
    // A->B settled, A->C rejected, and D's open task (no worker yet is still independent).
    expect(row("Tasks")?.value).toBe("3");
    expect(row("Tasks")?.note).toBe("open 1, submitted 0, settled 1, rejected 1, reclaimed 0");
    expect(row("Posters")?.value).toBe("2");
    expect(row("Posters")?.note).toBe("1 posted more than once, 0 had more than one settled");
    expect(row("Workers")?.value).toBe("2");
    expect(row("Poster-worker pairs")?.value).toBe("2");
  });

  it("states amounts in USDC, with the money split on the settled row", () => {
    expect(row("Posted")?.value).toBe("8.50 USDC");
    expect(row("Settled")?.value).toBe("5.00 USDC");
    expect(row("Settled")?.note).toBe("workers received 4.90 USDC, fees 0.10 USDC");
    expect(row("Refunded")?.value).toBe("2.50 USDC");
  });

  it("gives the approval rate with how many tasks it rests on", () => {
    expect(row("Approval rate")?.value).toBe("50.0% of 2 decided");
  });

  it("gives the median of the posted bounties and of the settled ones", () => {
    expect(row("Median bounty")?.value).toBe("2.50 USDC");
    expect(row("Median bounty")?.note).toBe("median settled 5.00 USDC");
  });

  it("never contains the same-wallet task's amount", () => {
    expect(JSON.stringify(v.headline)).not.toContain("9.00 USDC");
  });

  it("an empty deployment has zeros and n/a, not blanks or NaN", () => {
    const empty = buildTractionView(buildTractionReport([], { mint: "M", feeBps: 200 }), prov());
    const text = JSON.stringify(empty.headline);
    expect(text).not.toMatch(/NaN|undefined|null/);
    expect(empty.headline.find((r) => r.label === "Approval rate")?.value).toBe("n/a of 0 decided");
    expect(empty.headline.find((r) => r.label === "Median bounty")?.value).toBe("n/a");
    expect(empty.weekly).toEqual([]);
  });
});

describe("the set-aside block", () => {
  it("holds the same-wallet task, so nothing is hidden", () => {
    const v = buildTractionView(report, prov());
    expect(v.setAside.find((r) => r.label === "Tasks")?.value).toBe("1");
    expect(v.setAside.find((r) => r.label === "Posted")?.value).toBe("9.00 USDC");
    expect(v.setAside.find((r) => r.label === "Settled")?.value).toBe("9.00 USDC");
  });
});

describe("the weekly table", () => {
  it("lists headline weeks only, with settled counts and USDC volume", () => {
    const v = buildTractionView(report, prov());
    expect(v.weekly).toEqual([{ week: "2026-09-21", settled: "1", volume: "5.00 USDC" }]);
  });
});

describe("a copy after a failed read", () => {
  it("is flagged, with its age", () => {
    expect(buildTractionView(report, prov(), { stale: true, ageSeconds: 130 }).stale).toEqual({ ageSeconds: 130 });
  });

  it("a fresh reading, or no cache information, is not flagged", () => {
    expect(buildTractionView(report, prov(), { stale: false, ageSeconds: 3 }).stale).toBeNull();
    expect(buildTractionView(report, prov()).stale).toBeNull();
  });
});

describe("provenance and how to check", () => {
  const v = buildTractionView(report, prov());

  it("names the cluster, program, slot and time", () => {
    const flat = JSON.stringify(v.provenance);
    expect(flat).toContain("devnet");
    expect(flat).toContain("ProgramAddress1111111111111111111111111111111");
    expect(flat).toContain("514544536");
    expect(flat).toContain("2026-10-24T08:14:37.168Z");
    expect(v.provenance.find((r) => r.label === "Task accounts read")?.value).toBe("4");
  });

  it("says the cluster was found by genesis hash, not by URL", () => {
    expect(v.provenance.find((r) => r.label === "Cluster")?.note).toMatch(/genesis hash EtWTRABZ.*not by URL/);
  });

  it("gives a command that names the cluster and never an endpoint", () => {
    expect(v.command).toBe("npx tsx scripts/traction-report.ts --rpc <an RPC endpoint for devnet>");
    expect(buildTractionView(report, prov("unknown")).command).toContain("the same cluster");
  });

  it("carries the caveats and the verification steps, always", () => {
    expect(v.caveats.length).toBeGreaterThanOrEqual(5);
    expect(v.caveats.join(" ")).toMatch(/Wallets are not people/);
    expect(v.verify.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the Explorer link", () => {
  const A = "ProgramAddress1111111111111111111111111111111";

  it("is built for the cluster the figures were READ from", () => {
    expect(explorerAddressUrlFor("mainnet", A)).toBe(`https://explorer.solana.com/address/${A}`);
    expect(explorerAddressUrlFor("devnet", A)).toBe(`https://explorer.solana.com/address/${A}?cluster=devnet`);
    expect(explorerAddressUrlFor("testnet", A)).toBe(`https://explorer.solana.com/address/${A}?cluster=testnet`);
  });

  it("is absent for a cluster it cannot identify, rather than pointing at the wrong one", () => {
    expect(explorerAddressUrlFor("unknown", A)).toBeNull();
    expect(buildTractionView(report, prov("unknown")).explorerUrl).toBeNull();
  });

  it("is on the view for a known cluster", () => {
    expect(buildTractionView(report, prov("devnet")).explorerUrl).toContain("?cluster=devnet");
  });
});

describe("splitFigures", () => {
  const figures = (s: string) => splitFigures(s).filter((x) => x.figure).map((x) => x.text);

  it("is lossless: the segments join back to the input", () => {
    for (const s of [
      "",
      "no figures at all",
      "1 task(s) were posted by the same wallet (9.00 USDC posted, 9.00 USDC settled) and are excluded.",
      "the 2% fee is paid to a wallet the operator controls",
      "ends on a number 514544536",
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU and 12",
      "…, with unicode — and 3.5%.",
    ]) {
      expect(splitFigures(s).map((x) => x.text).join(""), s).toBe(s);
    }
  });

  it("sets amounts, percentages and counts in the figure face, and the words around them in prose", () => {
    expect(splitFigures("fees 0.10 USDC (2%)")).toEqual([
      { text: "fees ", figure: false },
      { text: "0.10 USDC", figure: true },
      { text: " (", figure: false },
      { text: "2%", figure: true },
      { text: ")", figure: false },
    ]);
    expect(figures("1 task(s) were posted (9.00 USDC posted, 9.00 USDC settled)")).toEqual(["1", "9.00 USDC", "9.00 USDC"]);
  });

  it("leaves the sentence's own full stop and comma out of the number", () => {
    expect(figures("settled 5.00 USDC.")).toEqual(["5.00 USDC"]);
    expect(figures("slot 514544536, then")).toEqual(["514544536"]);
    expect(splitFigures("at slot 42.").at(-1)).toEqual({ text: ".", figure: false });
  });

  it("treats an address as one figure, not as a scatter of digits", () => {
    const address = "F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz";
    expect(figures(`program ${address} on devnet`)).toEqual([address]);
  });

  it("finds no figure in plain prose", () => {
    expect(figures("Wallets are not people. One person can use any number of wallets.")).toEqual([]);
  });

  it("covers every caveat the report can produce: no digit is left in the prose face", () => {
    const withSelfDealt = buildTractionReport(records, { mint: "M", feeBps: 200 });
    for (const caveat of withSelfDealt.caveats) {
      const prose = splitFigures(caveat).filter((x) => !x.figure).map((x) => x.text).join("");
      expect(prose, caveat).not.toMatch(/\d/);
    }
  });
});

describe("the page's verification prose", () => {
  it("names no program, slot or number, which sit in the rail in the figure face", () => {
    const text = PAGE_VERIFY.join(" ");
    expect(text).not.toMatch(/\d/);
    expect(splitFigures(text).some((s) => s.figure)).toBe(false);
  });

  it("is what the view carries", () => {
    expect(buildTractionView(report, prov()).verify).toEqual([...PAGE_VERIFY]);
  });
});

describe("agreement with the script's text report", () => {
  it("every USDC amount the script prints is on the page, and the page adds none", () => {
    const amounts = (s: string) => new Set(s.match(/\d+(?:\.\d+)? USDC/g) ?? []);
    for (const cluster of ["devnet", "mainnet"] as const) {
      const text = formatTractionText(report, prov(cluster));
      // The text report's boilerplate has no amounts; its figures are the same ones.
      const fromText = amounts(text);
      const fromView = amounts(everything(buildTractionView(report, prov(cluster))));
      expect([...fromView].sort(), cluster).toEqual([...fromText].sort());
    }
  });

  it("the headline counts match the script's", () => {
    const text = formatTractionText(report, prov());
    const v = buildTractionView(report, prov());
    expect(text).toMatch(/posters\s+2 /);
    expect(v.headline.find((r) => r.label === "Posters")?.value).toBe("2");
    expect(text).toMatch(/approval rate\s+50\.0% of 2 decided/);
    expect(v.headline.find((r) => r.label === "Approval rate")?.value).toBe("50.0% of 2 decided");
  });
});
