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
summary of this section — it replaces it.

An earlier draft of this brief specified a different visual language ("The
Examiner's Desk": Instrument Serif + Spectral + Caveat, feTurbulence paper grain,
crop marks, elements deliberately rotated off-axis). **That direction is dead.**
The current system explicitly forbids decorative and handwriting fonts, faux-paper
texture, and any rotation other than the verdict stamp. If a stale instruction
asks for paper grain, a left-margin rail, a folio, or an off-straight element,
it is out of date — follow `web/DESIGN.md`.

The short version:

- Type is IBM Plex Sans + IBM Plex Mono, and nothing else, via `next/font/google`.
  Every number a person might compare, copy, or verify — amounts, scores,
  addresses, hashes, timestamps — is Plex Mono. That is the most important
  typographic rule in the app.
- Light document-like app surfaces (`#f5f2ea` page / `#fbfaf6` surface); a dark
  landing page (`#0a0a0c`). Borders, never shadows. Radius 2px on inputs and
  buttons, 0 elsewhere. Strict 8px spacing scale.
- Exactly two motifs: the `§` clause mark in `#7c33d6`, and the verdict stamp
  (2px outline, no fill, rotated -4deg, `mix-blend-mode: multiply`). Do not invent
  a third.
- The purple→green gradient appears in exactly two places per screen: the Solana
  mark and the primary button.

Screens: `/` landing (dark, one animated aperture visual, inline SVG + CSS
keyframes only — no framer-motion/GSAP/three.js — and complete with zero motion
under `prefers-reduced-motion`), `/docket` (record list, not cards), `/create`
(rubric drafting + a confirmation modal showing the exact canonical clause text
and its hash before sealing), `/task/[id]` (the verdict sheet — build this first,
it is the demo).

Every on-chain action runs through one `<TxFlow>` component with four explicit
states — preparing → awaiting signature → confirming → done — plus first-class
"signature declined" and "not confirmed" failures, and a cluster-aware Explorer
link. Never leave a spinner hanging, and never auto-retry a transaction that may
already have landed. The UI reflects verified on-chain state, never an optimistic
guess.

## Environment notes (as of 2026-08-31)

- Repo root is `D:\Rubric` on Windows 11. Not yet a git repo.
- Installed: Node 22.19, npm 11.6.
- NOT installed: `rustc`/`cargo`, Solana CLI, Anchor CLI. These are required
  before Part 1 can compile or Part 2 can run a local validator.
