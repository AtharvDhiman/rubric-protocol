# Contributing to Rubric

Thanks for looking. Rubric is an escrow protocol on Solana: acceptance criteria are sealed
on-chain before work starts, an AI judge rules against exactly those criteria, and the program
releases or refunds the escrow. Read the [README](README.md) first, in particular
[Known limitations](README.md#known-limitations).

**Rubric is a beta and the program is unaudited. Do not use real funds with it.** It runs on
Solana devnet, and contributions are developed and tested against devnet or a local validator.

## Security issues

**Do not open a public issue for a vulnerability.** Email
[ayushdhiman.9997@gmail.com](mailto:ayushdhiman.9997@gmail.com) with what you found and how to
reproduce it. Please give a reasonable time to respond before disclosing it elsewhere.

Never commit a keypair, a `.env` file or `VERIFIER_SECRET_KEY`, and never include one in an issue,
a pull request or a log. If you think you committed one, say so straight away so it can be
rotated.

## What is in scope

This is a small MVP. The things below are deliberately **not** being built right now, and a pull
request that adds them is likely to be declined: a disputes or arbitration UI, multi-verifier
consensus, staking, a token, a reputation marketplace, mobile apps, internationalisation and
IPFS. If you have an idea in that space, open an issue to discuss it; it may be recorded as future
work.

Bug fixes, tests, documentation, and anything that makes a claim in the README or the UI more
accurate are always welcome. If you are looking for somewhere to start, look for issues labelled
[`good first issue`](https://github.com/AtharvDhiman/rubric-protocol/labels/good%20first%20issue) and
[`help wanted`](https://github.com/AtharvDhiman/rubric-protocol/labels/help%20wanted).

## Getting set up

The repository has two parts:

```
programs/rubric/   the Anchor program (Rust)
tests/             Anchor integration tests (TypeScript)
web/               the Next.js app: frontend, API routes and the judge
docs/              design notes, the security review, runbooks
```

[Running it locally](README.md#running-it-locally) has the toolchain steps. The Anchor toolchain
is easiest under WSL2 on Windows. You only need the Rust and Anchor toolchain if you are changing
the program; web work needs Node and a local Postgres
([the README](README.md#3-a-database-for-local-development) shows one way to run it).

The web app is a recent Next.js with changes from the versions you may know. Read the relevant
guide in `web/node_modules/next/dist/docs/` before writing code that touches routing or caching.

## Before you open a pull request

Run what applies to your change, and say in the pull request which you ran.

```bash
# The web app (from web/)
npm test            # vitest
npx tsc --noEmit    # types
npm run lint        # eslint
npm run build       # production build

# The program (from the repository root)
npm test            # anchor test --validator legacy
npm run test:grace  # the tests that need the short-grace build
```

Please keep a pull request to **one concern**. A reviewable change is worth more than a large one.

### Tests

Add a test for every behaviour you add or change. For anything that guards money, a check, or a
claim the product makes, prove the test can fail: break the guard on purpose, confirm a test goes
red, then restore it. A test that passed the first time you wrote it has told you little.

### The program

- Explain every account constraint in plain English in a comment above its `#[account(...)]`
  block, especially signer checks, PDA seeds and anything that moves tokens.
- Use checked arithmetic for every money calculation.
- `Settled` and `Refunded` are terminal. No instruction may re-enter them.
- A rejection must cite a specific sealed clause. A rejection that cannot is a bug.
- The escrow account is derived from the task PDA. It is never accepted from the client.
- Never target mainnet, and never put a real key in a file.

### The web app

- [`web/DESIGN.md`](web/DESIGN.md) is the authority for every screen. Read it before changing UI.
  No new dependencies for motion.
- Canonical rubric hashing (`web/lib/hash.ts`) is load-bearing: the same function is used when
  a task is sealed and when it is verified. Do not change it without updating its pinned golden
  digest test and saying why in the pull request.
- Server-only secrets stay under `web/lib/server/`. Nothing there may reach a client bundle.
- Prefer a number that anyone can recompute from the chain over one from our database, and say
  which a figure is.

### Commits and pull requests

- Commit messages follow the history: a short prefix and subject such as `fix(web): ...`,
  `feat: ...` or `docs: ...`, then a body that says *why*.
- In the pull request, say what changed, why, and how you checked it. Say plainly what you did
  not check.

## Be decent

Be respectful and assume good faith. Disagree with the code, not the person. Maintainers may
close or lock a thread that stops being constructive.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
