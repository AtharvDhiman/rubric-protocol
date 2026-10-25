# Launch plan

**Nothing here has been run on mainnet. Every mainnet step is yours to run**, as
commands to read first. Per `CLAUDE.md`, no assistant deploys to mainnet or touches a real
key.

This plan has three jobs: pick a niche, soft-launch on mainnet with $1–5 bounties, and find
2–3 real repeat customers. It also says how to report the result without overstating it,
because a traction number that cannot survive one question is worse than none.

How to read it. Where a fact comes from this repository, it says so. Where it comes from the
web, it has a link in [Sources](#sources), and where I could not confirm something, the text
says **not confirmed** rather than filling the gap. Numbers marked **proposal** are my
starting values with the reasoning beside them; change them, but write the new numbers down
*before* launch, not after the data arrives.

Related: [mainnet-checklist.md](mainnet-checklist.md) (the steps this plan sits on top of),
[security-review.md](security-review.md), [verifier-runbook.md](verifier-runbook.md).

---

## 0. The decision underneath all of it

The README says, in so many words, **"Do not put real money on this."** The program is
unaudited, one hot key is the only account that can rule on a task, and a verdict that has
landed cannot be contested. A soft launch on mainnet is a decision to accept those with
open eyes, with small enough numbers that being wrong is cheap. It is yours to make, and the
plan below only makes sense if you have made it deliberately (checklist item D5: the audit
status you will state publicly).

What the soft launch does **not** claim: that the protocol is safe, audited, or decentralised.
What it tests: whether anyone outside the team will post a second task.

Gates before Stage 0, all from the checklist: Phases 0–4 done, the mainnet banner showing, the
external monitor on `GET /api/health/verifier` proven to page a human, no sample rows in the
production database, and a domain of your own moved to at least two weeks before launch.
One more gate comes from this plan: **every wallet you control is listed in `TEAM_WALLETS` on
the production deployment** ([section 6](#declaring-the-teams-wallets)).

---

## 1. The niche

**Recommendation: small, repeatable, text-verifiable bounties for crypto communities and DAOs
that already pay contributors by hand.**

Examples of what a community posts again and again: translating a docs page, writing a
how-to or explainer, summarising a call, writing a bug report with reproduction steps,
transcribing or labelling a batch of items and reporting the counts.

### Why this and not "hackathon payouts"

Your brief suggested "bounty/hackathon payouts for DAOs and communities". I would take the
bounty half and leave the hackathon half for now. The reasons come from the product, not from
taste:

| Constraint (from this repo) | What it rules out |
| --- | --- |
| The judge reads **the sealed clauses and the pasted submission, and nothing else**. It cannot open a link or a file ([README](../README.md#if-you-are-doing-the-work)). | Judging a repository, a demo, a design or a video. Those are most of what a hackathon judges. |
| Up to **8 clauses of 280 characters** each, a 120-character title (`web/lib/hash.ts`). | Long, discretionary scoring rubrics. |
| The cap is **whole USDC, set by the admin**, launched at $1–5 here. | Hackathon prizes, which are usually far larger. |
| A held or contested ruling cannot be appealed on-chain once it lands. | Anything where the sponsor wants to keep discretion over the result. |
| Hackathons are one-off events. | The **repeat** customer your brief asks for. |

A community that posts "translate this page" every week is a repeat customer. A hackathon
organiser is a one-time one.

### What the judge can and cannot check

Rubric checks that a submission meets **stated properties you can observe in the text**. It
cannot check that a claim is true about the world. "Contains a numbered list of reproduction
steps" is checkable; "the bug is real" is not. "Includes the original paragraph quoted above
each translated paragraph" is checkable; "the translation is idiomatic" is a taste the judge
may rule on but a poster should not rely on.

The consequence for how customers write tasks: **a clause that depends on material the judge
cannot see cannot be checked.** The fix is to make the worker paste the evidence into the
submission. Three illustrative clause sets (templates, not real tasks):

*Translate a docs page into Spanish*
1. The submission quotes each English paragraph, then gives its Spanish translation directly below it.
2. Every paragraph of the original appears; none is skipped or merged.
3. Product names, code snippets and commands are left in English and unchanged.

*Report a bug*
1. The submission lists numbered steps that reproduce the problem from a clean start.
2. It states what was expected and what happened instead.
3. It quotes the exact error text or output.
4. It names the version and environment.

*Label a batch*
1. The submission lists every item with the label it was given.
2. Items that could not be labelled are listed separately with a reason, not guessed at.
3. It ends with the total count labelled and the total count excluded.

### Is this a real pain? Not established.

I looked for evidence that communities lose time or trust on slow, manual bounty payouts, and
what I found is **anecdotal and mostly dated**: a contributor discussion describing a DAO
payout process that took one to two weeks to claim, an Arbitrum forum thread about grant
winners and payout delays, and a community post claiming Bountysource stopped paying
([Sources](#sources)). A vendor report says over 80% of contributor payments in large DAOs
now run through smart contracts, which, if true, means *the payment step* is already
automated and the unsolved part is the **decision** to pay. I found no 2026 data on how long
manual review takes. So treat "manual review is the bottleneck" as the hypothesis the first
conversations with customers must confirm or kill, not as a fact to put in a pitch.

---

## 2. What already exists, and where Rubric differs

I did not find a tool that combines **criteria sealed on-chain before work starts, an
automated verdict, and automatic release of escrow on Solana**. I did not search exhaustively,
so do not say "first" or "only". Say the properties.

| Tool | What it is | How a winner is decided and paid | Where Rubric differs | Where Rubric is weaker |
| --- | --- | --- | --- | --- |
| **Superteam Earn** | Solana-ecosystem bounty and gig board. Its own page says it also lists "agent-eligible listings" for AI agents. | Bounties are open competitions anyone can join; a sponsor chooses. **Payout mechanics not confirmed**: the FAQ is a JavaScript page I could not read. | The sponsor does not have to review, and cannot change the criteria after submissions arrive. | Earn has the audience (its own page says 240,000+ talent), listings and a track record. Rubric has none. |
| **Dework** | DAO task boards with bounties, Discord and GitHub sync, and batch payment through a Gnosis Safe. | A project lead assigns tasks and pays through it (per its homepage); how completion is approved is not stated there. **Current status not confirmed**: one directory lists it "Acquired" with no date, another "Alive", and its homepage shows no notice. | No human approval step, and no trust that the DAO will pay. | Much richer project management. Do not assume it is still operating; check before you position against it. |
| **Algora** | Bounties on GitHub issues. | Paid after the linked pull request is merged, by the maintainer's review. Fees are reported as **9% or 11%** by different pages; my fetch of its pricing page returned a 404, so **not confirmed**. | Not tied to code, and the fee is 2%, fixed in the program. | Algora is purpose-built for code review and merging, which Rubric cannot judge. |
| **Quest platforms** (Zealy, Galxe, Layer3) | Community campaigns with points and rewards. | Mostly deterministic checks of on-chain or social actions. I found **third-party guides only, not official docs**; treat the details as indicative. | Rubric judges free-text work against criteria the poster wrote. | They verify huge numbers of simple actions cheaply; Rubric does not compete there. |
| **Kleros Escrow** | Escrow with dispute resolution by staked jurors. Which chains it runs on I did not confirm. | Funds are held until a dispute is ruled by jurors (docs.kleros.io). **Cost and timescale not confirmed.** | An automated verdict in seconds, on Solana, and no dispute to start. | Kleros is the more decentralised answer to "who decides". Rubric's verifier is one key. |
| **GenLayer** | A network whose validators each run a different model and reach consensus on subjective questions. Its site lists **mainnet on the roadmap for Q4 2026** and describes the validator set as permissioned to begin with. | Built as an adjudication layer; its site gives escrow release as an example use case. | Rubric exists today, on Solana, with a narrow job. | GenLayer's multi-model consensus is exactly the thing Rubric's v2 is meant to approach. If it launches, it is the closest comparison. |

**The honest competitive line:** the sponsor does not have to review, the worker does not have
to trust the sponsor to pay, and the rules cannot move once work begins. It is weaker than
every tool above on audience, on decentralisation (one verifier key), and on the range of work
it can judge.

---

## 3. Soft launch: $1 to $5 on mainnet

### The arithmetic that sizes everything

From the checklist and `docs/security-review.md` (R-02): the cap bounds **one task, not the
total.** Anyone may claim any open task, so a compromised verifier key could reach
**cap × number of open tasks**. Size the launch around that sum, not the per-task number.

| Stage | Cap | Open tasks at once (**proposal**) | Worst-case escrow at risk |
| --- | --- | --- | --- |
| 0. Canary | $1 | 3 | $3 |
| 1. Pilot | $1 | 10 | $10 |
| 2. Ramp | $5 | 10 | $50 |

The open-task limit is not enforced on-chain; it is a rule you hold yourself, by how many
customers you let in at once. The cap is enforced on-chain. The program can never raise it
above 1,000 USDC, and **I would not go above $5 until an external audit has happened and the
verifier is no longer a single key** (the comment in `programs/rubric/src/constants.rs` says
the same).

### Costs to expect (and measure, not guess)

- **The fee is 2% and cannot be waived**: $0.02 on a $1 task. This is not a revenue plan.
- **The verifier pays network fees**, and **when a worker or poster has no USDC token
  account, the verifier creates it and pays its rent** (`ataPreInstructions` in
  `web/lib/server/program.ts`). For a $1 task that rent is likely to exceed the task's entire
  $0.02 fee, and a first-time worker triggers it (the exact comparison depends on the SOL price). I have not measured it on mainnet. Run
  `solana rent 165 --url mainnet-beta` for today's figure, and record the real per-verdict
  cost during Stage 0.
- **The judge's free tier is rate limited.** A busy pilot day can hold tasks as "not a
  ruling". `scripts/retry-stuck.ts` judges them again; nothing runs it for you.

### Stage 0 — Canary (you fund every task; about a day)

This is checklist Phase 5, run as a set of experiments with the outcome written down.

1. Set the cap to **$1** at initialisation: `--max-bounty 1` on `mainnet-init-plan.ts`.
2. With a fresh wallet holding real USDC, create **$1 tasks** and run all three endings from
   a second wallet: one **settled** (confirm the payout and the 2% fee land where expected),
   one **rejected** (confirm the full refund), one with a short deadline and no submission
   (confirm `reclaim_expired` returns it).
3. Record: the verifier's SOL spent per verdict, the token-account rent paid, and how long a
   verdict took.
4. Make the monitor fire once for real (checklist Phase 5).

**Exit:** all three endings observed on mainnet, costs written down, the alert proven.
These tasks are team-funded, so the wallets that post and work them must already be in
`TEAM_WALLETS`: the report then sets them aside, and they **must never appear in a traction
claim.**

### Stage 1 — Pilot at $1 (about 2–3 weeks)

Invite one or two communities (section 4). Each posts real small tasks from **its own wallet
with its own money**.

**Exit to Stage 2 (proposal):**
- at least **15 tasks reached a final state** (settled or rejected), which is a small but
  usable sample of how the judge behaves on real work;
- **a person read every rejection and every held task** and recorded whether the ruling was
  right;
- no unresolved report of a wrong payout, no task stuck past what `retry-stuck` can clear,
  and the verifier wallet never below its warning line.

### Stage 2 — Ramp to $5 (about 4–6 weeks)

Raise the cap through the multisig. This is the lever; nothing here runs it:

```bash
cd web
# 1. Look. Prints every check, what the action does, and a fingerprint.
npx tsx scripts/admin-action-plan.ts --rpc <paid mainnet rpc> --admin <MULTISIG_VAULT> --set-max-bounty 5

# 2. Having read it, confirm with the fingerprint to get the instruction for the signers.
npx tsx scripts/admin-action-plan.ts --rpc <paid mainnet rpc> --admin <MULTISIG_VAULT> --set-max-bounty 5 --confirm <fingerprint>
```

The pause, if you ever need it, is the same script with `--pause`. It stops **new** tasks
only and cannot trap escrow already held ([mainnet-checklist.md](mainnet-checklist.md#the-limits-account)).
Rehearse it before launch.

**Hold at $5.** Everything beyond it waits for the audit.

### Decide now: what happens when the judge is wrong?

At these sizes you will hit it. A confidently wrong verdict pays or refunds the wrong party
and **cannot be undone on-chain**. Decide before launch whether you will make that person
whole from team funds. At $1–5 it is cheap and it protects the pilot, but it must be
**described as a team payment, never as something the protocol does**, and it must be counted
in the traction report as team-funded, which means the wallet that pays is in `TEAM_WALLETS`
too.

### What participants are told

Put this in front of every poster and worker before their first task. Plain words, no
reassurance beyond what is true:

> Rubric is a beta on Solana mainnet with real USDC. The program has not been audited. One
> server key decides every verdict, and a verdict cannot be appealed once it lands. Bounties
> are capped at $[cap]. Only post or work on a task you would be fine losing.

---

## 4. Finding and keeping 2–3 repeat customers

### What a repeat customer is

Defined so the chain can confirm it, not so it sounds good: **a wallet that is not
team-controlled and has at least 2 tasks settled.** That is exactly the "had more than one
settled" figure `scripts/traction-report.ts` prints for posters, so it is recomputable by
anyone. I would also want those tasks to fall in at least two different weeks (one burst on
one day is a trial, not a habit), but the report does not break that down per poster. Check
it in the Task accounts, or ask the customer.

### The profile

A crypto community or DAO that, on a recurring basis (**not** once per event):

- posts small tasks whose result is **text** (section 1);
- currently reviews each one by hand, or pays contributors from a multisig on request;
- has one person who owns the contributor program and can decide without a vote;
- holds USDC on Solana already.

### Where to look

I did not name companies, because I have not spoken to any and I will not invent a list.
These are methods:

1. **Public bounty boards.** Look for a sponsor that has posted the **same kind of small task
   at least three times in the last quarter**. That sponsor has the repeat need. (I could not
   browse Superteam Earn's listings in this session, so this is a method for you to run, not a
   result.)
2. **Communities with a standing contributor programme**: translation, documentation,
   content or QA. Their public contributor or bounty channels show how often they post and how
   they pay.
3. **Your own network first.** The first conversation is easier with someone who will tell you
   the truth about why it would not work.

### What to offer

Offer what the product can actually deliver. **Do not offer to fund their bounties**: a
bounty you pay for is team-funded demand, and it will not count.

- **A rubric clinic.** You write their first three task rubrics *with* them, and check each
  clause against "can the judge see this in the submission?" This is where most of the value
  is, because a vague clause is a vague ruling.
- **A rehearsal on devnet first.** Ask for three real past submissions and run your draft
  clauses against them on the devnet deployment before any money is at stake.
- **Same-day support** during their first weeks, and a person reading every held ruling.
- **Honesty about the limits**, in the words above. A customer who learns about the single
  verifier key from you is a customer; one who learns it from someone else is not.

What you ask in return: three real tasks over four weeks, from their own wallet and their own
USDC, a short call after each, and, only if they agree, permission to cite them.

### Likely objections, and the true answers

| They say | The true answer |
| --- | --- |
| "Who audited it?" | Nobody yet. The program is unaudited, which is why the cap is $1–5. |
| "Who decides if the judge is wrong?" | Nobody can reverse a verdict that has landed. Held rulings go to a human; a landed one stands. Say what you will do instead (the team-payment decision above). |
| "What if your server goes down?" | Tasks wait. After the deadline plus 7 days the poster can reclaim in full, whatever the merit of the work. |
| "Why not just pay people ourselves?" | You can. The case for Rubric is that the sponsor stops reviewing and the worker stops depending on the sponsor's mood. If that is not a pain for them, believe them. |
| "Does it handle our design/code/video bounties?" | No. The judge reads pasted text only. |

### Tracking

Keep this table privately and fill it in as you go. It is empty on purpose.

| Customer | Wallet(s) declared | Tasks posted | Settled | Weeks active | Would they post again? (their words) | Problems |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Publish a wallet only with permission, and publish your **own** wallets always (next section).

---

## 5. Success, stop and kill criteria

Set these **before** Stage 1. All numbers are **proposals**.

**Success at the end of Stage 2:**
- at least **3 independent posters** (wallets that are not yours), and at least **2 of them
  repeat customers** as defined in section 4 (two or more settled tasks);
- at least **30 independent tasks in a final state**, from at least **10 different workers**;
- every rejection and every hold has been read by a person, and the number of **wrong
  rulings is reported with its denominator** ("1 of 30"), not as a percentage alone.

**Stop the line, at any time:** any loss of funds, or any payout or refund to the wrong party
caused by a bug in the program or the verifier. Pause new tasks
(`admin-action-plan.ts ... --pause`), follow [verifier-runbook.md](verifier-runbook.md), and
tell participants what happened.

**Kill or rethink:** if after six weeks of active outreach **fewer than two posters from
outside your own network have posted a second task**, do not expand. Talk to the posters who
did not come back and to the ones who never started. The hypothesis in section 1 may be
wrong, and the cheapest time to find out is now.

What the chain **cannot** tell you, and the database can (so it is a claim, not a recomputable
figure): how many tasks were **held**, how often a human reviewer overrode the judge, and how
long verdicts took. The chain stores when a verdict landed, not when work was submitted.

---

## 6. Reporting traction honestly

The tooling exists: the `/stats` page, `GET /api/stats`, and
`web/scripts/traction-report.ts`. All three compute from the program's Task accounts, show
the cluster, the program id and the slot, and print the caveats. Anyone can recompute them.

```bash
cd web
npx tsx scripts/traction-report.ts --rpc <paid mainnet rpc>
```

**What to put in the bounty submission** (fill in from a real run; this is a shape, not a
result):

> Between [date] and [date], on Solana mainnet, [N] wallets that are not controlled by the
> team posted [M] tasks, and [K] settled for [X] USDC in total. [R] of those wallets posted
> more than once. Program [id], read at slot [S]. Every figure is recomputable with
> `web/scripts/traction-report.ts`. [T] further tasks were funded by the team and are
> excluded. The program is unaudited and bounties were capped at $[cap].

**Do not:**
- quote **any devnet figure** as traction. The page and the script both head it TEST NETWORK
  for exactly this reason;
- say "users" for wallets. One person can hold many wallets, and the report says so;
- quote volume as demand. The 2% fee goes to a wallet you control, so volume costs only
  network fees to fabricate. That is true of everyone's volume, which is why the number of
  independent repeat posters is the figure to lead with;
- quote an approval rate without how many decisions it rests on (the page prints, for
  example, "100.0% of 1 decided", on purpose);
- put the weekly series in the story if it is two points.

### Declaring the team's wallets

"Independent" is only as good as the list of wallets that are **not** independent. The report
always sets aside a task where **one wallet** both posted and worked it. It sets aside a task
where a **declared team wallet** posted or worked it too, but it cannot find your wallets by
itself: a second wallet of yours posting a task that a third wallet of yours works looks
independent on-chain. So you tell it.

- **List every wallet you control in `TEAM_WALLETS`** on the deployment (comma separated,
  server-side, not a `NEXT_PUBLIC_` variable; a change takes effect on redeploy), and give the
  same list to the script. Include the Stage 0 canary wallets, the wallet that pays any
  make-good, and any wallet used by someone you pay to test.

  ```bash
  cd web
  npx tsx scripts/traction-report.ts --rpc <paid mainnet rpc> --team-wallets <wallet1>,<wallet2>
  ```

- **Either side counts.** A task a team wallet *posted* is not demand, and a task a team wallet
  *worked* is not supply from outside, so both are set aside, in their own block beside the
  headline. When a customer posts and you do the work, this understates the headline. That is
  the safe direction to be wrong in.
- **A bad entry stops the report.** A mistyped address silently dropped would let your own
  volume into the headline, so the page shows "THE LIST OF TEAM WALLETS IS INVALID" and no
  figures, and the script refuses. A rejected entry is never echoed back, because the likeliest
  mistake is pasting a secret key into the variable.
- **With none declared, the report says so**: "NO team wallets were declared" in the headline,
  and "Do not quote the headline as customer traction". Treat that as the report declining to
  vouch for the number, which is what it is doing.
- **It knows only what you tell it.** A team wallet you did not declare counts as independent,
  and the caveats say so. The page lists the declared wallets, so a reader can see who was set
  aside. Publish the list.

---

## 7. Risks this plan does not remove

- **The program is unaudited.** The cap limits the damage; it does not prevent it.
- **One verifier key.** It is the centralisation point in the README's first limitation.
  The runbook makes it survivable, not trusted.
- **The judge can be wrong**, and a landed verdict is final.
- **The niche may not exist.** The evidence for the pain is anecdotal (section 1).
- **One person's time.** Eight to ten weeks of onboarding customers is most of a person's
  working week. Write down the hours you can give before you promise customers support.
- **Legal and tax.** Paying strangers in USDC may carry sanctions, KYC and tax obligations
  that depend on where you and they are. I cannot advise on that; get advice before launch.

---

## 8. Questions only you can answer

Fill these in; the plan cannot be run without them.

- Who signs for the admin multisig, and who will hold the verifier key?
- Which wallets are team-controlled? (List them now; they go in `TEAM_WALLETS`.)
- Which 5–10 communities or sponsors will you talk to first, and which of them do you
  already know?
- How many hours a week can you give for the eight to ten weeks?
- Will you make a party whole when the judge is wrong, and up to what amount?
- Do you turn on human review of held tasks (`REVIEWER_ADDRESSES`) for the pilot, and who are
  the reviewers? Off, a held task waits for the poster's reclaim date.

---

## Sources

Read on **2026-10-24**. A claim marked "not confirmed" above is one I could not verify from
the page named here.

- Superteam Earn: [superteam.fun/earn](https://superteam.fun/earn/) (the "agent-eligible
  listings" and "240,000+ talent" lines); [Earn FAQ](https://superteamdao.notion.site/Superteam-Earn-FAQ-aedaa039b25741b1861167d68aa880b1)
  (a JavaScript page; its answers on payouts were **not readable**).
- Dework: [dework.xyz](https://dework.xyz) (features; no dated status);
  [The Grid](https://thegrid.id/profiles/dework) ("Acquired", no acquirer or date);
  [CB Insights](https://www.cbinsights.com/company/dework/alternatives-competitors) ("Alive").
- Algora: [PX4's bounty guide](https://discuss.px4.io/t/px4-bounties-are-here-solve-an-issue-receive-a-reward/35604)
  (paid after the pull request is merged and reviewed); [algora.io/pricing](https://algora.io/pricing)
  returned a **404** when fetched, so the 9% and 11% figures come from search summaries only.
- Quest platforms: [Galxe task verification, third-party guide](https://bulletlabs.notion.site/Task-verification-on-Galxe-How-does-it-work-1361204ce011800c95b6e7c325f904b9).
  No official documentation was read.
- Kleros: [docs.kleros.io](https://docs.kleros.io) (decentralised dispute resolution by staked
  jurors; an Escrow product). Costs and timescales were not on the page I read.
- GenLayer: [genlayer.com](https://www.genlayer.com) (mainnet on its roadmap for Q4 2026;
  permissioned validator set to begin with; escrow release named as a use case);
  [CryptoSlate](https://cryptoslate.com/companies/genlayer/) (testnet status, third-party).
  Figures for its decision volume and speed are the project's own and I have not repeated them.
- Payout friction, anecdotal and dated:
  [a contributor discussion describing a 1–2 week claim process](https://chainverse.notion.site/Contributor-UX-Discussion-6dfa08730b48487797fcaebc41f88e33);
  [an Arbitrum forum thread on grant-payout delays](https://forum.arbitrum.foundation/t/proposal-for-financial-restitution-for-arbitrumdao-grant-winners/27020/37);
  [a community post claiming Bountysource stopped paying](https://stacker.news/items/301817)
  (unverified); [a vendor report on DAO payment automation](https://streamflow.finance/blog/dao-treasury-distribution-report)
  (a vendor's own figures).
- This repository: `README.md` (limitations, what the judge can read), `docs/mainnet-checklist.md`,
  `docs/security-review.md` (R-02), `programs/rubric/src/constants.rs` (the 1,000 USDC ceiling),
  `web/lib/hash.ts` (clause limits), `web/lib/server/program.ts` (who pays token-account rent),
  `web/scripts/admin-action-plan.ts` and `web/scripts/traction-report.ts` (the commands).
