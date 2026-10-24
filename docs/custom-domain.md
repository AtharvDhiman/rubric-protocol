# A domain of its own, and wallet warnings

Item 5 of the launch plan said Phantom flags `*.vercel.app` as a possible risk, and asked for
two things: how to move to a custom domain, and a short notice in the UI. This is the first.
The notice is `components/SigningNotice.tsx`.

**Read the next section before the rest, because it corrects the premise a little.**

## 1. What is actually known

I looked at Phantom's own developer documentation
([domain and transaction warnings](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings))
rather than assume. It describes two warnings that apply here, and they are different things:

| Warning | What the page says triggers it | What it says to do |
| --- | --- | --- |
| **New domain** — "This domain is new or has not been reviewed yet. Proceed with caution." | A newly launched or newly detected domain. | It "usually goes away within a few days". If it is still showing after **more than a week**, use the domain review team form linked from that page. |
| **Transaction simulation** — "This dApp could be malicious. Do not proceed unless you are certain it is safe." | Phantom "can't accurately simulate a transaction before it's sent", so it cannot predict the outcome. | A list of steps for the dApp developer (section 5: signers, compute limits, simulating beforehand, size), then the same review form if it persists. The page lists these as ways to reduce the warning; it does not say each one is a cause. |

Three things the documentation **does not** say, so this repository does not claim them:

- It does not say that shared hosting domains such as `*.vercel.app` are treated differently.
- It does not describe a blocklist, or any process for disputing a listing. Third-party
  threat-intelligence sites do flag many `*.vercel.app` subdomains, usually for impersonating
  wallets, but those reports are about specific hostnames and say nothing about how Phantom
  treats the platform.
- It gives no response time for the review form.

So: if you have seen a warning, the first question is **which one**. The "new domain" warning
is expected for any site Phantom has not seen before and clears by itself. The "could be
malicious" warning is about the *transactions*, and a custom domain will not fix it.

I could not reproduce either here (no Phantom, and not on mainnet), so nothing in this
document is based on having seen the warning.

## 2. Why move anyway

Independent of Phantom:

- **Anyone can claim a `*.vercel.app` name**, so the hostname tells a user nothing about who
  runs the site, and a look-alike is a few keystrokes away. A domain you own is an identity
  you can point to.
- **A shared hostname shares its reputation** with everything else on the platform.
- **Wallets remember sites by origin**, so the sooner you move, the fewer people have to
  reconnect.

## 3. How to move (Vercel)

This needs **no code change.** I checked: the app has no hard-coded URLs, no `metadataBase`,
no allowed-origin list and no host-dependent configuration, and neither the program id nor
the cluster is tied to a domain. It is configuration only.

1. **Buy the domain** from any registrar. Prefer one you will keep for years; people link to it.
2. In Vercel, open the project, **Settings → Domains → Add**, and enter the domain.
3. **Create the DNS records Vercel shows you**, exactly as shown. Do not copy values from a
   blog post or from this file: the records Vercel asks for have changed over time, and the
   dashboard is the authority. See [Vercel's domains documentation](https://vercel.com/docs/domains).
4. **Wait for the certificate.** Vercel issues HTTPS automatically once DNS resolves.
5. **Redirect the old address.** In the same Domains screen, set `*.vercel.app` to redirect to
   the new domain, so existing links (the README, a bounty submission, anything shared) keep
   working and nobody is left on the shared address.
6. **Open the site on the new domain** and connect a wallet once, on devnet.

When the site is on its own domain, `SigningNotice` stops appearing on its own: it only shows
on shared hosting hostnames (`lib/host-notice.ts`).

## 4. Order of operations before a launch

Do the move **early**, not the day before. The "new domain" warning is documented to show for
a few days, and to need the review form only if it lasts more than a week, so a domain
introduced the day of a launch will meet users with a warning and no time to clear it.

1. Move the domain (section 3) at least two weeks before anything depends on it.
2. Use it from a wallet on devnet during those weeks, so it is seen and reviewed.
3. If the warning is still there after a week, submit the domain review form.
4. Only then publish the new address.

## 5. If the warning is "This dApp could be malicious"

That is the transaction-simulation warning, and it points at our transactions, not our domain.
Phantom's guidance for developers, and where Rubric stands on each point **as of this writing,
without ever having seen the warning**:

| Phantom's guidance | Rubric today |
| --- | --- |
| Use Solana v1 (legacy) transactions | Anchor's default, which `.rpc()` uses. Not verified against a live Phantom. |
| Limit the transaction to one signer | The user-signed transactions (`create_task`, `submit_work`, `reclaim_expired`) are signed by the connected wallet only. The verifier's transactions are server-side and never go through a wallet. |
| Set compute-unit and loaded-account-data limits explicitly | **Not set.** None of the three sets either. This is the first thing I would try if the warning ever appears. It was not done now because, with nothing observed, there is nothing to confirm it would fix. |
| Sign with `signTransaction`, then submit through your own RPC with preflight on | Anchor's provider signs with the wallet and sends through the app's RPC connection. Not verified in detail. |
| Simulate before signing, so it cannot fail on-chain | `create_task` fails by design when the limits account is missing or the protocol is paused (see `lib/limits.ts`); the page checks this first and refuses, but the simulation path has not been tested against Phantom. |
| Split a transaction near the size limit | None is near it. |

If the warning shows up: note exactly what Phantom displays and on which action, try the
compute-unit item, and use the review form if it persists.

## 6. What the in-app notice does and does not do

It appears next to the three buttons that ask a wallet to sign (seal, submit, reclaim), and
only on a shared hosting address. It names **no cause** for any warning, because section 1
says none is established. It says wallets may warn about unreviewed domains, tells the reader
what to check (the address bar, the exact program id, that Rubric never asks for a seed phrase)
and ends: *if anything does not match, do not sign.*

It deliberately never tells anyone to ignore or dismiss a warning, and a test fails if the
wording ever does. That is the instruction a phishing page gives, and a legitimate site that
gives it teaches people to follow it.
