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
| D3 | **Fee destination wallet.** A dedicated multisig-controlled wallet, with its USDC account created beforehand. | USDC is freezable by Circle, and a frozen fee account makes every approval revert (finding R-03). The admin can now recover with `set_fee_destination`, but keep the fee wallet clean so it never needs to. |
| D4 | **The launch bounty cap.** Now an on-chain `Limits` account the admin can change — but never above a compiled-in 1,000 USDC ceiling. Launch low (the scripts default to 50 USDC). | The cap bounds **one task, not the total**; size the launch around cap × open tasks. Raising the *ceiling* is a program upgrade. |
| D5 | **Audit status you will state publicly.** | The program is unaudited. A UI notice and a low cap are the honest minimum. |
| D6 | **Verifier custody.** A hot key on the server is unavoidable; decide the funding, alerting and rotation plan first. | The program cannot help here. The plan is [verifier-runbook.md](verifier-runbook.md): the health check and the **external monitor you must set up**, funding, rotation with no gap, and the order to follow for a leaked key. |

## Phase 1 — Code freeze and build

- ☐ All review fixes you accepted are merged and **the suite passes**. On Anchor
  1.x plain `anchor test` defaults to **surfpool**, which is not installed; use the
  validator that ships with Solana (this is also what `npm test` runs):

  ```bash
  anchor test --validator legacy     # 49 passing, 2 pending
  npm run test:grace                 # the 2 pending, against the TEST-ONLY build
  ```

  The second command builds with `--features short-grace`, which shortens the
  reclaim grace period from 7 days to 6 seconds. **Never deploy that binary.**
  `anchor build --verifiable` (below) uses default features, and a test pins that
  `short-grace` is not a default.

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

  > Earlier copies of the `lib.rs` and `Anchor.toml` comments said losing this
  > keypair means you can never upgrade the program. **That was wrong, and has been
  > tested:** on a local validator I deployed with the keypair, deleted it, and
  > upgraded using only the program's public address and the upgrade authority; an
  > upgrade by any other key was refused. Upgrades are authorised by the *upgrade
  > authority*. So after a confirmed deploy this file is safe to delete, and the key
  > to protect is the upgrade authority. (Re-check this once on devnet during the
  > rehearsal; it is the same loader mainnet uses.)
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

**`web/scripts/mainnet-init-plan.ts` prepares exactly that.** It signs nothing,
sends nothing, reads no key file and writes no file. Run it twice:

```bash
# 1. Read every check and the fingerprint of what you are about to make permanent.
cd web
npx tsx scripts/mainnet-init-plan.ts --rpc <paid mainnet rpc> \
  --admin <MULTISIG_VAULT> --mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --fee-destination <FEE_WALLET> --verifier <VERIFIER_PUBKEY>

# 2. Having read it, confirm with the fingerprint to be given the instructions.
npx tsx scripts/mainnet-init-plan.ts <the same arguments> --confirm <fingerprint>
```

It refuses (and prints nothing) unless the admin is the program's upgrade authority,
the mint is mainnet USDC with 6 decimals, nothing is initialised yet, the fee is
within its ceiling, the verifier is not the admin, and no key is the all-zero key.
On mainnet it also refuses an ordinary keypair address as the admin unless you pass
`--allow-eoa-admin`. Cluster is identified by **genesis hash**, never by the URL.
It prints **both** instructions — `initialize_config` and `initialize_limits` — to be
executed by the multisig in **one transaction, in that order**, plus the rent the
vault must hold. Every refusal is a unit test (`web/lib/init-plan.test.ts`).

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
  not exist the verifier has to create it, and if it is later frozen every approval
  reverts until the admin runs `set_fee_destination` to point at a clean wallet.
  Unlike the mint and the fee, this one can be changed.

  ```bash
  spl-token create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
    --owner <FEE_WALLET> --fee-payer usb://ledger --url mainnet-beta
  ```

- ☐ **`verifier_authority`** — a **new** key generated for mainnet. Never reuse
  the devnet verifier. It will live in server environment variables; fund it and
  alert on its balance (see the launch plan).

### Do not use `web/scripts/init-config.ts` or `init-limits.ts` on mainnet

Both were written for devnet and are unsafe on mainnet:

1. `init-config.ts` loads the admin from a **JSON keypair file**
   (`--admin ~/.config/solana/id.json`), **defaults `--mint` to devnet USDC** and
   **`--fee-destination` to the admin**, and **writes the verifier secret to
   `verifier.json`** in the repo root. A forgotten flag silently initialises mainnet
   with the wrong mint or with your upgrade authority collecting fees — permanently.
2. `init-limits.ts` also reads the admin from a file. It refuses to run against
   mainnet (by genesis hash) so it cannot be used by mistake, but that is a seatbelt,
   not a mainnet tool.

`mainnet-init-plan.ts`, above, is the mainnet path. Generate the verifier key on the
server that will hold it and pass only its **public** key.

### The Limits account

`create_task` **requires** the `Limits` account, so a deployment without one takes no
tasks. The planner prints `initialize_limits` for exactly that reason. It starts
**unpaused** at the launch cap. Afterwards the admin multisig can use:

- `set_max_bounty` — never above the compiled-in 1,000 USDC ceiling;
- `set_paused` — stops **new** tasks only. Claims, verdicts and reclaims never read
  `Limits`, so pausing cannot trap money already in escrow (test 50 proves it).

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
- ☐ An external uptime monitor is pointed at `GET /api/health/verifier` and alerts a
  human on any non-2xx. **Nothing in this repo sends that alert.** Prove it: let the
  warning line cross (set `VERIFIER_MIN_SOL_WARN` above the wallet's balance for a
  minute) and confirm the page actually arrives.
- ☐ `web/scripts/retry-stuck.ts` run once in dry-run mode against production, and its
  database host line read.

## Phase 6 — Limits you launch with

- ☐ Cap bounties low. The cap bounds **one task**, not the whole system: total
  exposure is the cap times the number of open tasks, because anyone may claim any
  open task and a compromised verifier key could approve them all. Size your
  launch around the *sum*, not the per-task number.
- ☐ A written plan for "pause": what you will do within an hour of finding a bug.
  The on-chain levers are `set_paused` (stops new tasks), `set_verifier_authority`
  (cuts off a leaked verifier) and a program upgrade. **`set_paused` does not stop
  anyone claiming an existing open task** — against a compromised verifier,
  rotating it is the lever that matters. Rehearse the pause as a multisig
  transaction before launch, so the first time is not during an incident.
  `web/scripts/admin-action-plan.ts` prepares each of these for the signers and
  refuses the mistakes that matter (a rotation to an unfunded wallet, a proposal not
  addressed to the real admin); the order for a leaked key is in
  [verifier-runbook.md](verifier-runbook.md#5-emergency-a-leaked-key).
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
| Verifier key leaked | `set_verifier_authority` (admin) to a new key. Order matters: [runbook §5](verifier-runbook.md#5-emergency-a-leaked-key). | Recall anything already paid. |
| Admin key lost / compromised | **Nothing.** Compromise lets an attacker rotate the verifier to themselves. | Rotate or revoke the admin. |
| Fee account frozen | `set_fee_destination` (admin) to a clean wallet. Approvals revert until it lands; if it lands late, posters reclaim after the grace period. | Recover fees already stuck in the frozen account. |
| Bug found in the program | `set_paused` now, to stop growth; upgrade, if the authority is not yet final. | Anything, if it is final. |
| Verifier offline | Posters can `reclaim_expired` after deadline **+ 7 days**. | Shorten the 7 days. |
