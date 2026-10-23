# Verifier runbook

Operating the one key the protocol cannot do without. Written for the person who is
on call, possibly at an awkward hour, so the most urgent material comes first.

**The short version.** The verifier is a hot key on the server. It must hold a little
SOL, because every verdict is a transaction it pays for. When that SOL runs out, or
the key stops matching the chain, nothing is *decided* wrongly, but nothing settles:
tasks sit waiting. This document is how you notice, how you fix it, and how you
replace the key without a gap.

| If you see... | Jump to |
| --- | --- |
| The health monitor is alerting | [1. The health check](#1-the-health-check) |
| Tasks sitting in Submitted, or held with "this is not a ruling on the work" | [3. When tasks are stuck](#3-when-tasks-are-stuck) |
| You want to replace the key, on a normal day | [4. Routine rotation](#4-routine-rotation) |
| You think the key has leaked | [5. Emergency: a leaked key](#5-emergency-a-leaked-key) |
| You need to pause, change the cap, or change the fee wallet | [6. The admin multisig](#6-the-admin-multisig) |
| A task is held with "out of API quota", or the judge is rate limited | [2. What the app does](#2-what-the-app-does-when-the-verifier-or-the-judge-cannot-do-their-job) |
| A task is held because the judge was unsure, and you want a person to rule on it | [9. Reviewers](#9-reviewers) |

---

## 0. What you are operating

- **`VERIFIER_SECRET_KEY`** — the private key of the only account the program accepts
  a verdict from (`Config.verifier_authority`). Server-side only; it never reaches a
  client bundle.
- **`VERIFIER_SECRET_KEY_NEXT`** — optional. The key you are rotating *to*. Empty
  except during a rotation.
- **`VERIFIER_MIN_SOL_WARN`** — optional, in SOL. The balance below which the health
  check reports `low`. Default `0.05`. A typo falls back to the default rather than
  silently disabling the warning.

Both key variables accept base58 or a JSON byte array. Neither is ever echoed by an
error message: a bad value says *which variable* is wrong and nothing about its
content.

The judge and the reviewers have their own settings, all optional:

- **`JUDGE_FALLBACK_MODEL`** — a second Gemini model to ask when the first gives **no
  answer** (out of quota, too slow, down). Off unless set. See section 2.
- **`JUDGE_TOTAL_BUDGET_MS`** — the most time one judging run may take, retries and
  fallback included. Default `200000`. The verify route is capped at 300 s.
- **`JUDGE_QUOTA_RETRY_MAX_WAIT_MS`** — the longest rate limit waited out on the same
  model. Default `6000`.
- **`REVIEWER_ADDRESSES`** — comma-separated wallets allowed to rule on held tasks.
  **Unset means human review is off.** See section 9.

A value that is not a positive number falls back to the default rather than switching a
limit off.

**What a verdict costs.** One 5,000-lamport signature in the normal case. The worst
case is a verdict that must recreate the token accounts it needs, because someone
closed them (finding R-04 in `security-review.md`: an attacker controls two of the
three, and the health check budgets for all three to stay on the safe side). That is
the signature plus three token-account rents, about 0.0045 SOL. The health check
reads the real rent from the chain rather than assuming it.

---

## 1. The health check

`GET /api/health/verifier` — not cached, no authentication, and it reveals only the
verifier's **public** key and balance, both already public on-chain.

It returns **200 only when everything is fully healthy** and **503 for everything
else**. That is deliberate: an uptime monitor that alerts on a non-2xx is therefore
also your low-balance alert, and no push integration is needed.

| `level` | Meaning | `canSettle` | What to do |
| --- | --- | --- | --- |
| `ok` | Funded above the warning line, key matches the chain. | yes | Nothing. |
| `low` | Below `VERIFIER_MIN_SOL_WARN` but can still settle. | yes | Top up soon. |
| `critical` | Can pay a normal verdict but not a worst-case one. | **no** | Top up now. Judging is paused. |
| `empty` | Cannot pay even a fee (the rent floor stays locked). | **no** | Top up now. |
| `mismatch` | No key this server holds is the one the chain trusts. | **no** | Topping up does **not** help. Fix the env var, or the rotation. |
| `misconfigured` | The current key works but `VERIFIER_SECRET_KEY_NEXT` is unusable. | yes | Fix it before you rotate. |
| `unreadable` | The chain (or RPC) could not be read. | **no** | Check the RPC endpoint. |

### Set up the monitor (do this before launch)

Any HTTP monitor works (UptimeRobot, BetterStack, a plain cron `curl --fail`).

- URL: `https://<your-host>/api/health/verifier`
- Alert on any non-2xx.
- Interval: 5 minutes is plenty. The wallet drains by thousands of verdicts, not by
  the minute.
- Send the alert somewhere a human will see at night.

**Nothing in this repository sends the alert.** The monitor is external, on purpose:
a check that lives inside the app dies with the app. Until you have set one up, this
protection does not exist.

### Funding it

Send SOL to the verifier's public key (shown by the health check, and by
`solana-keygen pubkey` on the key). Funding needs **no** access to the secret key.

How much: enough that the monitor's `low` alert is a comfortable week away. The
default 0.05 SOL warning line is roughly 10,000 ordinary verdicts, but only about 11
at the budgeted worst case above, so an adversary can drain a thin wallet far
faster than normal traffic would.

---

## 2. What the app does when the verifier or the judge cannot do their job

You should know this, because it is what your users see.

1. **Before spending any judge quota**, the verify route asks the same question the
   health check does. If the verifier cannot settle, it answers `503
   VERIFIER_UNAVAILABLE` and **leaves the task exactly as it was** (still
   Submitted). Nothing is recorded against the work.
2. If the judge runs and the settlement transaction then **fails to land**, the task
   is held with an `[operational]` reason. The task page says plainly *"This is not a
   ruling on the work"*. The escrow is untouched, nobody is paid or refunded, and no
   verdict or decision time is stored — a retry may rule differently, and showing a
   ruling that may not survive would be worse than showing none.
3. If the **judge itself** cannot be asked - out of API quota, too slow, down - it first
   backs off and retries (exponential, with jitter, inside a total time budget), honouring
   a rate limit's own "retry in 145ms". If it still gets no answer, the task is held as an
   operational hold: **no ruling is recorded** (no verdict, no confidence, no decision
   time), the page says it is not a ruling on the work, and `retry-stuck.ts` picks it up.
   A quota error with no short wait is not retried on the same model: there is no point.
4. **Fallback (opt-in).** With `JUDGE_FALLBACK_MODEL` set, a second Gemini model is asked
   when the first gave **no answer**. Free-tier quotas are typically per model, so it often
   has its own. It is asked **only** because of a failure to answer, never because of
   *what the first model said*: a low-confidence ruling, a rejection or a refusal is an
   answer and stands. Asking again until something agrees would be judge-shopping, and the
   tests enforce that it cannot happen. The fallback's ruling goes through the same guards,
   and the published verdict records which model actually ruled. Pick a model you have run
   this prompt on; a weaker one is allowed but is not free of risk.
5. A task held because the judge **looked and was unsure** ("confidence below the
   threshold"), or refused, or kept returning unusable output, is a different thing. It is
   shown differently and is **never** retried automatically: a person is needed, and a
   retry would spend quota to reach the same answer. If the deployment has reviewers, one
   can rule on it (section 9). If not, it waits for the poster's reclaim, below.

A stuck task is a delay, not a payout: nothing has been decided, so nothing moves.
But the delay is not free. If a task is never judged, the poster can `reclaim_expired`
a week after the deadline and **take the bounty back even though the worker did the
work and nobody read it**. That is the real cost of leaving tasks stuck, and the
reason [section 3](#3-when-tasks-are-stuck) exists.

---

## 3. When tasks are stuck

Verification has one trigger: **the worker's own browser tab** calls the verify
route right after submitting. If that call fails, or the tab is closed during a
judge run that can take minutes, **nothing calls it again.** That is the gap this
section closes.

### Retry them

```bash
# Look first. Lists what would be retried and does nothing else (the default).
npx tsx scripts/retry-stuck.ts --base-url https://<your-host>

# Then do it.
npx tsx scripts/retry-stuck.ts --base-url https://<your-host> --run
```

Run it from `web/`. It reads `DATABASE_URL` (and `DATABASE_SCHEMA` if you use one)
from the environment, then `.env.local`, then `.env`, and it prints which database
host it is about to read — **check that line**, because pointing it at the wrong
database is the mistake it can help you catch.

What it does and does not do:

- **Needs no secret key.** It cannot sign. It lists stuck tasks (read-only) and asks
  the deployed app to judge them, exactly as the worker's tab would have.
- **Refuses to start** while the verifier cannot settle, because every judge run
  would be spent and then thrown away. Fix the wallet first.
- **One task at a time**, oldest first, at most `--limit` (default 5) per run, with
  a pause between (`--delay`, default 5 s).
- **Stops itself.** After `--max-failures` failures in a row (default 2), or
  immediately if the server says the verifier cannot settle. It exits non-zero in
  both cases.
- Never touches a task held for a *judgement* reason, a task with no submission, or
  anything already decided. A task younger than `--older-than` minutes (default 5,
  never below 1) is presumed to be mid-judge and is left alone.

**Run one copy at a time.** Two runs at once will judge the same task twice.

### Run it on a schedule (optional)

Nothing schedules it for you; the choice not to use a platform cron was deliberate.
If you want it automatic, run it from any machine that has `DATABASE_URL`, with a
lock so overlapping runs cannot happen:

```cron
*/30 * * * * cd /path/to/rubric/web && flock -n /tmp/rubric-retry.lock npx tsx scripts/retry-stuck.ts --base-url https://<your-host> --run --limit 3
```

A judge call can take up to five minutes, so keep `--limit` times five minutes
comfortably under the interval.

---

## 4. Routine rotation

Replace the key on a normal day (scheduled hygiene, a staff change, a move of host).
The app signs with **whichever configured key the chain currently trusts**, chosen at
the moment of signing, so there is no window in which verdicts bounce.

1. **Generate the new key where it will live.** Never in a repository, a chat, a
   ticket or a screenshot. If a file is unavoidable, create it somewhere temporary,
   load the secret into the host's secret store, then securely delete the file.
   Fund the new key's public address (see [Funding it](#funding-it)).
2. **Stage it.** Set `VERIFIER_SECRET_KEY_NEXT` to the new secret and redeploy.
   Nothing changes yet: the current key still matches the chain.
3. **Check** `GET /api/health/verifier`. It must not report `misconfigured`. A bad
   NEXT key is reported here, loudly, rather than discovered during the rotation.
4. **Plan the on-chain change** (read-only; signs nothing):
   ```bash
   npx tsx scripts/admin-action-plan.ts --rpc <url> --admin <multisig vault> \
     --set-verifier <new public key>
   ```
   It **refuses** if the new wallet cannot pay for verdicts, is not an ordinary
   keypair address, or is the all-zero key. Read every line, then re-run with the
   `--confirm <fingerprint>` it printed to get the single instruction.
5. **The multisig executes it.** The app switches to the new key by itself on its
   next verdict.
6. **Confirm** the health check is `ok` and its watched key is the new one.
7. **Promote.** Move the new secret into `VERIFIER_SECRET_KEY`, clear
   `VERIFIER_SECRET_KEY_NEXT`, redeploy. Retire the old key and sweep its remaining
   SOL.

A task that was mid-judge at the instant of step 5 may fail to settle once. It is held
as an operational hold and `retry-stuck.ts` picks it up.

---

## 5. Emergency: a leaked key

Order matters, and it is **not** the routine order. If an attacker holds the key they
can claim open tasks and approve them (finding R-02), so the on-chain cutoff is
urgent and the app being briefly unable to judge is the right price.

1. **Pause new tasks** so exposure stops growing:
   `scripts/admin-action-plan.ts --admin <vault> --pause`. A pause stops **only**
   `create_task`. It does **not** stop anyone claiming an existing open task or an
   attacker approving one. It buys time; it does not fix the leak.
2. **Rotate on-chain now.** Plan `--set-verifier <new key>` and have the multisig
   execute it. The old key stops working on the next transaction.
   - If `VERIFIER_SECRET_KEY_NEXT` is already deployed with the replacement, the app
     picks up the new key by itself and there is no gap.
   - If it is not, judging is **down** until you deploy the new key. That is correct:
     a task failing to settle is recoverable, a payout to an attacker is not.
3. **Deploy the new key** (`VERIFIER_SECRET_KEY`), fund it, confirm the health check.
4. **Retry what bounced:** `scripts/retry-stuck.ts`.
5. **Review.** Anything the old key signed after the leak began is untrusted: read
   the recent verdicts and the escrow movements on an explorer. Payouts already made
   cannot be recalled.
6. **Reopen** with `--unpause` only when you are satisfied. Before you do, check the
   health check is `ok`.

If the **admin** is what was compromised, there is no on-chain remedy: nothing can
rotate or revoke the admin, and an attacker admin can point the verifier at
themselves. See the next section for why the multisig is therefore non-negotiable.

---

## 6. The admin multisig

### There is nothing to "move"

`Config.admin` is whoever signed `initialize_config`, and **no instruction changes
it**. There is no `set_admin`. So the plan for the admin is not a migration; it is
a decision made once, before launch:

- On mainnet, the **multisig vault is the admin from the first instruction.** The
  upgrade authority must be the same multisig first, because `initialize_config`
  requires its signer to *be* the upgrade authority. `scripts/mainnet-init-plan.ts`
  and `docs/mainnet-checklist.md` Phase 3 walk through it.
- The **devnet** deployment keeps its file-key admin forever. It is not a place for
  real money and nothing here changes that.

`propose_admin` / `accept_admin` (a two-step rotation) was considered and **not
built**: it is more program surface to audit, and a multisig at the start makes it
unnecessary. It is the thing to add if the point below ever bites.

**Check this before you pick a multisig product:** membership and threshold changes
are made *inside* the multisig. Confirm that the vault address recorded as
`Config.admin` **survives** those changes. If it does not, the admin is stranded on
the old address, and there is no instruction that can repair that.

### Using it

Each admin lever is one small instruction. `scripts/admin-action-plan.ts` checks the
proposal against the chain *before* it reaches the signers, and signs nothing, reads
no key file and never prints your RPC URL:

| Lever | Flag | The check that matters |
| --- | --- | --- |
| Stop new tasks | `--pause` | Existing escrow is unaffected, and it says so. |
| Reopen | `--unpause` | Reminds you to confirm the cause is resolved. |
| Bounty cap | `--set-max-bounty <usdc>` | Whole USDC, within the compiled-in 1,000 USDC ceiling; warns on a raise. |
| Fee wallet | `--set-fee-destination <wallet>` | Not the all-zero key; warns if it has no USDC account yet. |
| Verifier | `--set-verifier <pubkey>` | **Refuses an unfunded, non-keypair or all-zero target.** |

Every plan first confirms the admin you passed *is* `Config.admin` on-chain, because
each instruction is `has_one = admin` and a proposal from anyone else reverts after
the signers have already spent their time on it.

The flow is two runs. The first prints the checks and a fingerprint; the second, with
`--confirm <fingerprint>`, prints the unsigned instruction (program id, account list,
and data in hex and base64) to paste into your multisig's custom-instruction builder.

**Rehearse the pause and a rotation as multisig transactions before launch**, so the
first time is not during an incident.

---

## 7. Quick reference

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Monitor alerting, `low` | Balance under the warning line | Top up. |
| Monitor alerting, `empty` / `critical` | Wallet cannot pay | Top up, then `retry-stuck.ts`. |
| Monitor alerting, `mismatch` | Env key is not the chain's verifier | Correct `VERIFIER_SECRET_KEY`, or finish the rotation. Topping up will not help. |
| Monitor alerting, `misconfigured` | Bad `VERIFIER_SECRET_KEY_NEXT` | Fix or clear it. |
| Monitor alerting, `unreadable` | RPC down or rate-limited | Check the RPC endpoint. |
| Task stuck in Submitted | Worker's tab never finished the call | `retry-stuck.ts`. |
| Task held, "not a ruling on the work" | Settlement did not land | Fix the cause (usually the wallet), then `retry-stuck.ts`. |
| Task held, "out of API quota" or "could not be reached" | The judge could not be asked | Wait for quota, or set `JUDGE_FALLBACK_MODEL`; then `retry-stuck.ts`. No ruling was recorded. |
| Task held, confidence below threshold | The judge was unsure | Not retried automatically. A reviewer can rule on it (section 9); otherwise it waits for the reclaim date. |
| A reviewer's ruling returns 502 | Settlement did not land | The task is unchanged. Check the verifier health, then submit the ruling again. |
| Every approval reverts | Fee account frozen | `--set-fee-destination` to a clean wallet. |
| Key leaked | — | Section 5, in that order. |

## 8. Before launch

- ☐ External monitor on `/api/health/verifier`, alerting a human.
- ☐ The verifier wallet funded to well above the warning line, and a named person
  responsible for topping it up.
- ☐ `retry-stuck.ts` run once in dry-run mode against production, and its database
  host line read.
- ☐ A rotation rehearsed. There is **no devnet executor** for the admin levers (the
  devnet admin is a file key), so on devnet you can rehearse the app side (stage
  `VERIFIER_SECRET_KEY_NEXT`, read the health check) and the planner, which runs
  against devnet exactly as it does against mainnet. The on-chain execution can only
  be rehearsed through your multisig, on a deployment it controls.
- ☐ The pause and a rotation rehearsed as multisig transactions.
- ☐ Confirmed that the multisig's vault address survives membership changes.
- ☐ Decided whether human review is on. If it is, `REVIEWER_ADDRESSES` holds a few people
  you trust, none of whom post or work tasks, and each knows their wallet can release
  escrow. If it is not, `REVIEWER_ADDRESSES` is unset and held tasks wait for the reclaim
  date.
- ☐ If a fallback model is configured, it has been run against this prompt, and its first
  few rulings have been read.

## 9. Reviewers

Read [dispute-design.md](dispute-design.md) first. In one paragraph: a **reviewer** is a
wallet that may rule on a *held* task. They mark each sealed clause pass or fail with a
reason, and the outcome follows, so they cannot approve a task with a failing clause or
reject one without citing it. They sign with their wallet to prove who they are, and the
server's **verifier key** signs the on-chain verdict. A reviewer is therefore exactly as
trusted as the verifier: **treat a reviewer's wallet as a credential that can release
escrow**, because through the verifier key it can.

### Turning it on

Set `REVIEWER_ADDRESSES` to a comma-separated list of wallet addresses and redeploy. Unset
or empty, and every review endpoint says review is not enabled. An entry that is not a valid
address is logged (as a count) and ignored, never guessed at, so a typo can only *remove* a
reviewer.

Choose few, and choose people who neither post nor work tasks. A reviewer is barred from a
task their own wallet posted or worked on, but nothing stops one person controlling a second
wallet, so this is a guard against accidents and not against bad faith.

### What a reviewer does

1. Connect the reviewer wallet. On a held task's page a **Review this held task** panel
   appears; for anyone else it does not.
2. `/review` lists every held task, soonest-reclaimable first. That date is the one to race:
   after it, the poster can take the bounty back whatever the merit of the work.
3. For each clause, choose *Passes* or *Fails* and give a reason. Add a summary. The panel
   states what the ruling will do (approve and pay the worker, or reject and refund the
   poster) before you sign.
4. Sign the message. It moves none of your own funds. The ruling is published with your
   wallet address and its hash goes on-chain.

A ruling is **final**: `Settled` and `Refunded` are terminal in the program.

### If something looks wrong

| Symptom | Meaning |
| --- | --- |
| The panel does not appear | The connected wallet is not on `REVIEWER_ADDRESSES`, or review is off. |
| "A reviewer cannot rule on a task they posted or worked on" | The wallet is the poster or the worker. Use another reviewer. |
| "Only a held task can be ruled on here" | It is not held: it was decided, or is still being judged. |
| 502, "nothing was recorded" | Settlement did not land. The task is **unchanged**; check `/api/health/verifier` and submit again. |
| "Could not confirm whether the ruling was recorded" | The request was sent and no answer came back. **Do not resubmit blindly**: refresh and read the task first. A repeat is refused if the ruling landed. |
| "Sealed clause mismatch" or "Submission mismatch" | The database no longer matches what was sealed on-chain. The task is held and **nobody** may rule on it until a person has investigated. |

### What this does not give you

No assignment, no quorum, no appeal of a human ruling, and no way to contest a verdict that
has already landed. There is no notification either: nothing tells a reviewer a task is
waiting, and nothing alerts you if tasks sit held. `/review` is the worklist; someone has to
look at it. See [dispute-design.md](dispute-design.md#5-what-v1-does-not-do).
