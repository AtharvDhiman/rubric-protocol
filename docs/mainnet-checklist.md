# Mainnet deployment checklist

**Nothing here has been run on mainnet. Every step is yours to run.** Per
`CLAUDE.md`: no mainnet deploy is performed by an assistant, and no real private
key goes into a file. Steps that cannot avoid a key file say so and say how to
contain it.

Legend: ⚠ = irreversible or moves real money. ☐ = a gate; do not continue past a
failed gate. Commands were checked against the installed **anchor-cli 1.1.2 /
solana-cli 3.1.10 / spl-token-cli 5.5.0** (flag names confirmed with `--help`,
not run end to end on mainnet). **Rehearse the whole sequence on devnet with a
throwaway program id first.**

Related: [security-review.md](security-review.md) explains *why* several of these
gates exist.

---

## Phase 0 — Decisions to make before touching a key

These are not steps, they are choices that change the steps. Write the answer next
to each before starting.

| # | Decision | Why it cannot wait |
| --- | --- | --- |
| D1 | **Admin = a multisig from day zero.** | There is **no** `set_admin` instruction. `Config.admin` is whoever signs `initialize_config` and it can never change. A hot admin key is a permanent hot admin key. |
| D2 | **Upgrade authority plan.** Multisig + timelock, or immutable after an audit. | The upgrade authority can replace the program and take every escrow. It, not the admin, is the real root of trust (finding R-01). |
| D3 | **Fee destination wallet.** A dedicated multisig-controlled wallet, with its USDC account created beforehand. | `fee_destination` is immutable and USDC is freezable by Circle. A frozen fee account makes every approval revert (finding R-03). |
| D4 | **Launch bounty cap and whether it is configurable.** | `MAX_BOUNTY` is a compile-time constant today; raising it is a redeploy. See the pending proposal in the review. |
| D5 | **Audit status you will state publicly.** | The program is unaudited. A UI notice and a low cap are the honest minimum. |
| D6 | **Verifier custody.** A hot key on the server is unavoidable; decide the funding, alerting and rotation plan first. | Covered by item 3 of the launch plan; the program cannot help here. |

## Phase 1 — Code freeze and build

- ☐ All review fixes you accepted are merged and **`anchor test` passes**.
  Note that on Anchor 1.x `anchor test` defaults to **surfpool**, which is not
  installed; use the validator that ships with Solana:

  ```bash
  anchor test --validator legacy
  ```

- ☐ **`Anchor.toml` must contain `[test]` with `upgradeable = true`.** On
  anchor-cli 1.1.2 the test validator deploys the program as **immutable unless
  that is set**, and the committed `Anchor.toml` does not set it. `initialize_config`
  then correctly refuses every caller (the signer is not the upgrade authority,
  because there isn't one) and the *whole suite* dies in `before all` with a
  confusing `NotAdmin`. I reproduced this on a clean copy with the `[test]`
  section both absent and set to `false`; only `true` passes (19/19). This is a
  harness trap, not a program bug — it is the land-grab gate doing its job.
- ☐ Generate a **fresh program keypair for mainnet**. Do not reuse the devnet one:
  its file sits on a development machine, and whoever holds it can deploy a
  different program at that address first.

  ```bash
  solana-keygen new --no-bip39-passphrase -o ./mainnet-program-keypair.json
  anchor keys sync          # rewrites declare_id! in lib.rs and Anchor.toml
  grep -n -A3 '^\[test\]' Anchor.toml   # must show: upgradeable = true
  ```

  This is the **one unavoidable key file**: `solana program deploy --program-id`
  needs it for the initial deploy only. It controls no funds. Create it on the
  machine that will deploy, never commit it (`target/deploy/*.json` is
  gitignored; this path is not, so keep it outside the repo), and delete it once
  the deploy is confirmed.

  > The comments in `lib.rs` and `Anchor.toml` say losing this keypair means you
  > can never upgrade the program. **That is wrong for an upgradeable program:**
  > upgrades are authorised by the *upgrade authority*, not the program keypair.
  > Confirm during the devnet rehearsal, then fix the comments so nobody hoards
  > copies of a key that is useless after deploy.
- ☐ Rebuild after the sync, then make a **verifiable build** (needs Docker). It
  is deterministic, so anyone can reproduce the exact bytes you deploy:

  ```bash
  anchor build --verifiable
  sha256sum target/verifiable/rubric.so      # record this; confirm the path after the build
  ```

- ☐ Work out the deploy cost **against mainnet's current rent**. Rent is
  cluster-dependent and has changed: a read-only query today returns **5,080
  lamports/byte** on mainnet, while the local test validator still charges the old
  6,960. The program's data account holds the whole binary plus a 45-byte header,
  and a deploy needs that much *twice* at the peak, because the upload buffer
  exists alongside it (the buffer's rent is refunded afterwards).

  ```bash
  ls -l target/verifiable/rubric.so
  solana rent $(( $(stat -c %s target/verifiable/rubric.so) + 45 )) --url mainnet-beta
  ```

  For reference, the binary I built was **352,376 bytes**, which prices at about
  **1.79 SOL** at today's rent, so plan on having roughly **4 SOL** available at
  the peak plus fees. Re-run the command on deploy day.

## Phase 2 — Deploy ⚠

Use a hardware wallet for the deployer. The deployer is the **initial upgrade
authority**, which is the most powerful key in the system.

- ☐ Fund the Ledger address with at least twice the rent figure above, plus fees
  (about 4 SOL for the current binary).
- ☐ Deploy:

  ```bash
  solana program deploy target/verifiable/rubric.so \
    --program-id ./mainnet-program-keypair.json \
    --keypair usb://ledger \
    --upgrade-authority usb://ledger \
    --url mainnet-beta \
    --with-compute-unit-price <micro-lamports> \
    --use-rpc
  ```

  Use a **paid RPC** for this; a public endpoint will drop write transactions. If
  a deploy is interrupted the buffer survives; resume it rather than starting
  over (`solana program show --buffers --url mainnet-beta`).
- ☐ Verify immediately. The authority must be the Ledger and nothing else:

  ```bash
  solana program show <PROGRAM_ID> --url mainnet-beta
  anchor verify <PROGRAM_ID> --provider.cluster mainnet \
    --repo-url <your repo url> --commit-hash <the commit you built>
  ```

- ☐ Delete `./mainnet-program-keypair.json` (after the rehearsal confirmed it is
  not needed for upgrades).

## Phase 3 — Initialise ⚠ (one shot)

`initialize_config` fixes `admin`, `bounty_mint`, `fee_bps` and
`fee_destination` **permanently** — only `verifier_authority` can ever change. A
typo here is recoverable only by redeploying under a new program id.

### The ordering trap

`initialize_config` requires the **signer to be the program's current upgrade
authority** (this is what stops anyone front-running your setup). That ties
`admin` to the upgrade authority *at the moment you initialise*:

| Order | Result | Verdict |
| --- | --- | --- |
| Init as the Ledger, then hand the upgrade authority to a multisig | Upgrade authority is the multisig, but **`admin` is the Ledger forever** (no `set_admin`). | Leaves a permanent single-key admin that can re-point the verifier at itself. |
| **Hand the upgrade authority to a multisig first, then run `initialize_config` as a multisig transaction** | `admin` **and** upgrade authority are both the multisig. | **Recommended.** No program change needed. |

For the recommended order the multisig must execute `initialize_config` itself
(Squads or similar), pay the rent from its vault, and sign as `admin`. Follow the
multisig's own documentation for executing an arbitrary instruction; I have not
verified the current UI flow and will not guess at it.

Handing the authority to a multisig *vault* needs one flag you should read twice.
A vault is a PDA and **cannot sign** a top-level transaction, so the CLI's default
check that the new authority signs must be skipped. That makes a wrong address
unrecoverable:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <MULTISIG_VAULT_ADDRESS> \
  --skip-new-upgrade-authority-signer-check \
  --upgrade-authority usb://ledger \
  --keypair usb://ledger \
  --url mainnet-beta
```

Triple-check `<MULTISIG_VAULT_ADDRESS>` against the multisig's UI **and** its
on-chain account before running it.

### Values

- ☐ **`bounty_mint`** — mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
  I checked this against the chain on 2026-10-22 (owner: classic Token program;
  6 decimals; freeze authority set). Do not trust this document anyway — verify it
  yourself on deploy day, because `MAX_BOUNTY` assumes **6 decimals** and the
  program does not check:

  ```bash
  spl-token display EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --url mainnet-beta
  ```

  Confirm: owner is the classic Token program
  (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), `Decimals: 6`, and note the
  **freeze authority** is set (Circle) — that is a real property of the asset you
  are escrowing, not a bug.
- ☐ **`fee_bps`** — 200 (2%). Capped at 1000 by the program and not changeable.
- ☐ **`fee_destination`** — the dedicated wallet from D3.
  **Create its USDC token account first.** Every verdict validates it; if it does
  not exist the verifier has to create it, and if it is later frozen no approval
  can ever settle.

  ```bash
  spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
    --owner <FEE_WALLET> --fee-payer usb://ledger --url mainnet-beta
  ```

- ☐ **`verifier_authority`** — a **new** key generated for mainnet. Never reuse
  the devnet verifier. It will live in server environment variables; fund it and
  alert on its balance (see the launch plan).

### Do not use `web/scripts/init-config.ts` as it stands

It was written for devnet and three of its defaults are unsafe on mainnet:

1. It loads the admin from a **JSON keypair file** (`--admin ~/.config/solana/id.json`).
2. `--mint` **defaults to devnet USDC** and `--fee-destination` **defaults to the
   admin**. A forgotten flag silently initialises mainnet with the wrong mint or
   with your upgrade authority collecting fees — permanently.
3. It writes the **verifier secret to `verifier.json`** in the repo root.

A mainnet variant should refuse to run unless `--mint` is passed explicitly *and*
on-chain verifies the mint (owner, 6 decimals), print the full config and require
a typed confirmation, never read a key file for the admin, and never write a
secret to disk. That is a code change and is listed as a proposal, not done.

## Phase 4 — Prove the deployment

- ☐ Read `Config` back from the chain and compare every field to the table you
  filled in at Phase 3: `admin`, `verifier_authority`, `bounty_mint`, `fee_bps`,
  `fee_destination`. (`web/scripts/prove-deployment.mjs` is the starting point;
  point it at mainnet read-only.)
- ☐ `solana program show <PROGRAM_ID> --url mainnet-beta` — upgrade authority is
  the multisig vault, not a person.
- ☐ Set `VERIFIER_SECRET_KEY` and the program id in the host environment **by
  hand**. The app asserts its verifier pubkey matches `config.verifier_authority`;
  a mismatch must fail loudly, not quietly hold every task.

## Phase 5 — Canary

- ☐ With a **fresh wallet** that holds real USDC, create a **$1** task, submit
  work from a second wallet, and let the judge rule. Confirm the explorer shows
  the payout and the 2% fee landing where you expect.
- ☐ Create another and let it be **rejected**; confirm the full refund.
- ☐ Create one with a short deadline and **no submission**; confirm
  `reclaim_expired` returns it.
- ☐ Watch the verifier wallet balance across these. Note what a verdict actually
  costs.

## Phase 6 — Limits you launch with

- ☐ Cap bounties low. The cap bounds **one task**, not the whole system: total
  exposure is the cap times the number of open tasks, because anyone may claim any
  open task and a compromised verifier key could approve them all. Size your
  launch around the *sum*, not the per-task number.
- ☐ A written plan for "pause": what you will do within an hour of finding a bug.
  Today the only on-chain levers are `set_verifier_authority` and a program
  upgrade. (A pause flag is part of the pending proposal.)
- ☐ A banner stating the program is **unaudited** and capped.

## Phase 7 — Making it permanent ⚠⚠

Irreversible. Not before an external audit and a quiet period.

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final \
  --upgrade-authority <current authority signer> --url mainnet-beta
```

After this the program can never be changed, including to fix a bug. Initialise
**first** — `initialize_config` can never be called again once the program is
immutable and the config does not exist.

---

## Incident quick reference

| Event | What you can do on-chain | What you cannot do |
| --- | --- | --- |
| Verifier key leaked | `set_verifier_authority` (admin) to a new key. | Recall anything already paid. |
| Admin key lost / compromised | **Nothing.** Compromise lets an attacker rotate the verifier to themselves. | Rotate or revoke the admin. |
| Fee account frozen | **Nothing without a program change.** Approvals revert; posters get refunds after the grace period. | Change `fee_destination`. |
| Bug found in the program | Upgrade, if the authority is not yet final. | Anything, if it is. |
| Verifier offline | Posters can `reclaim_expired` after deadline **+ 7 days**. | Shorten the 7 days. |
