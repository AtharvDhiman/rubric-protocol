# Disputes: what exists, what v1 does, and what it does not

Item 4 of the launch plan asked for "a minimal dispute/appeal path", and to propose a
design first if the on-chain change is not small and safe. This is that design. The
short version: **v1 adds a human review queue for HELD tasks and changes nothing
on-chain. Contesting a verdict that has already landed is not possible without a program
change, and this document says what that change would be and why it was not made.**

## 1. The problem, in three cases

| Case | Before this | After v1 |
| --- | --- | --- |
| The judge **rules** and the ruling stands | Settles on-chain at once. | Unchanged. |
| The judge **cannot rule** (unsure, refused, or could not be asked) | The task is HELD. Nobody can decide it. The only exit is the poster reclaiming the bounty a week after the deadline, **even if the work was fine**. | A reviewer can rule on it. |
| The judge **rules wrongly** | Terminal. No remedy. | Unchanged. See §4. |

The first case is the product. The second is where v1 helps. The third cannot be helped
by anything off-chain, and it is the honest limit of this design.

## 2. What the program already enforces (facts, not choices)

- `Settled` and `Refunded` are **terminal**. No instruction re-enters them.
  (`programs/rubric/src/instructions/submit_verdict.rs`)
- `submit_verdict` has **no deadline check**: the verifier can rule on a task after its
  deadline, right up until the poster reclaims it.
- `reclaim_expired` lets the poster take a `Submitted` task back once
  `now > deadline + VERDICT_GRACE_SECONDS` (7 days). That is the program's timeout rule.
  It needs no verdict, and it is why a held task is not stuck forever.

That last rule is the "timeout-refund rule" the brief asks for, and it already exists. v1
does not change it. It makes it visible (the task page states the date) and gives a
reviewer a window to act inside it.

## 3. What v1 does

A **reviewer** is a wallet on an allowlist (`REVIEWER_ADDRESSES`, comma-separated). If the
variable is unset, review is off and every review endpoint says so.

For a task in `HELD`, a reviewer sees the sealed clauses and the submission and records, for
each clause, **pass or fail and a reason**, plus a short summary. They sign that ruling with
their wallet and submit it.

What the server does, in order, and refuses at each step:

1. The review feature is enabled (`REVIEWER_ADDRESSES` is set) and the caller names a wallet
   on the allowlist. Checked **before any signature work**.
2. The ruling is complete: a pass or fail and a reason for **every** clause.
3. The signature is valid, fresh (5 minutes, both directions), and binds **the task, the
   reviewer's address and a hash of the exact ruling**. A signature for one ruling cannot
   be replayed to authorise another, or on another task. This comes **before any chain
   read**, so an unauthenticated caller cannot make the server spend RPC calls.
4. The reviewer is **not the poster or the worker** of this task. A cheap guard that stops
   the accidental and the lazy case; it does not stop one person controlling two wallets,
   and is not claimed to. The allowlist is the real control.
5. The task is `HELD`, and the **chain** says it is still `Submitted`. The stored clauses
   hash to the sealed hash, and the stored submission hashes to the one the worker
   committed on-chain. (Exactly the checks the AI route runs, from the same code in
   `lib/server/judging.ts`: a reviewer rules on what was sealed, never on what is merely in
   the database.)
6. **The outcome is derived, not chosen.** The reviewer marks clauses; `approved` is true
   only if every clause passed, computed by the server through the same
   `applyVerdictGuards` the AI goes through. A rejection must cite a failed clause with a
   reason, or it is refused. A reviewer cannot approve a task with a failing clause, and
   an `approved` field smuggled into the request is ignored.
7. The ruling is published exactly like an AI verdict: the JSON is hashed and the hash
   goes on-chain as `reasoning_hash`. It names the reviewer (`model: "human:<address>"`).
8. It settles through the same `submit_verdict` path, signed by the verifier key.

If settlement fails, the task is left **exactly as it was**. The AI route marks a failed
settlement as an operational hold so the retry script re-runs the judge; doing that to a
task a person was asked to decide would let the script hand it back to the AI. The reviewer
simply submits again. If the chain turns out to have already decided the task (a concurrent
ruling beat this one), the database row is reconciled to the chain instead.

The task page says **"Ruled by a human reviewer, not by the AI judge"** on any such verdict.
That is not decoration. "The AI verdict IS the authorization to release funds" is a
load-bearing claim of this protocol, and a human ruling is an exception to it. The reader
must be able to see which kind of ruling they are looking at.

### What this is, and is not, in trust terms

- The reviewer's wallet **authenticates the request**. It does not sign the on-chain
  verdict. The verifier key still does, so a reviewer is an *off-chain role the operator
  grants*, exactly as trusted as the verifier. **This is not decentralisation.** It is
  operational dispute handling for a single-verifier MVP, and the README's "single
  verifier" limitation applies to it unchanged.
- A reviewer can rule on any `HELD` task that is not their own. There is no assignment and
  no quorum. Those are real gaps, listed in §5.
- Because the reviewer cannot choose the outcome directly and every ruling is public and
  hashed, a bad ruling is visible and attributable. It is not reversible.

## 4. Contesting a verdict that has already landed

This cannot be done off-chain, because the money has already moved. It needs a window
**before** settlement. Three designs, in increasing order of weight:

**A. Off-chain challenge window.** The judge rules, but the server holds the verdict for N
hours before submitting it. Anyone with standing (poster or worker) can contest; a
contested verdict becomes `HELD` and goes to review. *No program change.* But the window is
enforced only by the verifier's own behaviour, not by the chain, and it ends "instant
release", the product's headline.

**B. On-chain propose / finalize.** Two new instructions: the verifier *proposes* a verdict
(recorded, no money moves) and after a challenge period anyone may *finalize* it. A contest
in the window freezes finalisation until review. The chain enforces the window. This
changes the escrow state machine, adds a state and a timer, and touches the most
security-critical path in the program. **It needs its own design, tests with the
mutation-checking this project uses, and an external audit slot.**

**C. Status quo.** Terminal verdicts, public reasoning, and a rubric the poster could have
written better. The README states this as a limitation today.

**Recommendation:** keep C for launch, which is v1. If real disputes appear, build B, not
A: A looks cheap but gives a guarantee only the operator can break, and the whole point of
this protocol is that the operator cannot.

## 5. What v1 does not do

- **No contest of a landed verdict** (§4).
- **No assignment or quorum.** One allowlisted reviewer decides alone. A reviewer is barred
  from tasks their wallet posted or worked on, but nothing stops one person controlling a
  second wallet. Mitigation today: keep the allowlist short and to people you trust, and
  read the public rulings.
- **No notification.** Nothing tells a reviewer a task is waiting. They look at the queue.
- **No timeout on the review itself**, beyond the on-chain reclaim rule. A task a reviewer
  never rules on is reclaimable by the poster after the grace period, whatever its merit.
- **No reviewer reputation, payment or staking.** Out of scope by the project brief.
- **No appeal of a human ruling.**

## 6. The timeout rule, stated plainly

If a held task is not ruled on, then on the date shown on the task page the poster can
reclaim the bounty. This can go against a worker whose work was fine. v1 does not change
that rule (it is compiled into the program and a shorter one would be a program change); it
states it, and gives a reviewer the time before it to act.

## 7. Operating it

See [verifier-runbook.md](verifier-runbook.md#9-reviewers). In short: set
`REVIEWER_ADDRESSES`, keep it small, and treat a reviewer's wallet like a credential that
can release escrow, because through the verifier key it can.
