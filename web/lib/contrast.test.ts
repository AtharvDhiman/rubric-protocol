import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The colour system, enforced by machine rather than by review.
 *
 * This project has shipped a contrast catastrophe twice, and both times it
 * survived review because there was a sentence that sounded like a reason:
 *
 *   - Solana brand green used as body text on a light plate. 1.02:1 -
 *     effectively invisible. The reason it survived was "it is the brand
 *     colour", which is true and irrelevant: those values are tuned for a
 *     black ground, and quoting somebody's brand does not exempt the text
 *     from being readable.
 *   - Secondary ink set against the wrong grey, below even the 3:1 non-text
 *     floor, because the ratio was checked against the surface the designer
 *     had in mind rather than the worst surface the token is allowed on.
 *
 * A rule in a comment cannot prevent either. This test can. It parses the real
 * stylesheet - not a copy of the values, the actual shipped file - and crosses
 * every ink against every ground it is permitted on, including the pairs that
 * only occur when a component is nested somewhere its author did not expect.
 *
 * It also asserts the DANGEROUS pairs are dangerous. If someone "fixes" a
 * volume ink by lightening it until it works on paper too, the scoping rule
 * loses its purpose and the system quietly becomes one flat palette; the
 * cross-family assertions below fail in that case, on purpose.
 */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Pull `--name: #value;` pairs out of a named block. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

function blockNamed(selector: string): string {
  // Non-greedy to the first closing brace at the start of a line, which is how
  // every top-level block in this stylesheet is formatted.
  const re = new RegExp(
    `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)^\\}`,
    "m"
  );
  const m = CSS.match(re);
  if (!m) throw new Error(`could not find the ${selector} block in globals.css`);
  return m[1];
}

const ROOT = tokensIn(blockNamed(":root"));

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  const [r, g, b] = (full.match(/../g) as string[])
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

/** Every ground a light-side ink can legally land on. */
const LIGHT_GROUNDS = ["--page", "--surface", "--raised", "--sunk", "--row-hover"];
/** Every ground a volume ink can legally land on. */
const VOLUME_GROUNDS = ["--d-ground", "--d-section", "--d-panel", "--d-panel-dark"];

/** floor 4.5 = body text; floor 3 = large text, rules, and graphics. */
const LIGHT_INKS: Array<[string, number]> = [
  ["--text", 4.5],
  ["--text-2", 4.5],
  ["--text-muted", 4.5],
  ["--text-faint", 4.5],
  ["--text-disabled", 4.5],
  ["--accent", 4.5],
  ["--accent-strong", 4.5],
  ["--negative", 4.5],
  ["--positive", 4.5],
  ["--warning", 4.5],
  ["--hairline", 3],
  ["--ghost-stroke", 3],
];

const VOLUME_INKS: Array<[string, number]> = [
  ["--d-text", 4.5],
  ["--d-muted", 4.5],
  ["--d-faint", 4.5],
  ["--marker", 4.5],
  ["--v-negative", 4.5],
  ["--v-positive", 4.5],
  ["--v-warning", 4.5],
  ["--d-border", 3],
  ["--d-border-2", 3],
  ["--rig-line", 3],
  ["--rig-solved", 3],
  ["--ghost-vol", 3],
];

describe("every token the stylesheet declares actually exists", () => {
  it("resolves every ink and ground referenced by this test", () => {
    const needed = [
      ...LIGHT_GROUNDS,
      ...VOLUME_GROUNDS,
      ...LIGHT_INKS.map(([n]) => n),
      ...VOLUME_INKS.map(([n]) => n),
    ];
    const missing = needed.filter((n) => !ROOT[n]);
    expect(missing).toEqual([]);
  });
});

describe("light inks on light grounds", () => {
  for (const [ink, floor] of LIGHT_INKS) {
    for (const ground of LIGHT_GROUNDS) {
      it(`${ink} on ${ground} clears ${floor}:1`, () => {
        const r = ratio(ROOT[ink], ROOT[ground]);
        expect(
          r,
          `${ink} ${ROOT[ink]} on ${ground} ${ROOT[ground]} = ${r}:1`
        ).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});

describe("volume inks on volume grounds", () => {
  for (const [ink, floor] of VOLUME_INKS) {
    for (const ground of VOLUME_GROUNDS) {
      it(`${ink} on ${ground} clears ${floor}:1`, () => {
        const r = ratio(ROOT[ink], ROOT[ground]);
        expect(
          r,
          `${ink} ${ROOT[ink]} on ${ground} ${ROOT[ground]} = ${r}:1`
        ).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});

describe("the cross-family pairs stay dangerous, which is why .volume exists", () => {
  /**
   * These assertions look backwards - they require the ratio to be BAD. That is
   * the point. The two ink families cannot be merged, and these pairs are why.
   *
   * NO SCREEN CURRENTLY MOUNTS A VOLUME. The last one went when the verdict
   * oracle moved onto the plate, so the scope is dormant - and a dormant scope
   * is precisely what a later reader deletes on sight. These assertions are
   * what make that deletion a decision rather than an accident: while they
   * hold, reintroducing a bounded dark viewport is a class change and not a
   * redesign. If someone tunes a token until it works on both grounds, the
   * scoping rule becomes decoration and the next person will reasonably
   * conclude the scope is unnecessary and remove it.
   *
   * If one of these fails, do not relax the assertion. Either the token moved
   * by accident, or the system has genuinely collapsed into one flat palette,
   * and that is a design decision to make deliberately rather than discover.
   */
  it("--marker is unusable on the light page", () => {
    expect(ratio(ROOT["--marker"], ROOT["--page"])).toBeLessThan(3);
  });

  it("--accent-strong is unusable inside a volume", () => {
    expect(ratio(ROOT["--accent-strong"], ROOT["--d-panel"])).toBeLessThan(3);
  });

  it("--warning is unusable inside a volume", () => {
    // The specific slip a design review caught: drifting rig geometry proposed
    // in --warning, which is 1.74:1 on --d-panel.
    expect(ratio(ROOT["--warning"], ROOT["--d-panel"])).toBeLessThan(3);
  });

  it("the Solana brand greens are unusable as text on the plate", () => {
    // This is the actual 1.02:1 bug, pinned so it cannot return.
    expect(ratio(ROOT["--sol-green"], ROOT["--surface"])).toBeLessThan(3);
    expect(ratio(ROOT["--sol-purple"], ROOT["--surface"])).toBeLessThan(4.5);
  });
});

describe(".volume remaps every token a nested component could read", () => {
  const VOLUME_BLOCK = blockNamed(".volume");

  /**
   * A component written against --surface and --text must resolve to the
   * volume equivalents when it is placed inside one. Any ground or ink token
   * left unmapped is a hole: the component keeps the light value and paints
   * paper-coloured text on a near-black panel.
   */
  const MUST_REMAP = [
    "--page",
    "--surface",
    "--raised",
    "--sunk",
    "--text",
    "--text-2",
    "--text-muted",
    "--text-faint",
    "--border",
    "--hairline",
    "--accent",
    "--accent-strong",
    "--positive",
    "--negative",
    "--warning",
  ];

  for (const token of MUST_REMAP) {
    it(`remaps ${token}`, () => {
      expect(VOLUME_BLOCK).toMatch(new RegExp(`${token}\\s*:`));
    });
  }
});

describe("the focus ring is legible against everything it can touch", () => {
  it("clears 3:1 on every light ground", () => {
    for (const ground of LIGHT_GROUNDS) {
      expect(ratio(ROOT["--text"], ROOT[ground])).toBeGreaterThanOrEqual(3);
    }
  });

  it("clears 3:1 on every volume ground", () => {
    for (const ground of VOLUME_GROUNDS) {
      expect(ratio(ROOT["--marker"], ROOT[ground])).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * WCAG 1.4.11 asks about ADJACENT colours, and adjacency here is decided by
   * `outline-offset: 2px`. The ring does not touch the button fill at all -
   * there is a 2px band of ground between them - so the pair that must clear
   * 3:1 is ring-against-ground, not ring-against-fill.
   *
   * This distinction is worth pinning, because both directions are easy to get
   * wrong. --text on --accent-strong is only 1.80:1, which looks alarming and
   * is irrelevant; meanwhile the pair that IS adjacent to the fill is the inset
   * hairline, and nothing would have checked it.
   */
  it("separates the ring from a primary button fill via the inset hairline", () => {
    expect(ratio(ROOT["--raised"], ROOT["--accent-strong"])).toBeGreaterThanOrEqual(3);
  });

  it("keeps a 2px ground band between the ring and the fill", () => {
    // If the offset is ever removed, ring and fill become adjacent at 1.80:1
    // and the reasoning above stops holding. Assert the offset still ships.
    const focusBlock = CSS.slice(CSS.indexOf(":focus-visible"));
    expect(focusBlock).toMatch(/outline-offset:\s*2px/);
  });
});

describe("the modal scrim composites to something readable", () => {
  it("keeps --d-text legible over the scrim on --page", () => {
    // --overlay is rgba, so the real question is what it composites TO.
    const m = CSS.match(/--overlay:\s*rgba\(([^)]+)\)/);
    expect(m).toBeTruthy();
    const [r, g, b, a] = (m as RegExpMatchArray)[1]
      .split(",")
      .map((s) => Number(s.trim()));
    const page = ROOT["--page"].replace("#", "");
    const [pr, pg, pb] = (page.match(/../g) as string[]).map((x) =>
      parseInt(x, 16)
    );
    const mix = (fg: number, bg: number) => Math.round(fg * a + bg * (1 - a));
    const composited =
      "#" +
      [mix(r, pr), mix(g, pg), mix(b, pb)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    expect(ratio(ROOT["--d-text"], composited)).toBeGreaterThanOrEqual(4.5);
  });
});
