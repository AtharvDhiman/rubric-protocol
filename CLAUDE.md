# Rubric — project brief

Read this entire brief before writing any code. It persists across sessions.

## What Rubric is

Rubric is an escrow protocol on Solana for work that is too subjective for a
deterministic check but still needs trustless payment.

The flow:
1. A poster writes a task with explicit acceptance criteria ("clauses"), funds a
   USDC bounty, and SEALS it. The clause text hash and the money are locked
   on-chain at that moment. Nobody can edit the clauses afterward — not the
   poster, not the platform.
2. A worker (human or AI agent) submits a deliverable.
3. An AI verifier agent reads ONLY the sealed clauses and the submission, and
   returns a structured verdict: approve/reject, a confidence score, and a
   per-clause pass/fail with reasoning.
4. On approval the Solana program releases the escrow to the worker instantly.
   On rejection it refunds the poster. Either way the reasoning is public.

The one-line pitch: "Pay on proof, not on trust."

## Why this design matters (do not "simplify" these away)

- The rubric is committed on-chain BEFORE work starts. This is the core trust
  property: a centralized platform could quietly change the acceptance criteria
  after a worker submits. A PDA cannot. Every design decision must preserve this.
- The AI is not a chatbot bolted onto a payment app. The AI verdict IS the
  authorization to release funds. It is load-bearing.
- Every rejection must cite a specific sealed clause. A rejection that cannot
  cite a clause is a bug.

## Scope discipline

This is a 4-week MVP built by one developer. Reject scope creep aggressively.
NOT in scope: disputes/arbitration UI, multi-verifier consensus, staking,
tokens, reputation marketplaces, mobile apps, i18n, IPFS. Note them as future
work if they come up; do not build them.

## Stack (do not substitute without telling me why)

- Solana program: Anchor (Rust), latest stable. Devnet first, always.
- Web + API: Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel.
  API routes live in the same Next.js app — no separate backend service.
- Wallet: @solana/wallet-adapter (Phantom + Solflare).
- DB: Postgres via Prisma (Supabase free tier). SQLite is fine for local dev.
- Verifier: Anthropic Claude API called from a Next.js server route, using
  structured JSON output.
- Token: USDC SPL (devnet USDC for dev; do not hardcode mainnet addresses).

## Repo layout

```
rubric/
  programs/rubric/        Anchor program (Rust)
  tests/                  Anchor integration tests (TypeScript)
  web/                    Next.js app (frontend + API routes + verifier)
  Anchor.toml
  CLAUDE.md               this brief
```

## How I want you to work with me

- I am NOT an experienced Rust or Anchor developer. I am comfortable with
  Python, TypeScript, React and general full-stack work.
- Because of that: when you write Anchor code, explain every account constraint
  in plain English in comments — especially signer checks, PDA seeds, and
  anything that moves tokens. I need to be able to review it.
- Build in small, reviewable pieces. One instruction handler at a time. Do not
  generate the entire program in one file dump.
- Never run a mainnet deploy. Never put a real private key in a file. If a step
  needs mainnet or a real key, stop and tell me to do it manually.
- After each part, give me a short "what to verify yourself" list.
- If you are unsure about an Anchor API or a Solana version detail, say so and
  check the docs rather than guessing — Anchor's macros change between versions.

## Build plan (parts, in order — each has a STOP checkpoint the user reviews personally)

- **Part 1 (moves real money)** — Anchor program: `Config` + `Task` PDAs, escrow
  ATA owned by the Task PDA, and five instructions built one at a time:
  `initialize_config`, `create_task`, `submit_work`, `submit_verdict`,
  `reclaim_expired`. Non-negotiables: checked arithmetic on all money math;
  escrow ATA derived from the Task PDA, never accepted from the client; custom
  error enum; a plain-English comment above every `#[account(...)]` block;
  `Settled`/`Refunded` are terminal and no instruction may re-enter them.
- **Part 2 (moves real money)** — 14 Anchor integration tests in TypeScript: 5
  happy paths and 9 attack/edge cases that must fail with the *right* error.
  Local validator, mock SPL mint for test USDC. All 14 must pass, run by the user.
- **Part 3** — `web/lib/verifier.ts` exporting `runVerdict(rubric, submission)`.
  Structured JSON output enforced via tool_use + zod. The submission is UNTRUSTED
  DATA wrapped in explicit delimiters; the judge may not invent criteria outside
  the clauses; `approved` only if every clause passes. Parse failure retries once
  then returns `needs_manual_review` — never defaults to approve. Confidence below
  `CONFIDENCE_THRESHOLD` (env, default 70) blocks auto-settle. Regression tests
  include a prompt-injection fixture.
- **Part 4** — Prisma schema, canonical rubric hashing in `web/lib/hash.ts` (the
  SAME function at create time and verify time), and the API routes. The verifier
  keypair loads from `VERIFIER_SECRET_KEY` server-side only and must never reach a
  client bundle; assert its pubkey matches on-chain `config.verifier_authority`.
- **Part 5** — Frontend, design system "The Examiner's Desk" (see below).
- **Part 6 (moves real money)** — Security review checklist, `MAX_BOUNTY` cap
  (~50 USDC), the needs-manual-review UI state, README with a "Known limitations"
  section naming the single-verifier centralization point, and devnet deploy.
  Mainnet deploy is the user's to run.

## Design system (Part 5)

**`web/DESIGN.md` is the authority. Read it before writing any UI.** It is not a
summary of this section - it replaces it.

Rubric has now shipped five visual systems. Earlier drafts of this brief
specified "The Examiner's Desk" (Instrument Serif + Spectral + Caveat, paper
grain, crop marks, rotated elements), then an IBM Plex record-ledger, then a
pure-black direction, then "Fence Line" (a lever-tumbler lock in zinc and
brass). **All of those are dead.** If any stale instruction - including anywhere
above in this file - asks for IBM Plex, Azeret Mono, Instrument Serif, a section
mark as a clause motif, paper texture, a brass fence, a lock drawing, a
left-margin rail, a folio, or an off-straight element, it is out of date.

The current system is **CAPTURE VOLUME**: a light metrology plate carrying one
full-bleed instrument field, on which a rig is visibly measuring something real.
The short version:

- Type is Archivo + Martian Mono via `next/font/google`, and nothing else. The
  jurisdiction rule is enforceable rather than aspirational: **if a human wrote
  it as a sentence it is Archivo, and everything else is mono.** Because the
  prose face only lands on paragraphs, a figure cannot leak into it - which is
  what makes "every verifiable figure is monospace" a structural property of the
  stylesheet instead of something a person has to remember.
- Light instrument-grey plate (`#d8dcda` page / `#edefec` surface), and nothing
  else. **The dark ground is retired.** Every rig draws straight onto the plate
  in remapped inks, `.volume` has zero call sites, and a bounded black panel
  anywhere means this system has reverted. The volume tokens and their scope are
  kept dormant on purpose - `web/lib/contrast.test.ts` crosses them to prove the
  two ink families are still mutually unusable, which is what would make
  reintroducing a viewport a decision rather than an accident.
- Borders, never shadows. **Radius 0 everywhere.** Nothing rotates but the stamp.
- **Acceptable states are achromatic.** A passing clause is ink, not green.
  Colour is spent on one alarm, one held state, and one money-moved event - so a
  green pixel means "the chain paid", never "a check went well".
- Colour is never the only channel. `--negative` against `--positive` is 1.04:1,
  so every status also carries the word, a shape, and an integer.
- Volume-only inks are scoped under `.volume` so the restriction is mechanical.
  `web/lib/contrast.test.ts` parses the real stylesheet and fails the build on
  any pair under its floor.

Screens: `/` landing (the judge oracle drawn on the plate over the full-bleed
field, then how-it-works and the spec + verdict ledger), `/docket` (a real
record table, not cards), `/create` (the tolerance sheet, with a confirmation
modal showing the exact canonical clause text and its hash before sealing),
`/task/[id]` (the verdict sheet with the verdict oracle beside the solve block -
this is the demo).

### Motion (this supersedes the earlier "CSS keyframes only" rule)

The landing was originally specified as "inline SVG + CSS keyframes only". That
was **relaxed deliberately, with my approval**, because a motion-capture rig
cannot be driven by keyframes alone. What changed and what did not:

- **Allowed now:** vanilla `requestAnimationFrame` driving inline SVG attributes.
- **Still forbidden, unchanged:** framer-motion, GSAP, three.js, and any new
  npm dependency. That was the rule the keyframes line existed to protect.
- **The server-rendered frame is always inline SVG.** This started as "never
  canvas", which the rigs no longer honour literally: the live frame is a WebGL
  canvas. The rule it existed to protect is intact and is the one that binds -
  a canvas cannot server-render, so every rig ships an SVG **poster** in the
  HTML and layers the canvas over it. The reduced-motion frame and the no-JS
  frame are that poster, and both still exist in the document.

One rig, in two placements: the **judge oracle** - a wireframe shell with a lit
core - ambient on the landing, and on `/task/[id]` driven by the real verdict,
where a settled matter resolves and turns steadily, a refund arrests and stops
dead, and a held matter drifts and never arrives. The earlier mocap skeleton and
inspection arm are retired. The kinematics and easing live in `web/lib/rig.ts`
and are unit tested.

The easing is the point, and it is not a cubic-bezier. A bezier scales its whole
curve with the duration; a real motion controller has a ramp bounded by torque,
so the ramp lasts the same number of milliseconds however far the axis travels
and a longer move gets a longer flat cruise. That property is what reads as
machinery rather than animation. Overshoot is zero - a springy settle is what an
uncalibrated axis does.

Every rig server-renders its **terminal** state and the client rewinds after
mount, so the finished document is what is in the HTML. `prefers-reduced-motion`
is checked before the first frame is scheduled, and the still frame is the same
render function at the terminal state, never a separate fallback path.

The rigs must never state a fact that is not real. Readouts sit in the same mono
face as figures the user is asked to verify, so invented telemetry (room
dimensions, feed rates, rig serial numbers) is banned outright, and a frame
counter is derived from elapsed milliseconds rather than from rAF ticks.

Every on-chain action still runs through one `<TxFlow>` component with four
explicit states - preparing, awaiting signature, confirming, done - plus
first-class "signature declined" and "not confirmed" failures, and a
cluster-aware Explorer link. Never leave a spinner hanging, and never auto-retry
a transaction that may already have landed. The UI reflects verified on-chain
state, never an optimistic guess.

## Environment notes (as of 2026-08-31)

- Repo root is `D:\Rubric` on Windows 11. Not yet a git repo.
- Installed: Node 22.19, npm 11.6.
- NOT installed: `rustc`/`cargo`, Solana CLI, Anchor CLI. These are required
  before Part 1 can compile or Part 2 can run a local validator.
