# Rubric — design system

This file is the authority for every screen in this app. Read it before writing
any UI. If a screen drifts from this, the screen is wrong, not this file.

## The concept

Rubric is an escrow protocol where acceptance criteria are sealed on-chain and an
AI judge rules against them. The interface is light, precise, and lit from above
— surfaces read as machined metal and glass on paper. Nothing is decorated for
its own sake; light marks the things you can act on.

ONE visual system across the whole product. The landing page and the app share
the same ground, type, borders and button language. The landing has exactly one
extra thing: the animated aperture in its hero. A visitor moving from the landing
into the app should not feel a seam.

> **This replaces the previous systems.** Rubric shipped three before: an
> "Examiner's Desk" light/paper direction, an IBM Plex record-ledger on
> `#0a0a0c`, and a pure-black Vesper direction. All three are dead. The current
> system keeps the black system's *language* — lit metal, glass, one sweep — and
> inverts its *ground*. If a stale instruction anywhere asks for
> IBM Plex, a monospace family, `§` clause marks, 2px radii, paper texture or
> "borders, never shadows", it is out of date — follow this file.

## What this must NOT look like

- No Roboto, Poppins, Montserrat, or raw `system-ui` as a visible font.
- No rounded-2xl card grids floating on a light background.
- No purple→blue SaaS gradient heroes.
- No emoji anywhere in the UI.
- No second accent colour. The palette is paper, ink, grey, and one cool blue.
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
| Ground        | `#fbfbfd`                  | page background everywhere                  |
| Section       | `#f4f5f8`                  | the alternating band                        |
| Panel         | `#eef0f4`                  | log panels, hash previews, receipts         |
| Border        | `rgba(16,18,27,0.14)`      | dividers, record rows, section rules        |
| Hairline      | `rgba(16,18,27,0.09)`      | the quieter divider                         |
| Input rule    | `rgba(16,18,27,0.28)`      | the underline beneath a form field          |
| Row hover     | `rgba(16,18,27,0.035)`     | the record-row wash                         |
| Text          | `#0e1016`                  |                                             |
| Text body     | `#34363f`                  | clause prose and other long-form reading    |
| Text muted    | `#63656f`                  | ledes, secondary lines, the accent phrase   |
| Text faint    | `#86887f`                  | labels, timestamps, units                   |
| Accent        | `#2f4bd8`                  | clause numbers, active nav, focus rings     |
| Green         | `#0a7f4f`                  | approved, paid, live                        |
| Red           | `#c62740`                  | rejected                                    |
| Amber         | `#a56a09`                  | held for review                             |

**There is no dark theme. Do not introduce black or near-black surfaces
anywhere**, other than the primary button and the type itself.

The ground is `#fbfbfd`, not `#ffffff`: a white with a faint cool bias, chosen to
sit under the blue accent rather than fight it. Pure white next to `#2f4bd8`
reads as unconsidered.

Status colours stay chromatic because they carry meaning, and each is darkened
from its dark-theme value — the old `#14F195` and `#ff4d6d` were tuned to glow on
black and are unreadable on paper. Every one is paired with a word in the markup,
never colour alone.

> Implementation note. `color-scheme: light` is set on `html`/`body` so the
> browser paints its own widgets to match: the `<select>` popup, the scrollbar,
> form controls. Recolouring a `<select>` with CSS does NOT fix its popup — that
> list is drawn by the OS, and `color-scheme` is the only thing it obeys.

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
   `0.14em` tracking: APPROVED (`#0a7f4f`), REJECTED (`#c62740`), SEALED,
   HELD (`#a56a09`), IN REVIEW. 1.5px border, a white inner light and a 1px lift,
   rotated exactly `-4deg`. **No `mix-blend-mode`.** It is tempting again now
   that the ground is paper — `multiply` is the classic ink-on-paper trick — but
   it was removed for a reason and the reason still applies: the stamp sits over
   panels and row washes, not only over the ground, and `multiply` darkens it
   unpredictably against each one. The rotation is the ONE permitted tilt in the
   product.

3. **THE SWEEP.** Every button and nav pill carries a specular highlight that
   crosses it on hover — a pseudo-element translating from `-130%` to `130%` over
   0.65s. It is what makes the surfaces read as lit rather than painted. It is
   never used on anything that is not interactive; that is the whole signal.

## Buttons

Two, and only two.

- **Primary** — graphite metal. `linear-gradient(180deg,#2c2f39,#17191f 48%,#0c0d12)`,
  white label, inset top highlight. It is the only near-black object on the page,
  which is exactly the inversion of the dark system where it was the only white
  one: the primary action is the single solid, opaque thing on screen.
  **One per screen.**
- **Default** — light glass. A near-white diagonal gradient, a
  `rgba(16,18,27,0.16)` border, an inset white highlight and a 1px lift. Hover
  brightens it and turns the border toward the accent.

The sweep inverts with them: it is a *dark* streak crossing light glass, and a
*light* streak crossing the dark primary. A white sweep on white glass is
invisible, which is how you can tell whether someone checked.

Nav pills are a third surface, not a third button: a light metal ramp
(`105deg, #ffffff → #f0f2f6 48% → #dfe4ed`) used for navigation only, so the pill
shape always means "somewhere you can go". The current page keeps its lift and
accent border on permanently instead of adding an underline — one signal, always
on.

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

## Entrance motion

One orchestrated page-load sequence, not scattered effects.

Elements carry `.appear` plus a modifier — `--scale`, `--soft`, `--mask`,
`--pop`, `--btn`, `--side`, `--stat` — and a `--d` delay that stages them:
logo `0.08s`, then the nav pills every `0.12s`, then the hero badge, the headline
lines, the lede, and the buttons last. Duration `1.05s`,
`cubic-bezier(0.16, 1, 0.3, 1)`.

Two rules that are not decoration:

- **`.appear` rests at opacity 1.** If animations never run — a failed
  stylesheet, an old engine, reduced motion — the page is fully visible rather
  than a blank screen waiting for a keyframe that is not coming.
  `animation-fill-mode: both` supplies the 0% frame during the delay, so when
  animations *do* run the elements still hide and then arrive.
- **Each element retires its own animation** on `animationend`, gaining `.is-in`
  which clears the animation entirely. Without it a finished animation's fill
  state keeps holding a transform, and anything transforming later — a hover
  lift, the stamp's rotation — fights it.

`components/AppearMotion.tsx` wires both, plus a fallback: if nothing is running
after two frames, it forces `.is-in` on everything. That covers the case
`opacity: 1` cannot — an animation that is *declared* but never *starts* would
otherwise strand elements at opacity 0 forever.

Below the fold, sections use `.reveal` with `useInView` (IntersectionObserver,
threshold 0.2, triggerOnce) instead. Load sequence above, scroll reveal below.

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
