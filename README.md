# Rubric

**Pay on proof, not on trust.**

Rubric is an escrow protocol on Solana for work that is too subjective for a
deterministic check but still needs trustless payment.

A poster writes the acceptance criteria as numbered clauses, funds a USDC bounty,
and seals it. The clause hash and the money lock into a program-derived address in
the same transaction. From that moment the criteria are fixed — a PDA has no
private key, so nobody can rewrite them afterwards. Not the poster, not the worker,
not us.

A worker submits. An AI judge reads only the sealed clauses and the submission and
rules on each clause in the open. On approval the program releases the escrow to
the worker minus a 2% fee. On rejection it refunds the poster in full. Either way
the reasoning is public and its hash is on-chain.

---

## Status

| Part | State |
| --- | --- |
| Anchor program (5 instructions + admin rotation) | **Compiles clean** on Anchor 1.1.2 — no warnings |
| 19 integration tests (14 attack cases) | **All 19 pass** against a local validator |
| Judge (`web/lib/verifier.ts`) | Working. 12 guard tests pass; 7 live judge tests are opt-in |
| Canonical hashing | Working. 25 tests pass, including a pinned golden digest |
| API routes + Prisma schema | Written; compile and typecheck clean |
| Frontend (4 screens) | Built. `next build` passes |
| Devnet deploy | Not done — needs the toolchain first |

**Verified by running it:**

- `anchor build` — clean, zero warnings, on anchor-cli 1.1.2 / Solana 3.1.10 / Rust 1.89.0
- `anchor test` — **19/19 passing** against `solana-test-validator`, including all
  14 attack cases
- `next build`, `tsc --noEmit` and `eslint` all clean; 37 web tests pass
- `.next/static` contains no reference to `VERIFIER_SECRET_KEY` or `ANTHROPIC_API_KEY`

**What is still unverified:** the devnet deploy, and the `/task/[id]` screen (it
needs a Postgres connection). The judge's live prompt-injection tests are opt-in
and cost money — run them with `RUN_JUDGE_TESTS=1`.

### The program keypair

`target/deploy/rubric-keypair.json` **is** the program's identity, and it is
gitignored because it is a private key. It currently exists in exactly one place.
Back it up. Losing it means you can never upgrade a program deployed under
`F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz`; you would redeploy at a new
address, and every task PDA would move with it.

---

## Architecture

### What lives on-chain, and why

The chain holds only what has to be tamper-proof:

| Account | Holds |
| --- | --- |
| `Config` (singleton PDA, seeds `[b"config"]`) | admin, verifier authority, bounty mint, fee bps, fee destination |
| `Task` (PDA, seeds `[b"task", creator, task_id]`) | creator, worker, mint, **rubric hash**, submission hash, bounty, deadline, state, verdict |
| Escrow | an associated token account whose **authority is the Task PDA** |

The escrow ATA is derived from the Task PDA by an Anchor constraint. It is never
accepted as an account passed in by the client. That single constraint is what
stops an attacker offering their own token account as "the escrow" and having the
bounty deposited into their wallet.

`Settled` and `Refunded` are terminal. Every instruction requires an explicit prior
state and none accepts a terminal one, so escrow cannot leave a task twice.

A task can also leave `Submitted` without a verdict, but only after the deadline
plus a seven-day grace period. That door exists because anyone may call
`submit_work`, so anyone can push every open task into `Submitted`; without it, a
griefer plus a lost verifier key would freeze every escrow in the protocol
permanently. A verdict takes seconds, so in normal operation it never fires.

### What lives off-chain

Postgres holds the things the chain deliberately does not: the clause prose behind
`rubric_hash`, the submission text behind `submission_hash`, and the verdict
reasoning behind `reasoning_hash`.

**The database is a cache and a content store, never a source of truth about
money.** If it disagrees with the chain, the chain is right. The confirm and verify
routes both re-read the chain before advancing any row, and the verify route
refuses to judge a task whose stored clauses do not hash to what was sealed.

### The flow

```
poster                     server                       chain
  |                          |                            |
  |-- POST /api/tasks ------>| canonicalize + hash        |
  |<-- { taskId, hash } -----| store row as PENDING       |
  |                          |                            |
  |-- create_task (signed by the poster's own wallet) --->| Task PDA + escrow
  |-- POST /confirm -------->| re-read chain, compare hash|
  |                          | mark OPEN                  |
worker                       |                            |
  |-- POST /[id]/submit ---->| store content, return hash |
  |-- submit_work (signed by the worker's own wallet) --->| state = Submitted
  |-- POST /confirm -------->| re-read chain, mark SUBMITTED
                             |                            |
                             |-- runVerdict()             |
                             |-- submit_verdict --------->| pays or refunds
```

The server signs exactly one instruction: `submit_verdict`. Posters and workers
sign their own transactions — the signature is what binds the payout address to
the worker, so the server must not do it for them.

---

## Repo layout

```
programs/rubric/src/
  lib.rs                    program entry, one function per instruction
  state.rs                  Config, Task, TaskState, VerdictRecord
  errors.rs                 every failure mode, named
  constants.rs              seeds, fee ceiling, MAX_BOUNTY, work-window cap
  instructions/             one file per instruction
tests/rubric.ts             19 integration tests
web/
  lib/verifier.ts           the judge
  lib/hash.ts               canonical rubric hashing — load-bearing
  lib/server/               server-only: verifier keypair, Anchor client
  app/api/                  API routes
  app/(app)/                docket, create, task/[id], my-work
  components/               design-system components
  DESIGN.md                 the authority for all UI
```

---

## Running it locally

### 1. Toolchain (Windows → WSL2)

Anchor has **no supported native-Windows build**. Both Anchor's and Solana's docs
say to use WSL2:

> "To develop Solana programs on Windows you **must** use Windows Subsystem for
> Linux (WSL)." — solana.com/docs/intro/installation

In PowerShell **as Administrator**, then reboot:

```powershell
wsl --install
```

Then, inside the Ubuntu terminal:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libudev-dev llvm libclang-dev protobuf-compiler libssl-dev

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
rustup toolchain install 1.89.0
```

Install the **pinned** Solana CLI. Do not use the `stable` URL — that currently
resolves to the Agave 4.x line, which Anchor 1.1.2 is not tested against:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.10/install)"
```

Install Anchor via avm. **Check the org in this URL against
[anchor-lang.com/docs/installation](https://www.anchor-lang.com/docs/installation)
before running it** — the repo moved from `coral-xyz` and `cargo install --git` is
a supply-chain surface:

```bash
cargo install --git https://github.com/otter-sec/anchor avm --force --locked
avm install 1.1.2
avm use 1.1.2
anchor --version    # expect: anchor-cli 1.1.2
```

Node must be installed *inside* WSL; the Windows-side Node does not count:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
nvm install 22
```

**Move the repo into the WSL filesystem** (`~/rubric`), not `/mnt/d/Rubric`.
Building on `/mnt/` is an order of magnitude slower, and `inotify` does not fire
for edits made by Windows applications to files under `/mnt/`, so **Next.js hot
reload will silently not work**.

### 2. Program

```bash
anchor build
anchor keys sync    # rewrites declare_id! and Anchor.toml with the real program id
anchor build        # again, so the id is baked in
anchor test         # runs the 18 integration tests on a local validator
```

### 3. Web

```bash
cd web
npm install
cp .env.example .env.local   # then fill it in
npm run sync:idl             # copies the built IDL out of target/
npm run db:push
npm run db:seed              # optional: demo records so the UI renders
npm run dev
```

The app runs without the program deployed — record pages read from Postgres. Only
the chain-touching actions will report that the IDL or program id is missing.

---

## Known limitations

Read this section before putting real money anywhere near this.

**1. A single verifier key is the centralization point.** One key, held by this
server, is the only account the program accepts a verdict from. Whoever holds it
can approve or reject any submitted task, which means they can direct every
escrowed bounty in the protocol. There is no multisig, no timelock, and no second
opinion. v2 replaces it with multi-agent consensus; until then this is the
protocol's single largest trust assumption and it is not hidden.

Two things bound the damage:
- `MAX_BOUNTY` is 50 USDC. A compromised key cannot drain more than that per task.
- `set_verifier_authority` lets the admin revoke a leaked key in one transaction
  without redeploying.

Neither of these makes it decentralized. They make it survivable.

**2. The program is unaudited and has never been compiled.** See Status above.

**3. The judge can be wrong.** It is a language model reading prose. The confidence
gate (default 70) routes uncertain rulings to a human instead of settling them, and
the code refuses to settle on any internal contradiction — but a confidently wrong
verdict will pay or refund the wrong party. There is no appeal mechanism on-chain.

**4. No dispute or arbitration path.** Out of scope for the MVP. A rejected worker's
only recourse is the public reasoning.

**5. The clock is the validator's.** `Clock::get()` is not a precise wall clock;
deadlines are accurate to within a slot or so, which is fine at hour granularity.

**6. A closed destination token account delays settlement.** `submit_verdict`
requires the worker's, the poster's, and the fee destination's token accounts to
exist, on both the approve and reject paths. If one is closed, the verdict
transaction fails. The verifier recreates any missing account idempotently in the
same transaction, which closes the race — but a determined party could still hold
up their own settlement, and the grace-period reclaim is the backstop.

**7. Dust sent to a settled task's escrow address is unrecoverable.** Once a task
settles, its escrow account is closed and the task is terminal. ATA creation is
permissionless, so anyone can recreate that address and send tokens to it, and no
instruction will ever sign for it again. Do not retry a deposit against a settled
task.

**8. Task ids are sequential per creator, so a specific id can be blocked.** The
escrow uses `init`, which fails if the account already exists. Someone who
predicts `(creator, task_id)` can pre-create the escrow ATA and make that one id
unusable. The cost is theirs (rent per blocked id), the poster simply gets the
next id, and no funds are at risk — but it is a cheap nuisance.

**9. `initialize_config` must be run by the program's upgrade authority.** This is
enforced on-chain, and it is what stops a bystander from front-running the setup
transaction and installing themselves as admin and verifier. The consequence: do
not make the program immutable before initializing the config, or the deployment
is unusable.

**10. Landing-page figures are targets, not measurements.** They are labelled as
such in the UI and live in `web/lib/constants.ts`.

---

## Deploying to devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor build
anchor deploy --provider.cluster devnet
```

Then initialize the config once, **from the wallet that deployed the program** —
the instruction requires the signer to be the program's upgrade authority:

```bash
solana-keygen new --no-bip39-passphrase -o verifier.json
solana-keygen pubkey verifier.json
```

Put that pubkey in `initialize_config`, and the secret key in
`VERIFIER_SECRET_KEY`. **Never commit `verifier.json`** — `.gitignore` already
excludes it.

**Do not deploy to mainnet from this repo's tooling.** That step is yours to run
deliberately, after an audit, and after testing on devnet with a $1 bounty.

### Devnet smoke test

1. Create a task with three clauses and a 1 USDC bounty. Check the confirmation
   modal's hash matches what `/api/tasks` returned.
2. Open `/task/[id]`. Confirm the clause hash on screen matches the `rubric_hash`
   on the Task PDA in Solana Explorer.
3. Submit deliberately non-compliant work. Watch it get REJECTED with a cited
   clause, and the bounty return to the poster.
4. Create another. Submit compliant work. Watch it settle to the worker minus the
   2% fee.
5. Create a third with a short window, let it expire, and reclaim it.

### The 90-second demo

Open a sealed task → submit deliberately non-compliant work → watch it get
REJECTED on-chain with the cited clause → submit compliant work → watch payment
land in under a second.
