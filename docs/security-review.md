# Security self-review — `programs/rubric`

**This is a self-review, not an audit.** It was done by reading all 1,388 lines of
the program and running it, by the same side that wrote it. It finds things; it
cannot certify their absence. Get an independent audit before holding meaningful
value (see §7). Companion: [mainnet-checklist.md](mainnet-checklist.md).

Date: 2026-10-22. Anchor 1.1.2, Agave 3.1.10, rustc 1.89.0.

## 1. Verdict

**No finding lets an unprivileged attacker take escrowed user funds.** Every
account that matters is derived or pinned, the state machine really is terminal,
money math is checked, and the one instruction that moves escrow can only be
signed by the verifier. The exposure is elsewhere:

- **Trust roots are keys**, not code: the upgrade authority (R-01) and the
  verifier/admin pair (R-02). Both are concentrated and the per-task cap does not
  bound them.
- **Availability and griefing** with real but bounded cost (R-03 – R-05, R-08):
  one of these (R-04) lets an unprivileged attacker take small amounts of the
  *operator's* SOL — not user funds.
- **A test suite that does not guard the guards** (R-06, R-07): several security
  fixes the source comments call critical have no regression test.

### Severity scale

| | Meaning |
| --- | --- |
| **Critical** | An unprivileged attacker takes escrowed user funds. *None found.* |
| **High** | Loss of funds needs a privileged key, **or** a headline guarantee is only conditionally true. |
| **Medium** | Availability loss, delay of funds, griefing, or a missing guard on a security-critical path. |
| **Low** | Hardening; bounded cost to an attacker; recoverable. |
| **Info** | Accepted trade-off, documentation, or tooling hygiene. |

## 2. Summary

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| R-01 | **High** | The upgrade authority, not the PDA, is the root of trust | Operational — checklist |
| R-02 | **High** | A compromised verifier **or admin** key can redirect every open escrow; the bounty cap bounds one task, not the system | **Mitigated, not removed**: cap now adjustable with a hard ceiling, plus a pause for new tasks. Key custody is launch-plan item 3 |
| R-03 | Medium | `fee_destination` is immutable and USDC is freezable → every approval can be bricked | **Fixed** — `set_fee_destination` |
| R-04 | Medium | Every verdict needs three token accounts, two attacker-owned; the off-chain workaround lets an attacker drain the verifier's SOL | **Demonstrated**; pinned by a characterisation test; structural fix deferred to a design review |
| R-05 | Medium | First signer to `submit_work` owns the task; one shot, no stake, no re-open | Design — launch-plan item 4 |
| R-06 | Medium | 6 reachable guards and the `initialize_config` gate have no test | **Fixed** — tests 20–28, every one mutation-checked |
| R-07 | Medium | The only liveness escape hatch's success path is untested | **Fixed** — `short-grace` test build, tests 36–39 |
| R-08 | Low | Anyone can pre-create an escrow account and block `create_task` for a predictable id | **Fixed** (web): ids carry 24 random bits. The program is unchanged and test 30 still pins it |
| R-09 | Low | `initialize_config` validates nothing about mint/fee destination and `Config` is immutable | **Fixed in tooling** — `mainnet-init-plan.ts` |
| R-10 | Info | `Task` rent (~0.00186 SOL) is never returned | Accepted, documented |
| R-11 | Info | Stale or wrong comments, and hot-key habits in setup tooling | **Fixed** — the program-keypair claim was tested, found false, and corrected everywhere |
| R-12 | Info | The documented test command does not reproduce on a clean checkout | **Fixed** — `Anchor.toml`, README, `npm test` |

---

## 3. Findings

### R-01 — High — The upgrade authority is the real root of trust

**What.** The headline claim is that criteria are fixed because "a PDA has no
private key, so nobody — not us — can rewrite them". That is true of the *PDA*.
It is only true of the *protocol* while nobody can change the program. Every Task
PDA is signed for by this program id, so whoever holds the **upgrade authority**
can deploy new code that signs as any Task and sweeps every escrow, or that edits
sealed hashes.

**Evidence.** `initialize_config` makes the signer prove they are the upgrade
authority (`initialize_config.rs`, `program_data` constraint), and the setup
script loads that key from a JSON file (`web/scripts/init-config.ts`). Today that
is a single hot devnet key.

**Fix.** Not code. Mainnet launches with the upgrade authority held by a
multisig (ideally with a timelock), or made immutable after an audit.
[Checklist Phase 0–3 and 7.] Until then the README and UI should not say "nobody,
not even us" without that qualifier.

### R-02 — High — Key compromise reaches every open escrow

**What.** `MAX_BOUNTY` is described as "the ceiling on what any one task can
lose". That is accurate and easy to over-read. It bounds **one task**. The
aggregate at risk is the cap times the number of open tasks, because:

1. `submit_work` is permissionless — any signer with a USDC account becomes the
   recorded worker of any `Open` task.
2. `submit_verdict` pays the recorded worker whatever the verifier signs.

An attacker holding the verifier key claims every open task as themselves and
approves each one. The **admin** key is equivalent: `set_verifier_authority` lets
it install any verifier, and the admin can never be rotated or revoked.

**Evidence.** `submit_work.rs` (only `Signer` and `state == Open`);
`submit_verdict.rs` (payout goes to `task.worker`); `set_verifier_authority.rs`.

**Fix.** The program cannot detect a rogue-but-valid verifier. Mitigations: a
**low launch cap** and a **kill switch** so exposure is chosen rather than
inherited; admin as a **multisig from day zero** (there is no admin rotation);
key-rotation runbook, balance and anomaly alerts for the verifier (launch-plan
item 3). See §6 for the cap trade-off.

### R-03 — Medium — A frozen or lost fee account bricks every approval

**What.** The approve path transfers the 2% fee to
`fee_destination_token_account`. Mainnet USDC's mint has a freeze authority set
(confirmed read-only on 2026-10-22: freeze authority
`7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar`; owner is the classic Token
program; 6 decimals). SPL Token refuses transfers into a frozen account, so one
freeze reverts every approval. The
worker is not paid and, after deadline + 7 days, the poster reclaims the full
bounty for work that was approved. `fee_destination` is set once and no
instruction changes it, so the only remedy is a redeploy under a new id.

**Evidence.** `submit_verdict.rs` (fee transfer, `fee_destination` pinned to
`config`); `initialize_config.rs` (set once); no setter in `lib.rs`.

**Fix proposed.** An admin-only `set_fee_destination`. No layout change. The
admin can already install a verifier, so this adds little power: it can redirect
at most 10% (`MAX_FEE_BPS`) of future bounties. Pair it with the checklist's
dedicated, multisig-controlled fee wallet.

### R-04 — Medium — Three required accounts, two of them attacker-owned *(demonstrated)*

**What.** Anchor deserialises every account in `SubmitVerdict` before the handler
branches, so **every verdict, approve or reject, requires the worker's, the
creator's and the fee destination's token accounts to exist** — including the
accounts a given branch never touches. Closing your own zero-balance account is
free, so a worker can make even a *rejection* revert.

The off-chain verifier already compensates, and does so correctly: `sendVerdict`
prepends idempotent account creation for all three in the **same transaction**
(`web/lib/server/program.ts`), so there is no window to re-close. The program
comment even names this hazard. I confirmed it works, and confirmed its cost.

**Proof.** `POC-B` (scratch, to be adopted as a characterisation test):

```
rejection WITHOUT the pre-instruction fails: AccountNotInitialized
verifier spent 2039280 lamports; the worker then recovered 2034280
```

The verifier pays the rent to recreate the account; the owner closes it again
afterwards and keeps it. A worker claiming an open task, closing their account,
and closing it again after the verdict nets roughly **one token-account rent per
task at the operator's expense** (less ~5,000 lamports in fees).

*Rent is cluster-dependent, so the figure matters.* The test validator charges the
legacy 6,960 lamports/byte (the 2,039,280 above). **Mainnet today charges 5,080**
(read from `getMinimumBalanceForRentExemption`), so a 165-byte token account is
**1,488,440 lamports ≈ 0.0015 SOL** and that is the number to plan around.

Drain the verifier wallet and every task comes back HELD, which is exactly the
failure launch-plan item 3 describes. A poster can try the same, but they
permanently lose the `Task` rent each time (1,864,360 lamports on mainnet), which
exceeds what they recover, so it does not pay for them; the worker side does.

**Fix.** The structural fix is to require only the accounts each branch uses
(reject needs the creator; approve needs the worker and fee account; neither
needs the other's). That removes the whole class, but it is a rewrite of the one
instruction that moves escrow and changes the client's account lists, so I am
**not** proposing it without a design review and an audit slot. Interim, off-chain
and cheap: cap what the verifier will spend recreating accounts per task and
**hold the task instead** when the bounty does not justify it; alert on verifier
balance. (A frozen worker or creator account cannot be recreated at all; the
grace-period reclaim is the backstop.)

### R-05 — Medium — First signer owns the task, once

**What.** Anyone may call `submit_work` on an `Open` task; the first caller is
recorded as the worker, nobody can displace them, and a rejection sends the task
to terminal `Refunded`. A griefer can claim every open task with junk — cost: one
transaction fee and a USDC account — and the judge will correctly reject each.
Legitimate workers are locked out and posters get a refund but no work. Combined
with R-04 it is *profitable* for the griefer. It is also why a worker gets exactly
one attempt per task.

**Evidence.** `submit_work.rs`; existing test 8 shows the second claimant is
refused, which is the same property seen from the other side.

**Fix.** Needs a design decision, not a patch: poster-designated worker or
allowlist; a worker stake forfeited on junk; or letting a rejected task return to
`Open` until the deadline. It overlaps the dispute/appeal path in launch-plan item
4, so I propose folding it in there rather than building it twice.

### R-06 — Medium — The guards are not guarded

**What.** The suite asserts errors *by name*, which is the right idea, and then
leaves these reachable guards without a test:

| Guard | Why it matters |
| --- | --- |
| `initialize_config` rejects a non-upgrade-authority caller, and a second call | The most heavily commented fix in the program. The suite only calls it as setup, so a regression would pass CI. |
| `FeeTooHigh` | The 10% ceiling is the admin's only bound. |
| `DeadlineInPast`, `DeadlineTooFar` | The clock guards on `create_task`. |
| `MintMismatch` on `create_task` | The constraint that makes `MAX_BOUNTY` mean 50 USDC. |
| `WorkerMismatch` | Stops a payout being redirected. |
| `CreatorMismatch` on `submit_verdict` | Stops a refund being redirected. |
| `FeeDestinationMismatch` | "Fees cannot be diverted, not even by the verifier." |

Three more variants (`EscrowUnderfunded`, `MissingWorker`, `MathOverflow`) are
defensive and unreachable through the public API; fine to leave. Test 14 asserts
failure without naming the error, by design, and checks balances instead.

**Fix proposed.** Backfill the eight tests above. **No program change.**

### R-07 — Medium — The one liveness escape is never exercised

**What.** `reclaim_expired` from `Submitted` after deadline + `VERDICT_GRACE_SECONDS`
is what stops a lost verifier key freezing every escrow. The suite covers its
failure (test 19: too early) but never its success, because the grace period is a
7-day compile-time constant and the validator clock cannot be moved mid-test.

**Fix proposed.** A non-default `short-grace` Cargo feature that shortens the
constant to a few seconds for the test build only, plus one test that reclaims
successfully and one that proves the funds return. The deployed binary and the
tested binary then differ in one constant; the checklist's verifiable build uses
default features, and a guard test asserts the feature is off by default.

### R-08 — Low — Escrow pre-creation blocks `create_task` *(demonstrated)*

**What.** The escrow is `init`ed as an associated token account, which is not
idempotent. Anyone can create the escrow account for a `(creator, task_id)` before
the task exists, and `create_task` then fails. The web app assigns ids as
`latest + 1`, so they are predictable.

**Proof.** `POC-A`: create_task fails; no Task exists; creator funds untouched; the
attacker permanently locks one token-account rent to do it (2,039,280 lamports on
the test validator; **1,488,440 on mainnet today**). The account's owner is a PDA
that does not exist yet, so nobody can ever close it.

**Impact.** Annoyance at a real cost to the attacker; the poster retries with the
next id. **Fix proposed.** Stop issuing predictable ids (random 63-bit id in the
web route) — a one-line, no-risk change. Making the program tolerate a
pre-existing escrow (`init_if_needed`) also works but adds a feature flag and a
subtle surface to the escrow instruction for a low-severity issue.

### R-09 — Low — `Config` is immutable and unvalidated

**What.** `initialize_config` stores whatever it is given: it checks only the fee
ceiling. A wrong mint, a default pubkey or a typo is permanent. In particular
`MAX_BOUNTY` assumes 6 decimals and nothing checks the mint has them.

**Fix.** Guard rails in the setup tooling (§5, P6) and the checklist's explicit
verification steps. A decimals check on-chain would need the mint in the
instruction's accounts; not worth a program change on its own.

### R-10 — Info — `Task` rent is never returned

A `Task` is **239 bytes** (measured by `POC-C`), which at today's mainnet rent is
**1,864,360 lamports ≈ 0.00186 SOL**, paid by the poster and never reclaimed; the
escrow's rent (1,488,440) *is* returned on close. Closing terminal tasks would
reclaim it but would also delete the on-chain commitments (`rubric_hash`,
`submission_hash`, `verdict`) the product exists to publish. Accepted, but it is a
real per-task cost that weighs heavily on a $1 bounty — say so in the launch plan.

### R-11 — Info — Wrong comments and hot-key habits

- `lib.rs`, `Anchor.toml` and the README said losing the **program keypair** means
  you can never upgrade the program. **That was false, and is now corrected.** Tested
  on an isolated local validator: deploy upgradeably with the keypair, delete the
  keypair, upgrade using only the program's public address and the upgrade authority
  — it succeeds (slot 19 → 34) — and an upgrade signed by any other authority is
  refused ("authority does not match"). Upgrades are authorised by the *upgrade
  authority*. The error mattered because it encouraged hoarding copies of a key that
  authorises nothing after deploy, while the key that can take every escrow got less
  attention. The keypair is still needed to deploy the same address to a *new* cluster.
- `constants.rs` calls `MAX_BOUNTY` "the ceiling on what any one task can lose" —
  accurate, but see R-02.
- `web/scripts/init-config.ts` loads the admin from a key file, **defaults the
  mint to devnet USDC and the fee destination to the admin**, and writes the
  verifier secret to the repo root. Unsafe for mainnet; see the checklist.

### R-12 — Info — The documented test command does not reproduce

On a clean copy with anchor-cli 1.1.2: `anchor test` fails at once
(`Failed to spawn surfpool` — Anchor 1.x defaults to it and it is not installed);
`anchor test --validator legacy` then fails in `before all` with `NotAdmin`,
because the test validator deploys the program **immutable** unless `Anchor.toml`
has `[test] upgradeable = true`, which the committed file lacks. With both fixed:
**19/19 pass**. I could not tell how it passed originally. **Fix proposed:** commit
`[test] upgradeable = true` and change the README command.

---

## 4. What I checked and found sound

Each of these was read in the source and, where noted, exercised.

- **`submit_verdict` authority.** `Signer` *and* `config.verifier_authority ==
  verifier.key()`, with `config` re-derived from its seeds. Tested (6).
- **Escrow is derived, never accepted.** (task, mint) ATA in all three
  money-moving instructions. Tested (14).
- **Mint pinned** to `task.mint` / `config.bounty_mint`, so `MAX_BOUNTY` is
  denominated in a known token.
- **Payout and refund destinations pinned**: worker via `task.worker`, creator via
  `has_one`, fee via `config`. Ties to R-06 (not all tested).
- **PDA derivation** uses stored canonical bumps, never caller-supplied.
- **State machine.** Every handler demands an explicit prior state; no handler
  accepts a terminal one. Settled/Refunded are terminal. Tested (7, 8, 13).
- **Deadline boundaries** are consistent: `submit_work` allows `now <= deadline`,
  `reclaim_expired` requires `now > deadline`; no overlap and no gap.
- **Arithmetic.** Fee is multiply-then-divide with checked ops, rounds down so the
  remainder goes to the worker; no overflow path under `MAX_BOUNTY`.
- **Token CPIs** use `transfer_checked` against a typed `Program<Token>`, so a
  counterfeit token program cannot be substituted. The mint is typed against the
  classic Token program, so a Token-2022 mint should be refused at deserialisation;
  I did not test that.
- **Surplus handling.** Donations to an escrow are returned to the creator and the
  account still closes cleanly; it cannot be used to jam settlement.
- **`dup` usage** is sound: amounts are computed before any transfer and nothing
  re-reads a cached balance, so creator/worker/fee overlap cannot double-count.
- **Init race.** Only the upgrade authority can call `initialize_config`, once.
  (The failing runs in §5 show it refusing a signer that is not the upgrade
  authority, but that was an accident of the harness, not a test — R-06.)
- **No re-entrancy surface.** The only CPIs are to the SPL Token, Associated Token
  and System programs.
- **Stack safety.** `SubmitVerdict`'s accounts are boxed, and the build emits **no
  stack warnings** (0 warnings). I did not independently confirm the 776-byte
  overflow figure quoted in the source comment.
- **The join to the judge.** `web/app/api/tasks/[id]/verify/route.ts` re-hashes
  both the sealed rubric and the submission and holds the task on any mismatch
  with the chain before ruling.
- **The verdict path survives closed accounts off-chain** (R-04), in the same
  transaction.

## 5. Evidence

| Check | Result |
| --- | --- |
| `anchor build` (warm) | exit 0, **0 warnings** |
| `cargo clippy` on the program | **no warnings** |
| Existing suite, `--validator legacy`, `[test] upgradeable = true` | **19 / 19 passing** (40 s) |
| …with `[test]` absent | fails in `before all`: `NotAdmin` (R-12) |
| …with `upgradeable = false` | fails in `before all`: `NotAdmin` (R-12) |
| `POC-A` (R-08) | passes: create_task blocked, attacker locks one token-account rent |
| `POC-B` (R-04) | passes: rejection reverts `AccountNotInitialized`; verifier spends one rent, worker recovers it less fees |
| `POC-C` (R-10) | passes: a `Task` is exactly **239 bytes** |
| Rent, read from `getMinimumBalanceForRentExemption` | mainnet **and** devnet today: **5,080 lamports/byte**. The local test validator still charges 6,960, so POC lamport figures (2,039,280) are higher than mainnet's (1,488,440) |

All runs used a **scratch copy** with a throwaway program keypair, a throwaway
wallet, and an isolated Solana CLI config; the repository, the working copy at
`~/rubric`, and every real key were untouched. The proofs exist only in the scratch
copy.

**Not done:** dependency advisory scan (`cargo audit`), fuzzing, formal
verification, a mainnet-fork run, a frozen-account test (needs a second mint with
a freeze authority — the SPL behaviour is standard but unproven here), and review
of the web app beyond the two joins above.

## 6. The bounty cap: what it bounds, and the cost of changing it

*Status: built.* The cap used to be a compile-time constant, `MAX_BOUNTY` (50 USDC).
It now lives in an on-chain `Limits` account that the admin can change — but never
above `ABSOLUTE_MAX_BOUNTY`, a **1,000 USDC** ceiling compiled into the program.
The launch scripts start it at 50 USDC. It is the program's only blast-radius
control, and it controls less than its name suggests.

| | |
| --- | --- |
| **Bounds** | The most any one task can lose. |
| **Does not bound** | Aggregate exposure. That is `cap × open tasks`, and under R-02 an attacker claims them all. Doubling the cap doubles the exposure. |
| **Cost of a low cap** | Throughput of value. At the 50 USDC cap a worker receives at most **$49**, so $100,000 of settled volume is at least **2,041 tasks**; at $5 bounties it is 20,409. Fixed per-task costs (the ~0.00186 SOL `Task` rent, R-10) weigh more the smaller the bounty. |
| **Cost of changing it** | One admin transaction, up to the ceiling. Raising the *ceiling* is still a program upgrade. |

**Why configurable is a trade, not a free improvement.** An admin-settable cap can be
changed in one transaction — useful for a staged ramp-up, and it avoids re-shipping
and re-auditing a binary — but it is one more thing a compromised admin key can turn
up. A constant is changeable only by whoever holds the upgrade authority, which (R-01)
already has total power. The compiled-in ceiling is what bounds that new power: even
a compromised admin cannot make the cap unbounded.

**Why `create_task` requires the account.** If `Limits` were optional, a poster could
get round a lowered cap, or a pause, by leaving it out of the transaction. As a
required account, a deployment without one takes no tasks at all (test 43), and a
look-alike is refused (test 51).

**The pause switch** stops `create_task` and nothing else. `submit_work`,
`submit_verdict` and `reclaim_expired` never read `Limits`, so pausing cannot trap
money already in escrow (test 50 settles, claims and reclaims *while paused*). It
also does **not** stop anyone claiming an existing open task, so against a
compromised verifier the lever that matters is `set_verifier_authority`, not the pause.

Whatever the cap, treat the *sum* of open escrow as the number you actually launch
against, and watch it (a read-only query over `Task` accounts).

## 7. Status of the proposed changes

Everything proposed in the first version of this review was approved and built, each
as its own commit. Every new guard test was **mutation-checked**: the guard it
protects was deleted in an isolated copy, the program rebuilt, and the suite run —
the matching test went red each time. A guard test that has never been seen to fail
proves nothing.

| | Change | Commit | Verified |
| --- | --- | --- | --- |
| **P1** | Test backfill: the missing guards, the `initialize_config` gate, plus `POC-A`/`POC-B` as characterisation tests (R-06) | `4d49ad7` | 8 of 8 mutations caught |
| R-08 | Task ids carry 24 random bits; record numbers stay readable (R-08) | `02ccc18` | 14 unit tests |
| **P2** | `set_fee_destination` (R-03) | `48fc038` | 3 of 3 mutations caught, including an error-code renumbering |
| **P4** | `short-grace` test feature and the grace-period tests (R-07) | `c4dd3e7` | 4 of 4 mutations caught |
| **P3** | `Limits`: configurable bounty cap, hard ceiling, pause switch, and its web client | `e9b7ae3` | 6 of 6 mutations caught; 51 tests pass on the short-grace build |
| **P5** | Tooling and docs: `[test] upgradeable = true` (`4d49ad7`), the README, and correcting the program-keypair claim (this docs commit) | `4d49ad7`, docs commit | the keypair claim was tested, not assumed |
| **P6** | `mainnet-init-plan.ts`, a planner that signs nothing | `e440d1a` | 24 unit tests; dry-run read-only against devnet |

**P3 verification.** Six mutations were run against the new tests: deleting the
admin check on `initialize_limits`, deleting the range check, deleting the pause
check in `create_task`, deleting the cap check, deleting the admin check on the
update instructions, and making `short-grace` a default feature. **All six were
caught.** (The last one also closed a gap from P4: its first attempt failed to apply
because my search string matched a comment as well, so test 36 had gone unproven
until this run.) Two things the run showed are worth knowing. With the range check
deleted, test 41's zero-cap initialisation *succeeds* and poisons the whole suite —
the cascade you would want an unbounded cap to cause. And test 51 cannot tell the
`seeds` constraint on `limits` from Anchor's own discriminator check, since both
reject a look-alike; that constraint is defence in depth rather than something a
test can prove on its own.

**Deliberately not done:** restructuring `submit_verdict` to take only the accounts
each branch needs (R-04), and any change to who may claim a task (R-05). Both are in
the most security-critical path or change the product's rules, and deserve a design
review and an audit slot, not a patch.

### Upgrading the devnet deployment

`create_task` now requires the `Limits` account, so an upgraded program takes no
tasks until the admin has created it. Nothing here was run against devnet. The order
matters, because it decides what a visitor sees while you work:

1. **Deploy the web app first.** Its create page reads `Limits`, finds none, and says
   *"limits not set up, new tasks cannot be sealed"* instead of letting someone sign a
   transaction that will fail. Reading, judging and settling are unaffected.
2. **Upgrade the program.** Build it in **your own working copy** (`~/rubric`), whose
   `target/deploy/rubric-keypair.json` matches `F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz`.
   Do not use a build from anywhere else: a binary whose `declare_id!` differs from
   the address it is deployed to fails every instruction.

   ```bash
   anchor build                       # default features - NEVER --features short-grace
   anchor upgrade target/deploy/rubric.so \
     --program-id F2Uo5JUfGQtho8s9ZbwcpWBd8iJ4XvBqamUaqdjcrRxz \
     --provider.cluster devnet --provider.wallet <devnet upgrade authority keypair>
   ```

3. **Create `Limits` immediately:** `cd web && npx tsx scripts/init-limits.ts --admin <devnet admin keypair>`.
   It refuses mainnet, checks the key really is `Config.admin`, and runs once.
4. Existing tasks and the `Config` are untouched: `Task` is pinned at 239 bytes by
   test 29 and no `Config` field changed.

Rehearse the whole sequence against a throwaway program id first. In particular, re-check
on a real cluster that **upgrading needs only the upgrade authority and not the program
keypair** (R-11 — already shown on a local validator, which uses the same loader).
