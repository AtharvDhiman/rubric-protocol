# Rubric — design system

**CAPTURE VOLUME**

This file is the authority for every screen in this app. Read it before writing
any UI. If a screen drifts from this file, the screen is wrong, not the file.

> **This replaces every previous system.** Rubric has shipped four: an
> "Examiner's Desk" paper direction, an IBM Plex record-ledger on `#0a0a0c`, a
> pure-black Vesper direction, and "Fence Line" (a lever-tumbler lock in zinc and
> brass). All four are dead. If a stale instruction anywhere — including in
> `CLAUDE.md` — asks for IBM Plex, Azeret Mono, Instrument Serif, a `§` clause
> mark, paper grain, a brass fence, a lock drawing, 2px/4px/6px radii or "one
> animated aperture", it is out of date. Follow this file.

---

## The concept

The page is an **instrumented capture volume**: a light metrology plate, lit by
one field that runs behind every screen, on which a rig is visibly measuring
something real.

The volume is the whole plate now, not a rectangle cut into it. The bounded dark
viewport was one way of drawing the measured region; an object drawn straight
onto the page is held by the same instrument everything else sits on, which is a
stronger claim than a decorated box making the same one. A capture volume is the
region the instruments can see — it was never defined by being a dark box.

This is not a costume. Rubric's actual mechanic is that acceptance criteria are
sealed on-chain *before* work starts, and a judge then measures a submission
against them. That is metrology. So:

| The product | The instrument |
|---|---|
| the sealed clauses | the tolerances |
| the judge's confidence | the solve residual |
| the confidence threshold | the pass limit |
| a rejection citing a clause | the coordinate where the probe stopped |

`CONF 94 / THRESHOLD 70 / Δ +24` is not a metaphor bolted onto the verdict. It
**is** the verdict, printed the way an instrument prints one.

---

## The colour rule — read this before touching any colour

**Acceptable states are achromatic. A passing clause is ink, not green.**

Colour is spent on exactly three things:

- `--negative` — **the one alarm.** Out of tolerance, and nothing else. Not a
  disabled button, not a delete link, not an incomplete field.
- `--warning` — **unresolved, not failed.** HELD / needs manual review / below
  threshold. Structurally outside the red-green pair, because a held task is
  neither out of tolerance nor released: *the escrow is untouched*.
- `--positive` — **the one event.** Only where the chain actually moved money.

That last one is the highest-leverage decision in the system. It makes a green
pixel mean *"the chain paid"* rather than *"a check went well"*.

### Colour is never the only channel

`--negative` against `--positive` is **1.04:1**. In greyscale, or to a
deuteranope, they are the same. So every status carries four channels:

1. the **word** (`PASS` / `FAIL` / `HELD`)
2. a **shape** (filled disc / hollow ring / filled square)
3. an **integer** (`OUTTOL 0` or `1`)
4. the colour

Shipping the colour without the other three is a bug, not a simplification.

### Dotted means hypothesis, solid means measurement

Product-wide, no exceptions. A dashed rule, a dashed border and a `3 2` dashed
bone all mean the same thing: *this was inferred, not measured*. A held task's
panel is dashed for exactly this reason.

---

## Tokens

The complete set lives in `app/globals.css`. Two things about it are structural
rather than stylistic:

**Token names never change.** ~20 components read them. A new visual system is a
value remap. This is why four redesigns have not required touching every file.

**The volume scope is mechanical enforcement, not a convention.** Volume inks are
legible on a dark ground and catastrophic on a light one — `--marker` is
**1.26:1** on `--page`. Rather than trusting review, `.volume { }` redefines the
ground and ink tokens, so a component written against `--surface` and `--text`
resolves correctly wherever it is placed, and a volume ink has nothing sensible
to resolve to outside one.

`lib/contrast.test.ts` parses the real stylesheet and crosses **every** ink
against **every** ground it is permitted on. It also asserts that the dangerous
cross-family pairs *stay* dangerous — if someone tunes a volume ink until it
also works on paper, the scoping rule silently becomes decoration, so that is a
test failure on purpose.

This project has shipped a contrast catastrophe twice. Both times a sentence
that sounded like a reason ("it's the brand colour") carried it through review.
The test does not accept sentences.

---

## Type

Two families, each with a jurisdiction, both via `next/font/google`.

- **Archivo** — display, page titles, running prose. Carries a `wdth` axis; the
  nameplate sets expanded and heavy.
- **Martian Mono** — everything else.

### The jurisdiction rule is enforceable, not aspirational

> If a human wrote it as a sentence, it is Archivo. Everything else is mono.

Because the prose face only ever lands on paragraphs, a figure **cannot** leak
into it. That makes *"every verifiable figure is monospace"* a structural
property of the stylesheet rather than a discipline someone has to remember.
Mono therefore carries most visible glyphs: every label, column head, status
word, unit, amount, confidence, address, hash, joint angle and timestamp.

**Martian Mono replaced Azeret Mono for a functional reason, not a stylistic
one.** Azeret has no width axis. A Solana address is 44 base58 characters, and at
375px no fixed-width mono fits one on a line. Martian condenses to `wdth 75`,
which does — so the address stays one selectable, copyable string instead of
wrapping mid-token or hiding behind an ellipsis.

**API note:** do not pass `weight` alongside `axes` (next/font rejects the
combination), and do not list `wght` *in* `axes` (it is filtered out of the
definable set and throws). Both faces expose weight automatically as variable
fonts.

### Precision is a typographic rule

Decimals shown = decimals actually measured. Confidence is an **integer** 0–100
because `lib/verifier.ts` returns an integer; rendering `0.94` asserts precision
the model never reported. Units live on the value (`0.98 USDC`), never in the
label.

---

## Layout

`max-width: 1240px`, 32px gutters (16px under 700px), 8px spacing scale.

**`border-radius: 0` everywhere. No `box-shadow` anywhere.** An instrument is
milled, not moulded: every boundary is a 1px rule, and depth is carried by the
plane change between `--page`, `--surface` and `--raised` rather than by a blur.
This is a deliberate break from the previous mix of 2px/4px/6px/7px, which had
accumulated four values with no rule behind which was used where.

**Nothing rotates except the verdict stamp** (−4deg).

App screens ≥1080px use `88px | minmax(0,1fr) | 296px`:

- **left — the station gutter.** Balloon indices, datum dots, the arm. Never content.
- **centre — the field.**
- **right — the telemetry rail.** Key/value pairs, right-aligned figures.

`minmax(0, 1fr)` is not interchangeable with `1fr`: a bare `1fr` takes its
content's size as an automatic minimum, which is what let a wide child force
horizontal overflow in a previous system.

### `--raised` means committed on-chain

A whiter sheet always means *"this is on the chain"* — sealed clause sets, the
verdict sheet, settled receipts. It is a state, never a decoration.

---

## Motion

**Vanilla `requestAnimationFrame` only.** No three.js, no GSAP, no
framer-motion, no new dependencies. Inline SVG, never canvas — canvas cannot
server-render, and both the reduced-motion frame and the no-JS frame must exist
in the HTML.

> `CLAUDE.md` originally said the landing was "inline SVG + CSS keyframes only".
> That was relaxed deliberately, with the repo owner's approval, because a
> motion-capture rig cannot be driven by keyframes alone. The *dependency* rule
> it was protecting is unchanged and still enforced.

### The easing is the whole point

`lib/rig.ts` implements a **trapezoidal velocity profile**, not a cubic-bezier.
The difference is not decorative:

A bezier scales its **entire curve** with the duration, so a long move and a
short move are the same shape at different speeds. A motion controller does not
work that way — acceleration is bounded by torque, which is a property of the
motor and not of the move — so the ramp lasts the same number of **milliseconds**
however far the axis travels. A long move gets a longer flat **cruise**, not a
lazier curve.

That single property is what the eye reads as *driven* rather than *animated*.
`RAMP_MS = 70`. `lib/rig.test.ts` asserts it directly.

**Overshoot is zero by default.** A springy settle is what an *uncalibrated* axis
does, and would say the opposite of what this product claims. `settle()` exists
and is tested; nothing in the rigs calls it.

**Never animate opacity on a meaning-bearing rig line.** Weight is carried by
dash pattern plus the `--rig-line` / `--rig-solved` colour step. Crossfades
interpolate *colour* between two endpoints that each already clear 3:1, so a
stray alpha fails safe.

### Server-render complete, then rewind

Every rig renders its **terminal state** on the server. The client rewinds to
frame zero in a `setTimeout(…, 0)` *after* mount.

This means the finished document is what exists in the HTML, what a crawler
sees, what renders with JS blocked, and what survives a hydration failure. The
animation is a **rewind of a complete document**, never a build-up toward one.

`prefers-reduced-motion` is checked **before the first frame is scheduled**, so
no rAF work is ever queued, and the still frame is the *same render function* at
the terminal state — never a separate fallback path that can drift.

### The rigs must never lie

This is a product whose pitch is *"pay on proof, not on trust"*, and the rig
readouts sit in the same mono face as figures the user is asked to verify. So:

- `FRAME` is derived from **elapsed milliseconds**, never from rAF tick count —
  a tick counter follows display refresh and would print a lie on a 120Hz screen.
- `RESIDUAL` is the actual RMS marker offset, driven by the same interpolation
  that moves the markers. It is the drawing's own state, not a scripted countdown.
- Deleted for asserting facts that do not exist: `VOL 6.0 × 6.0 × 3.0 m`,
  `RIG 01`, `FEED 12 mm/s`, `PROBE Z`. There is no room and there are no cameras.
- If `solveIK2` reports `clamped`, the arm shows `STATE OUT-OF-ENVELOPE` and
  falls back to the track rail. A rig that admits it cannot reach is in
  character; one that points confidently at nothing is not.

---

## What this must NOT look like

- No Roboto, Poppins, Montserrat, Inter, Space Grotesk, or raw `system-ui`.
- No rounded card grids floating on a light background.
- No purple→blue SaaS gradient hero.
- No glass/blur pills. (`.nav-pill` was the SaaS tell in the previous build.)
- No emoji anywhere in the UI.
- No decorative `01 / 02 / 03` numbering. Numbers are **join keys**: the balloons
  on the skeleton and the columns below share indices, and the test is
  falsifiable — remove the drawing and the numbers stop making sense.
- No dark panel. The plate is the only ground, and the `.volume` scope has zero
  call sites — a bounded black panel anywhere means this system has reverted.
- No second accent colour.

---

## Accessibility floor

Not negotiable, and machine-checked where possible.

- Body text ≥ 4.5:1 against its **actual computed** background; large text and
  graphics ≥ 3:1.
- Touch targets ≥ 44px wherever `(pointer: coarse)` — **gated on pointer type,
  not viewport width.** An iPad in portrait reports `innerWidth: 768` and fell
  outside a 760px breakpoint while being a pure touch device. Width was always a
  proxy for "is this being touched", and a bad one.
- Links inside running prose keep the WCAG 2.5.8 exemption via `.in-prose` — a
  44px slab behind a word in a paragraph overlaps its neighbours and makes taps
  *less* accurate.
- Form fields set at 16px on touch: iOS Safari zooms the page in when a field
  under 16px takes focus, and does not zoom back out.
- Disabled controls keep `--text-faint` and are signalled by a dashed border,
  `cursor: not-allowed` and `aria-disabled` — **never** by fading the label. This
  removes the whole class of disabled-contrast failures instead of arguing the
  1.4.3 exemption.
- Rigs are `role="img"` with an `aria-label` naming the **terminal** state.
  Decorative geometry is `aria-hidden`. Nothing about a verdict is knowable only
  through motion.
