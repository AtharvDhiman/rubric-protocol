# Rubric — design system

This file is the authority for every screen in this app. Read it before writing
any UI. If a screen drifts from this, the screen is wrong, not this file.

## The concept

Rubric is an escrow protocol where acceptance criteria are sealed on-chain and an
AI judge rules against them. The interface should look like a serious financial
record system: a document, a ledger, a receipt. Restrained, dense, precise.

ONE visual system across the whole product. The landing page and the app share
the same dark ground, the same type, the same borders, the same accents. The
landing has exactly one extra thing: the animated aperture in its hero. Nothing
else differs. A visitor moving from the landing into the app should not feel a
seam.

## What this must NOT look like

- No Inter, Roboto, Poppins, Montserrat, or system-ui as a visible font.
- No rounded-2xl card grids floating on a white background.
- No gradient hero cards, glassmorphism, glow-on-hover, or lift-on-hover.
- No decorative or handwriting fonts. No faux-paper texture, no fake tape,
  no simulated coffee stains, no random rotations to look "hand-made".
- No emoji anywhere in the UI.
- No shadcn default look. If a screen starts resembling a Tailwind starter
  template, stop and re-read this file.

Restraint is the point. Precision reads as competence; ornament reads as filler.

## Type — the entire system

```
IBM Plex Sans  (400, 500, 600, 700)  — headings, body, buttons, everything
IBM Plex Mono  (400, 500, 600)       — data: amounts, addresses, IDs, timestamps,
                                       table headers, labels, log output, status
```

Load both with `next/font/google`. Nothing else.

Rules:

- Headings: Plex Sans 600, tight tracking (-0.01em to -0.02em on large sizes).
  Sentence case, not ALL CAPS, except the landing hero.
- Body: Plex Sans 400, 15–16px, line-height 1.6.
- Labels and metadata: Plex Mono, uppercase, 10–11px, letter-spacing 0.14em–0.18em.
  Do not exceed 0.18em — wider tracking starts to look decorative.
- **Any number a person might compare, copy, or verify — amounts, scores,
  addresses, hashes, times — is Plex Mono, never Plex Sans. This is the single
  most important typographic rule in the app.**

> Implementation note. `next/font` publishes `--font-plex-sans` / `--font-plex-mono`
> and the stylesheet maps those onto `--font-sans` / `--font-mono`. The two names
> MUST differ. `:root` IS the `html` element — the same element `next/font` sets
> its variable on — so reusing the name makes the declaration reference itself.
> A cyclic `var()` is invalid at computed-value time, the variable resolves to
> nothing, and every screen silently falls back to the system font stack. That
> shipped once and was invisible until someone read the computed style.

## Tokens — THE WHOLE PRODUCT

| Role          | Value     | Used for                                                       |
| ------------- | --------- | -------------------------------------------------------------- |
| Ground        | `#0a0a0c` | page background everywhere                                      |
| Section       | `#101014` | alternating band, and the active/hover row wash                 |
| Panel         | `#121216` | log panels, hash previews, settlement records                   |
| Border        | `#1f1f26` | hairline dividers, record rows, section rules                   |
| Border strong | `#26262f` | panel borders and record-row hairlines                          |
| Rule strong   | `#f4f4f5` | the bright rule under the app header and the docket table head  |
| Input rule    | `#3f3f46` | the underline beneath a form field                              |
| Text          | `#f4f4f5` |                                                                 |
| Text body     | `#d4d4d8` | clause text and other long-form reading                         |
| Text muted    | `#a1a1aa` |                                                                 |
| Text faint    | `#71717a` | labels, timestamps, units                                       |
| Purple        | `#9945FF` | clause numerals, active nav underline, sealed stamp             |
| Green         | `#14F195` | approved, paid, live indicators                                 |
| Red           | `#ff4d6d` | rejected — brighter than a light-theme red so it holds on dark  |
| Amber         | `#f59e0b` | held for review                                                 |

**There is no light theme. Do not introduce white or cream surfaces anywhere.**

> Why two "strong" values. The source brief uses one name for two jobs: `#26262f`
> where it describes a panel's edge, and `#f4f4f5` where it describes the rule
> under a header or a table head. Painting both at `#26262f` loses the structural
> break; painting both at `#f4f4f5` outlines every panel in near-white. They are
> split here so each keeps its job. `--rule-strong` is for a horizontal break the
> eye should land on, never for an outline.

> Implementation note. `color-scheme: dark` is set on `html`/`body`. Without it the
> browser paints its own widgets in light mode: a `<select>` popup opens white with
> near-white option text, and the scrollbar stays pale. That popup is drawn by the
> OS and ignores CSS colours — `color-scheme` is the only thing it obeys.

## Layout rules

- Corner radius: 2px on inputs and buttons, 0 elsewhere. Never above 4px.
- Elevation: borders, not shadows. On dark, depth comes from the `#101014` /
  `#121216` surface steps and 1px `#1f1f26` hairlines — never from drop shadows.
  The only glow permitted is a soft one behind the APPROVED stamp.
- Everything sits on a strict 8px spacing scale.
- Tables and record rows are separated by 1px hairlines, never by gaps or cards.
- Section breaks use a 1px `#1f1f26` rule. Use these sparingly and only where a
  real structural break exists.
- Nothing is rotated except verdict stamps. No element sits off-axis "for character".

## The two motifs that are allowed (because they mean something)

1. **THE CLAUSE NUMBER.** Acceptance criteria are numbered 1 2 3, in Plex Mono, in
   `#9945FF`. Never bullets. The numeral does the work: colour and monospace mark
   these out as binding terms rather than a list. Used everywhere clauses appear.

   > This previously used the section sign — §1 §2 §3. The owner asked for that
   > symbol to be removed from the site, so it is gone from every screen and from
   > this spec. Do not reintroduce it. The numbering, the purple and the monospace
   > all stay; only the glyph went.

2. **THE VERDICT STAMP.** A rectangular outline containing a single uppercase word in
   Plex Mono 600 at 0.16em tracking: APPROVED (`#14F195`), REJECTED (`#ff4d6d`),
   SEALED (`#9945FF`), HELD (`#f59e0b`), IN REVIEW (`#a1a1aa`). 2px border, no fill,
   rotated exactly -4deg. The large APPROVED stamp on the verdict screen gets
   `box-shadow: 0 0 28px rgba(20,241,149,0.14)`; the small row stamps get none.
   **No `mix-blend-mode`** — `multiply` was correct for ink on a light page; on a
   dark ground it drives the stamp toward black and erases it. The rotation is the
   ONE permitted tilt in the product: it reads as a stamp pressed by hand onto a
   record, which is exactly the mental model. Everything else stays square.

Do not invent additional motifs.

## Solana brand mark (reusable component)

`<SolanaMark size={20} />` — three bars stacked, gap = size/8, bar height = size/4.4:

```
bars 1 & 3: linear-gradient(90deg,#9945FF,#14F195),
            clip-path polygon(22% 0, 100% 0, 78% 100%, 0 100%)
bar 2:      linear-gradient(90deg,#14F195,#9945FF),
            clip-path polygon(0 0, 78% 0, 100% 100%, 22% 100%)
```

The Solana purple→green gradient appears in exactly two places per screen: this
mark, and the primary button. Nowhere else.

## Motion

- The hero animates on load. Everything below the fold animates on scroll via a
  `useInView` hook (IntersectionObserver, threshold 0.2, triggerOnce). Do not fire
  everything at mount.
- Animate `transform` / `opacity` / `filter` only. `will-change: transform` on the
  aperture and rings.
- `@media (prefers-reduced-motion: reduce)` disables every transform and rotation,
  leaving elements at final opacity. **The page must be complete with zero motion.**
- All keyframes live in one block in `globals.css`.

## Accessibility

- Headings in document order, one real `<h1>` per page.
- Labelled form controls. Real `<button>` elements.
- A visible 2px `#9945FF` focus ring at offset 2px on every interactive element.
- Decorative SVG is `aria-hidden="true"`.
- Stamps are `aria-hidden` with the status also present as text.
- Every status colour is paired with a word, so nothing depends on colour alone.
- Maintain 4.5:1 contrast over the hero glow; the vignette exists for this, do not
  remove it.

## Responsive

Below 900px: stack all multi-column sections, scale the aperture to ~130vw so it
bleeds off-screen rather than shrinking, and stack the landing figures 2×2.
**Never scroll horizontally**, at any width down to 375px.

## Deviations from the source brief, recorded so they are decisions and not drift

1. **No scroll cue in the hero.** The brief's LAYER 8 specifies a hairline, an
   animated tick and a "Scroll" label at the bottom of the hero. The owner asked
   for it to be removed after seeing it built, so it is gone along with its
   keyframes. If you want it back, the spec is in the source brief.

2. **The docket row restacks below 700px rather than scrolling.** The ledger is
   six fixed-width columns, which cannot shrink. At 375px that forced a 597px
   row and the page scrolled sideways, which this file forbids at any width.
   Below 700px the row wraps onto two lines - Nº and matter, then the data - and
   the column headings hide, because they no longer sit above anything. The
   values stay self-describing: a USDC amount, a duration, a stamp. The header
   bar wraps the same way. Verified at 375px on all four screens.
