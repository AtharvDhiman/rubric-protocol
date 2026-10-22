# MultiHopper integration — fit assessment

**Status: investigation only. No integration code has been written.**
**Date of research: 2026-10-22.**

## Verdict

**MultiHopper does not fit Rubric's escrow architecture, and I recommend not
forcing it.** Three independent facts each rule out the PDA-signed payout, and
the only integration that *does* fit cannot plausibly reach the challenge's
$100,000 floor.

| Question | Answer |
| --- | --- |
| Can it work with the PDA-signed release inside `submit_verdict`? | **No.** |
| Can it work as a wallet-signed, off-protocol feature? | **Yes, narrowly** — an opt-in worker-side step *after* settlement. |
| Would that reach $100,000 qualifying volume? | **Not on any realistic horizon** (arithmetic in §5). |
| Is the challenge worth building toward with Rubric as it stands? | **No.** Recommendation in §7. |

Everything below is labelled **[documented]** (stated on a MultiHopper docs
page), **[inferred]** (my reading of what the docs imply) or **[unknown]** (not
in the public docs — see §8 for the questions that settle it).

> **Verify before relying on this.** The MultiHopper docs were read through a
> page-summarising fetch tool, not by hand, and several pages contradict or
> omit each other. Treat every figure as "as retrieved on 2026-10-22" and
> re-check the live pages, in particular the fee schedule, which the pricing
> page itself labels *devnet, rolling out cluster by cluster*.

---

## 1. What MultiHopper is

**[documented]** A protocol for scheduled, multi-hop token transfers on Solana.
A sender defines a route (3–10 intermediate hops, arrival window 60 s – 30 days,
or a custom route of wallets / "CEX bundles" with per-hop waits). The route is
deployed on-chain and executed by a permissionless **keeper** network. Third
parties integrate through a **hosted REST API** (`https://multihopper.com`,
`x-api-key: mh_live_…`; devnet is `https://devnet.multihopper.com`,
`mh_test_…`). There is an MCP server and HMAC-signed webhooks.

**[documented]** On-chain programs: *Core*
(`3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh`), *Orchestrator*
(`4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX`) and a *Transfer Hook Guard*
(`2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52`). Funds sit in a
program-controlled vault; hops move **Token-2022 wrapper tokens** (permanent
delegate + transfer hook) 1:1 backed by the vault. Verify these IDs on a
Solana explorer before trusting this document — I copied them from the docs.

**[documented]** There is **no SDK and no published CPI surface**. The
quickstart, signing guide and API reference describe only the REST flow. I
found no public source repository for the programs.

**[documented]** The integrator earns **50 % of every fee**, paid atomically
inside the route-creation transaction to a registered *rewards wallet*,
attributed by **API key**. Fee schedule on the pricing page: **0.50 % (50 bps)**
at every tier, plus a per-hop SOL charge by size tier (tier 0, hop value
≤ $50, charges 0). That page is explicitly a devnet schedule.

**[documented]** **No audit has been completed.** The security page says audits
are "planned prior to mainnet launch with significant TVL", and advises not
routing funds beyond your risk tolerance until reports are published. On
mainnet, "automatic compliance screening" applies, with a non-refundable
**0.002 SOL per screened wallet**.

It is a *privacy-oriented routing* product: its own threat model lists "route
tracing" and describes the last hop of a multi-destination route as a "decoy".

## 2. What the challenge requires

From the Superteam Earn listing **[documented]**:

- A live **mainnet** Solana product integrating MultiHopper, with production
  onboarding completed.
- **At least $100,000 qualifying volume** in the common window, or you do not
  qualify at all. *Qualifying volume = collected MultiHopper percentage fees
  ÷ 0.0025.* Discounted transfers count proportionally.
- *"Count principal once: hops and Multi-Send recipients never multiply
  volume."*
- *"Exclude failed, refunded, free, devnet, circular and prize-farming
  activity."* Treasury movements need a verifiable business purpose.
- Review for functionality, security, and **genuine usage**; ties broken on
  product quality and repeat use.
- Listed prizes $3,000 / $1,250 / $750, shared by qualifying volume. The
  listing says the initial $5,000 is conditional on **$2 M aggregate volume**
  and that its own dates and award structure are placeholders still to be
  confirmed. Winner announcement 2026-12-14; I found no submission deadline.
- Integration revenue is separate from the prize: 0.25 % of routed volume.

**Rubric will not manufacture volume.** Nothing in this document is a way to
make a number bigger without a real person moving real money for a real reason.
See §4, option E.

## 3. Does it fit a PDA-signed escrow release? — No

Today the release is one instruction. `submit_verdict`
(`programs/rubric/src/instructions/submit_verdict.rs`) is signed by the
verifier, checks `config.verifier_authority`, then makes `transfer_checked`
CPIs out of the escrow with the **Task PDA** as authority
(`new_with_signer`, seeds `[TASK_SEED, creator, task_id, bump]`): worker payout,
the 2 % fee, and any surplus back to the creator. State flips to a terminal
`Settled`/`Refunded` in the same transaction. That atomicity is the product.

Five reasons MultiHopper cannot sit in that path. Any one is enough.

1. **The signer is a client-held keypair.** **[documented]** `sourceOwner` is
   "the wallet that will sign and pay for the deployment transactions", signing
   is "client-side", and the only signer type shown is a base58 secret key
   loaded into a `Keypair`. Smart wallets, multisigs and PDAs are **not
   addressed**. A PDA cannot sign a transaction; it can only sign a CPI made by
   its owning program. So the REST flow cannot be driven by the Task PDA.
2. **It is a multi-transaction, time-boxed broadcast, not one instruction.**
   **[documented]** `prepare` returns up to five groups (`keeperFundingTx`,
   `routeInitTxs`, `orchestratorInitTx`, `sessionInitTxs`, `dispersionInitTxs`)
   that must be broadcast in order, each confirmed before the next, with
   blockhashes expiring ~60 s after `prepare`. There is no way to fold that into
   `submit_verdict`.
3. **A direct CPI is not documented and is probably not equivalent.**
   **[unknown]** Core has `provider_id`/`reference_id` fields on-chain, so an
   on-chain integration path may exist, but no instruction layout is published,
   and revenue attribution is documented only by API key. Even if it works, it
   would still be multi-step (reason 2) and would not credit our API key.
4. **It is not instant.** **[documented]** Arrival is governed by hop
   timelocks (route waits ≥ 20 s per hop, API arrival ≥ 60 s), and for a
   single recipient the final wallet must submit `unwrap` itself to redeem.
   Rubric's promise is that approval releases the escrow *"instantly"*.
5. **It would put a third-party, un-audited program in the money path.** If a
   keeper or MultiHopper program misbehaved, an approved task could finish
   `Settled` on our side with the payout stranded in a wrapper vault — the
   "terminal state with money not moved" failure our state machine exists to
   forbid. Rubric's own program is itself unaudited and single-verifier
   (`MAX_BOUNTY` exists for exactly this reason); stacking a second unaudited
   dependency in the release path multiplies the blast radius it was capped to
   contain.

## 4. Integration points evaluated

| | Option | Fits our architecture? | Generates counting fees? | Verdict |
| --- | --- | --- | --- | --- |
| **A** | **Poster funding** routed through MultiHopper into the escrow | **No.** `create_task` seals the clause hash and locks the money in *one* transaction. Routing funds through timelocked hops breaks that atomicity, and the destination is a PDA that cannot `unwrap`. | Would, but poster pays 0.50 % + SOL overhead on top of our 2 %. | **Reject.** Breaks the core trust property. |
| **B** | **Worker payout** inside `submit_verdict` (CPI or API) | **No** — §3. | n/a | **Reject.** |
| **C** | **Opt-in "route my payout"** for the *worker*, **after** settlement. A wallet-signed MultiHopper transfer the worker builds from a UI button. No program change. | **Yes.** Entirely outside the protocol; the escrow release is untouched. | Yes — a real wallet moving its own funds, created with our API key. | **Only viable option.** Volume is tiny (§5). |
| **D** | **Multi-Send** for paying several workers from one rubric | **Not with the escrow.** A Rubric task has exactly one worker (`task.worker: Option<Pubkey>`); multi-worker tasks are scope creep per `CLAUDE.md`. It would be a *separate* wallet-signed payout tool, not Rubric. | Would count, but it is a different product. | **Out of scope.** |
| **E** | Routing Rubric's **own 2 % fee** or treasury through MultiHopper | Technically trivial. | The listing excludes "circular" and "prize-farming" activity and requires a business purpose. | **Rejected outright — this is wash volume.** Listed so nobody is tempted. |

Option C is the *only* place a fee that counts can come from, and only if a
worker voluntarily chooses it. Its honest value proposition is narrow: a
contributor who does not want their payout wallet linked to their everyday one.

## 5. Volume and cost arithmetic

Inputs: `MAX_BOUNTY = 50_000_000` (50 USDC; a **compile-time constant** in
`constants.rs`, so changing it needs a program redeploy), Rubric fee 200 bps,
so a worker receives at most **$49**. MultiHopper overhead is taken from the
docs' own *devnet SOL* example (illustrative — see caveat below), priced at the
docs' example of $120/SOL.

**Routes needed for $100,000 principal, if 100 % of workers opt in:**

| Bounty | Worker payout | Routes needed | Fixed SOL cost per route | …as % of payout |
| --- | --- | --- | --- | --- |
| $50 | $49.00 | 2,041 | ≥ ~$2.09 | ~4 % |
| $20 | $19.60 | 5,103 | ≥ ~$2.09 | ~11 % |
| $5 | $4.90 | 20,409 | ≥ ~$2.09 | ~43 % |
| $1 | $0.98 | 102,041 | ≥ ~$2.09 | ~214 % |

(plus the 0.50 % percent fee in every row.)

**With realistic opt-in (bounty $50):** 25 % opt-in needs ~8,200 settled tasks;
10 % needs ~20,400; 2 % needs ~102,000.

**What a success earns:** the integrator share is 0.25 %, i.e. **~$250 on
$100,000 routed**, before any prize. The prize pool is itself conditional on
$2 M aggregate volume across all entrants.

**Two consequences.**

- The soft-launch plan of **$1–5 bounties is incompatible with this
  integration**: the fixed SOL overhead alone exceeds ~40 % of the payout, so no
  rational worker would opt in. A $1 payout would cost more to route than it is.
- Even at 100 % opt-in and every task at the cap, $100,000 needs 2,041 settled
  tasks. That is a product-traction problem, not an integration problem — and
  the volume would have to be real.

**Caveat on the cost figures.** The overhead is from a devnet *SOL* example
(`routeInitRent` 15,407,640 + tx fees 45,000 non-refundable; ~16.1 M lamports of
rent refundable). The docs' own breakdown sums to 32.66 M lamports but the total
overhead in that example is 48.21 M, and the page does not reconcile the two.
The mainnet *USDC* number is **[unknown]** until someone runs `/estimate` with
the real mint (needs an API key — §8, Q1).

## 6. Risks beyond fit

- **Two unaudited protocols in series.** Rubric's program is unaudited
  (`MAX_BOUNTY` is the mitigation); MultiHopper has published no audit.
- **Positioning.** Rubric's pitch is *public, checkable reasoning and
  settlement* ("pay on proof, not on trust"). MultiHopper's is *route
  obfuscation*. A "private payout" button is coherent for a narrow set of users
  but is a real tension with the brand, and routing payouts through obfuscation
  hops may draw attention from exchanges and wallets. This is a legal /
  compliance question I am not qualified to settle (§8, Q8). MultiHopper's own
  mainnet screening suggests they are aware of it.
- **Per-wallet mainnet cost.** The 0.002 SOL screening fee is per screened
  wallet and non-refundable; whether that includes the *recipient* and the
  *hops* is **[unknown]**.
- **"Production onboarding" is a gate we cannot see.** The docs do not say how
  to obtain an `mh_live_` key, whether there is an approval or KYC step, or how
  a rewards wallet is registered.
- **Proving volume to the judges.** `GET /usage` returns volume *and* fees, but
  it does not define "qualifying volume", and the only independently verifiable
  record is the on-chain payouts to our rewards wallet.
- **The qualifying-volume formula is ambiguous.** Listing: *fees ÷ 0.0025*.
  The full fee is 0.50 %, the integrator's half is 0.25 %. Dividing the
  **integrator share** by 0.0025 gives principal; dividing the **full** fee by
  it gives *twice* principal. The listing's own "$2,500 per $1 M routed" is
  consistent with the former. I have assumed principal, and §8 Q3 asks.
- **Test mode is not necessarily devnet.** `isTestMode` is documented without
  saying it equals devnet; do not assume it.

## 7. Recommendation

1. **Do not integrate MultiHopper into the protocol.** Options A and B break
   properties Rubric exists to guarantee (atomic sealing, atomic release,
   no third party in the payout path).
2. **Do not enter the challenge with Rubric as it stands.** The one compatible
   feature (option C) cannot plausibly reach $100,000, the realistic revenue
   ceiling is ~$250 per $100,000, and an entry that cannot clear the floor has a
   prize expectation of zero.
3. **Decouple the rest of the plan from the challenge.** Items 2–6 in the brief
   (mainnet readiness, verifier single point of failure, judge reliability,
   Phantom/trust UX, analytics) are each worth doing on their own merits for a
   mainnet launch. None of them depends on MultiHopper. I would keep them and
   drop the framing that they exist to hit a $100,000 target.
4. **If you still want the entry**, the honest version is a different product
   shape — a payout tool where wallet-signed Multi-Send *is* the product and
   volume comes from real payroll/bounty disbursements — with Rubric as the
   trust layer in front of it rather than the thing being routed. That is a
   design conversation, not a change to this repo, and I have not scoped it.
5. **Option C is optional and cheap** (UI-only, no program change) if you want
   it as a feature regardless of the challenge — but only after Q1, Q6 and Q8
   below are answered, and I would not describe it publicly as anything other
   than an opt-in convenience.

**Decision needed from you:** drop the challenge and continue items 2–6 for a
mainnet launch on their own merits (my recommendation), build option C as an
optional feature without expecting it to qualify, or pursue the different
product shape in point 4.

## 8. Open questions for the MultiHopper builder community

Ordered by how much each one changes the answer.

1. **USDC on mainnet, exactly.** Is the USDC mint supported? Can you share a
   real `/estimate` response for 5, 20 and 49 USDC with 3 hops and
   `destinationCount` 1? What is the true non-refundable SOL cost per route
   (the devnet example's breakdown does not reconcile to its total)? What is
   the mainnet percent fee? Is 0.50 % final or still rolling out?
2. **Smart-contract / PDA senders.** Is `sourceOwner` required to be an
   ed25519 keypair, or can a program-owned account fund a route via CPI? Is the
   Core instruction layout (IDL) published anywhere? If CPI is supported, is
   revenue attributed via `provider_id`, and is that the same as our API key?
3. **Qualifying volume formula.** Is "fees ÷ 0.0025" applied to the *full* fee
   (0.50 %) or to the *integrator share* (0.25 %)? Is the minimum $100,000
   principal, or $100,000 as the formula yields it?
4. **Dates and structure.** The listing calls its dates and award structure
   placeholders. What is the submission deadline and the measurement window?
   What counts as "production onboarding complete"?
5. **Onboarding.** How do we obtain an `mh_live_` key and register a rewards
   wallet? Is there approval or KYC for integrators?
6. **Compliance screening.** What exactly is screened (sender, recipient,
   every hop?), is the 0.002 SOL charged per wallet per route, and what happens
   to a transfer that fails screening — refund, partial refund, or funds held?
7. **Audit timeline.** When will audits be published, and who holds upgrade
   authority on Core, Orchestrator and the Transfer Hook Guard? What can
   `rescue_step` do?
8. **Acceptable use for a payout feature.** Is routing a *worker payout*
   through hops an intended use, or does it create issues for integrators?
   (This is also one for our own counsel.)
9. **Proof of volume.** What is the accepted evidence that volume is genuine
   and not circular? Is there an on-chain way for a judge to verify
   `totalVolumeRaw` for an API key?
10. **`isTestMode`.** Does it correspond to devnet? Do mainnet test-key
    transfers exist, and are they excluded from qualifying volume?

## 9. What I did and did not verify

- Read: the quickstart, index, architecture, how-it-works, route-lifecycle,
  pricing, security, create-transfer, estimate, usage, multi-destination and
  agentic-integration pages, plus the Superteam listing.
- **Not done:** I have no API key, so I called **no** MultiHopper endpoint and
  have no real USDC quote. I did not read MultiHopper's program source (none is
  public that I could find). All cost figures are from the docs' devnet SOL
  example.
- Search results on MultiHopper are the company's own press releases; nothing
  independent confirms its claims or its audit status.
- Rubric-side claims (§3) are read directly from `submit_verdict.rs` and
  `constants.rs`.

## Sources

- Quickstart: https://dev-docs.multihopper.com/quickstart
- Pricing & revenue share: https://dev-docs.multihopper.com/concepts/pricing
- Architecture: https://dev-docs.multihopper.com/protocol/architecture
- Security model: https://dev-docs.multihopper.com/concepts/security
- Create transfer: https://dev-docs.multihopper.com/api-reference/transfers/create
- Estimate: https://dev-docs.multihopper.com/api-reference/transfers/estimate
- Usage: https://dev-docs.multihopper.com/api-reference/usage
- Multi-destination: https://dev-docs.multihopper.com/guides/multi-destination
- Agentic integration / signing: https://dev-docs.multihopper.com/guides/agentic-integration
- Challenge listing: https://superteam.fun/earn/listing/multihopper-build-and-route-challenge-up-to-dollar50000-revenue-share-1
