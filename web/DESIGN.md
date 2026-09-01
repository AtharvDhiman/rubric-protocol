# Rubric — design system

This file is the authority for every screen in this app. Read it before writing
any UI. If a screen drifts from this, the screen is wrong, not this file.

## The concept

Rubric is an escrow protocol where acceptance criteria are sealed on-chain and an
AI judge rules against them. The interface is black, precise, and lit from a
single source — surfaces read as machined metal and glass rather than as paper.
Nothing glows for decoration; light marks the things you can act on.

ONE visual system across the whole product. The landing page and the app share
the same ground, type, borders and button language. The landing has exactly one
extra thing: the animated aperture in its hero. A visitor moving from the landing
into the app should not feel a seam.

> **This replaces the previous system.** Rubric shipped twice before: an
> "Examiner's Desk" light/paper direction, then an IBM Plex record-ledger
> direction on `#0a0a0c`. Both are dead. If a stale instruction anywhere asks for
> IBM Plex, a monospace family, `§` clause marks, 2px radii, paper texture or
> "borders, never shadows", it is out of date — follow this file.

## What this must NOT look like

- No Roboto, Poppins, Montserrat, or raw `system-ui` as a visible font.
- No rounded-2xl card grids floating on a light background.
- No purple→blue SaaS gradient heroes.
- No emoji anywhere in the UI.
- No second accent colour. The palette is black, white, grey, and one cool
  highlight that is really just the light in the metal.
- If a screen starts resembling a Tailwind starter template, stop and re-read
  this file.

Restraint is still the point. The light is the ornament; nothing else needs to be.

## Type — the entire system

```
Inter              300–700   everything: headings, body, buttons, labels, data
Instrument Serif   400 ital  one accented phrase per page, and nothing else
```

Both via `next/font/google`. Nothing else.

Rules:

- Headings: Inter 500, tight tracking (`-0.035em`, and `-0.045em` on display
  sizes). Sentence case.
- Body: Inter 400, 15–17px, line-height 1.55–1.6.
- Labels and metadata: Inter 500, uppercase, 10–11px, letter-spacing `0.14em`.
- **The accented phrase.** Instrument Serif, italic, 400, `1.08em`,
  `-0.03em`, in `--text-muted`. One phrase per page — the hero's *trust*, and
  its equivalents. It is a change of voice, not a highlight: it is grey, not
  white, so it recedes rather than shouts. Use `.accent-phrase`. Two of these on
  one screen means one of them is wrong.

> **There is no monospace family.** The previous system set every figure in IBM
> Plex Mono so columns would line up. Inter's `font-variant-numeric: tabular-nums`
> does the same job, so `.data` provides alignment without a second family to
> download. `--font-mono` still exists as an alias to `--font-sans` so older call
> sites keep resolving; do not add new ones.

> Implementation note. `next/font` publishes `--font-inter` / `--font-instrument`
> and the stylesheet maps those onto `--font-sans` / `--font-serif`. The two names
> MUST differ. `:root` IS the `html` element — the same element `next/font` sets
> its variable on — so reusing the name makes the declaration reference itself.
> A cyclic `var()` is invalid at computed-value time, the variable resolves to
> nothing, and every screen silently falls back to the system font stack. That
> shipped once and was invisible until someone read the computed style.

## Tokens — THE WHOLE PRODUCT

| Role          | Value                      | Used for                                    |
| ------------- | -------------------------- | ------------------------------------------- |
| Ground        | `#000000`                  | page background everywhere                  |
| Section       | `#0a0a0a`                  | the barely-raised band                      |
| Panel         | `#101010`                  | log panels, hash previews, receipts         |
| Border        | `rgba(255,255,255,0.16)`   | dividers, record rows, section rules        |
| Hairline      | `rgba(255,255,255,0.12)`   | the quieter divider                         |
| Input rule    | `rgba(255,255,255,0.28)`   | the underline beneath a form field          |
| Row hover     | `rgba(255,255,255,0.04)`   | the record-row wash                         |
| Text          | `#ffffff`                  |                                             |
| Text body     | `#d8d8d8`                  | clause prose and other long-form reading    |
| Text muted    | `#9a9a9a`                  | ledes, secondary lines, the accent phrase   |
| Text faint    | `#7a7a7a`                  | labels, timestamps, units                   |
| Accent        | `#bad0ff`                  | clause numbers, active nav, focus rings     |
| Green         | `#14F195`                  | approved, paid, live                        |
| Red           | `#ff4d6d`                  | rejected                                    |
| Amber         | `#f59e0b`                  | held for review                             |

**There is no light theme. Do not introduce white or cream surfaces anywhere.**

The accent is deliberately barely a colour: it is the same cool white the buttons
throw when they glow, so the accent and the light in the metal are demonstrably
the same thing. Status colours stay chromatic because they carry meaning — and
every one of them is paired with a word in the markup, never colour alone.

> Implementation note. `color-scheme: dark` is set on `html`/`body`. Without it
> the browser paints its own widgets in light mode: a `<select>` popup opens white
> with near-white option text, and the scrollbar stays pale. That popup is drawn
> by the OS and ignores CSS colours — `color-scheme` is the only thing it obeys.

## Surfaces and light

- Corner radius: 6px on buttons and inputs, 7px on nav pills, 4px on stamps,
  0 elsewhere. Never above 10px.
- Depth comes from **light**, not from drop shadows for their own sake: a
  gradient body, an `inset 0 1px 0` highlight along the top edge, and a glow only
  on hover or on the current page.
- Everything sits on a strict 8px spacing scale.
- Tables and record rows are separated by 1px hairlines, never by gaps or cards.
- Nothing is rotated except verdict stamps.

## The three motifs

1. **THE CLAUSE NUMBER.** Acceptance criteria are numbered 1 2 3 in `--accent`,
   tabular figures, weight 500. Never bullets. Used everywhere clauses appear.
   *(This previously used the section sign — §1 §2 §3. The owner asked for that
   glyph to be removed from the site. Do not reintroduce it.)*

2. **THE VERDICT STAMP.** A rounded outline containing a single uppercase word at
   `0.14em` tracking: APPROVED (`#14F195`), REJECTED (`#ff4d6d`), SEALED,
   HELD (`#f59e0b`), IN REVIEW. 1.5px border, faint inner light, rotated exactly
   `-4deg`. The large APPROVED stamp on the verdict screen gets a soft green
   glow; small row stamps get none. **No `mix-blend-mode`** — `multiply` was
   right for ink on a light page; on black it drives the stamp toward black and
   erases it. The rotation is the ONE permitted tilt in the product.

3. **THE SWEEP.** Every button and nav pill carries a specular highlight that
   crosses it on hover — a pseudo-element translating from `-130%` to `130%` over
   0.65s. It is what makes the surfaces read as lit rather than painted. It is
   never used on anything that is not interactive; that is the whole signal.

## Buttons

Two, and only two.

- **Primary** — white metal. `linear-gradient(180deg,#fff,#e7e7e7 48%,#cfcfcf)`,
  `#111` label, white border, inset top highlight. Hover shifts cool and glows
  `rgba(186,208,255,0.4)`. **One per screen.**
- **Default** — liquid glass. A dark diagonal gradient with a cool cast, a
  `rgba(198,198,198,0.45)` border and a faint inset highlight. Hover brightens
  the cast, warms the border toward `rgba(220,230,255,0.75)` and glows.

Nav pills are a third surface, not a third button: a harder metal ramp
(`105deg, #050505 → #2a2a2a 48% → #4a4a4a`) used for navigation only, so the
pill shape always means "somewhere you can go". The current page keeps its glow
on permanently instead of adding an underline — one signal, always on.

## Solana brand mark

`<SolanaMark size={20} />` — three bars stacked, gap = size/8, bar height =
size/4.4, purple→green gradient. This is the one place the interface is allowed
to be chromatic beyond status, because it is somebody else's brand and it is
being quoted, not designed.

## Motion

- The hero animates on load in one orchestrated sequence, not as scattered
  effects. Everything below the fold animates on scroll via `useInView`
  (IntersectionObserver, threshold 0.2, triggerOnce).
- Animate `transform` / `opacity` / `filter` only. `will-change: transform` on
  the aperture and rings.
- The aperture and both rings turn **clockwise**, at three different speeds. The
  speed difference is what separates them into depths; they do not counter-rotate.
- `@media (prefers-reduced-motion: reduce)` disables every transform and rotation,
  leaving elements at final opacity. **The page must be complete with zero motion.**
- All keyframes live in one block in `globals.css`.

## Accessibility

- Headings in document order, one real `<h1>` per page.
- Labelled form controls. Real `<button>` elements.
- A visible 2px `--accent` focus ring at offset 2px on every interactive element.
- Decorative SVG is `aria-hidden="true"`.
- Stamps are `aria-hidden` with the status also present as text.
- Every status colour is paired with a word, so nothing depends on colour alone.
- Maintain 4.5:1 contrast over the hero glow; the vignette exists for this.

## Responsive

Below 900px: stack all multi-column sections, scale the aperture to ~130vw so it
bleeds off-screen rather than shrinking, and stack the landing figures 2×2.
The docket's six fixed-width columns restack onto two lines below 700px — they
cannot shrink, and **the page must never scroll horizontally**, at any width down
to 375px.

## Deviations, recorded so they are decisions and not drift

1. **No scroll cue in the hero.** The source brief specifies a hairline, an
   animated tick and a "Scroll" label at the bottom of the hero. The owner asked
   for it to be removed after seeing it built, so it is gone along with its
   keyframes.

2. **The docket row restacks below 700px rather than scrolling.** At 375px the
   six fixed-width columns forced a 597px row and the page scrolled sideways,
   which this file forbids at any width. Below 700px the row wraps onto two lines
   and the column headings hide, because they no longer sit above anything. The
   values stay self-describing: an amount, a duration, a stamp.
