# Rubric — design system

This file is the authority for every screen in this app. Read it before writing
any UI. If a screen drifts from this, the screen is wrong, not this file.

## The concept

Rubric is an escrow protocol where acceptance criteria are sealed on-chain and an
AI judge rules against them. The interface should look like a serious financial
record system: a document, a ledger, a receipt. Restrained, dense, precise.

Two surfaces, deliberately different:

1. THE LANDING PAGE (`/`) — dark, one strong animated visual, otherwise plain.
2. THE APP (`/docket`, `/create`, `/task/[id]`) — light, document-like, no ornament.

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

## Tokens — APP (light)

| Role            | Value     | Notes                                     |
| --------------- | --------- | ----------------------------------------- |
| Page background | `#f5f2ea` |                                           |
| Surface         | `#fbfaf6` |                                           |
| Surface raised  | `#ffffff` |                                           |
| Border strong   | `#1c1917` |                                           |
| Border          | `#d6d1c4` |                                           |
| Border hairline | `#e5e1d6` |                                           |
| Text            | `#1c1917` |                                           |
| Text secondary  | `#44403c` |                                           |
| Text muted      | `#78716c` |                                           |
| Text faint      | `#a8a29e` |                                           |
| Accent (purple) | `#7c33d6` | clause numerals, active nav, key labels    |
| Accent strong   | `#9945FF` | only in the Solana mark and one rule       |
| Positive        | `#0b7d5a` | approved, paid                             |
| Negative        | `#b3234a` | rejected                                   |
| Warning         | `#92400e` | held for review                            |

## Tokens — LANDING (dark)

```
Ground #0a0a0c · Section #101014 · Panel #16161b · Panel dark #121216
Borders #1f1f26 / #26262f
Text #f4f4f5 · Muted #a1a1aa · Faint #71717a
Solana purple #9945FF · Solana green #14F195
```

## Layout rules

- Corner radius: 2px on inputs and buttons, 0 elsewhere. Never above 4px.
- Elevation: borders, not shadows. The only permitted shadow is a 1px hairline
  under a sticky header.
- Everything sits on a strict 8px spacing scale.
- Tables and record rows are separated by 1px hairlines, never by gaps or cards.
- Section breaks use a 1px `#1c1917` rule. Use these sparingly and only where a
  real structural break exists.
- Nothing is rotated except verdict stamps (see below). No element sits off-axis
  "for character".

## The two motifs that are allowed (because they mean something)

1. **THE CLAUSE MARK.** Acceptance criteria are numbered §1 §2 §3, in Plex Mono, in
   `#7c33d6`. Never bullets, never "1." — the section mark signals that clauses are
   binding terms, which is literally true here. Used everywhere clauses appear.

2. **THE VERDICT STAMP.** A rectangular outline containing a single uppercase word in
   Plex Mono 600 at 0.16em tracking: APPROVED (`#0b7d5a`), REJECTED (`#b3234a`),
   SEALED (`#7c33d6`), HELD (`#92400e`). 2px border, no fill, rotated exactly -4deg,
   `mix-blend-mode: multiply` on light surfaces. The rotation is the ONE permitted
   tilt in the product — it reads as a stamp pressed by hand onto a record, which
   is exactly the mental model. Everything else stays square.

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
- A visible 2px `#9945FF` focus ring at offset 2px, on every interactive element.
- Decorative SVG is `aria-hidden="true"`.
- Stamps are `aria-hidden` with the status also present as text.
- Every status colour is paired with a word, so nothing depends on colour alone.
- Maintain 4.5:1 contrast over the hero glow; the vignette exists for this, do not
  remove it.

## Responsive

Below 900px: stack all multi-column sections, scale the aperture to ~130vw so it
bleeds off-screen rather than shrinking, and stack the landing figures 2×2.
**Never scroll horizontally**, at any width down to 375px.
