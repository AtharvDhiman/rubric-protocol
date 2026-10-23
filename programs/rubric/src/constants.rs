//! Program-wide constants. These are compiled into the program, so changing any
//! of them requires a redeploy - that is deliberate for the safety limits.

/// PDA seed prefix for the singleton `Config` account.
pub const CONFIG_SEED: &[u8] = b"config";

/// PDA seed prefix for a `Task` account.
pub const TASK_SEED: &[u8] = b"task";

/// Basis-point denominator. 10_000 bps = 100%.
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Hard ceiling on the protocol fee, checked in `initialize_config`.
/// 1000 bps = 10%. Even a compromised admin cannot set a confiscatory fee.
pub const MAX_FEE_BPS: u16 = 1_000;

/// The HARD CEILING on the bounty cap: 1,000 USDC (USDC has 6 decimals).
///
/// The day-to-day cap lives in the `Limits` account, and the admin can change it
/// without redeploying - launch scripts start it at 50 USDC. But the admin can
/// never set it above THIS, because this is compiled in: only a program upgrade
/// can raise it. So even a compromised admin key cannot make the cap unbounded.
///
/// It replaces the old compile-time `MAX_BOUNTY` (50 USDC), which could only be
/// changed by redeploying. The trade is deliberate: a settable cap allows a staged
/// ramp-up in one transaction and avoids re-shipping and re-auditing a binary, at
/// the price of one more thing the admin key can turn up - bounded by this number.
///
/// What it does and does not bound is in docs/security-review.md (R-02): the cap
/// limits ONE task, not the sum of open escrow. Raise it only after an audit and
/// after the verifier is no longer a single key.
pub const ABSOLUTE_MAX_BOUNTY: u64 = 1_000_000_000;

/// PDA seed prefix for the singleton `Limits` account.
pub const LIMITS_SEED: &[u8] = b"limits";

/// Longest work window a task may set, in seconds (30 days).
///
/// Without this, a creator could set a deadline in the year 2200 and lock their
/// own escrow forever if no worker ever submits - `reclaim_expired` would be
/// unreachable for a human lifetime.
pub const MAX_WORK_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;

/// How long after the deadline the creator must wait before they may reclaim a
/// task that a worker claimed but the verifier never ruled on.
///
/// This exists because `Submitted` would otherwise be a one-way door: only the
/// verifier can move a task out of it, so a griefer who claims every open task
/// (anyone may call `submit_work`) combined with a lost or offline verifier key
/// would lock every escrow in the protocol forever. Seven days is long enough
/// that it never fires in normal operation - a verdict takes seconds - and short
/// enough that capital is not hostage to one key indefinitely.
#[cfg(not(feature = "short-grace"))]
pub const VERDICT_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60;

/// !!! TEST BUILDS ONLY. NEVER DEPLOY A BINARY BUILT WITH `short-grace`. !!!
///
/// Six seconds instead of seven days. That is the only way to run the grace-period
/// escape hatch to completion in a test: the validator's clock cannot be moved
/// mid-test, and nobody waits a week.
///
/// The danger is the exact opposite of the one the real constant guards against.
/// With this window, a poster could reclaim a bounty seconds after the deadline
/// from work a worker had submitted and the verifier simply had not ruled on yet -
/// the escrow of an honest worker, taken back almost immediately. Shipping this by
/// accident would silently break the protocol's central promise.
///
/// So it is a non-default Cargo feature, `default = []` is pinned by a test, the
/// feature's name says what it does, and the mainnet checklist compares the
/// deployed bytes against a verifiable default-features build.
#[cfg(feature = "short-grace")]
pub const VERDICT_GRACE_SECONDS: i64 = 6;

/// A hash of all zeroes. Used to reject "I didn't actually commit to anything"
/// values for both the rubric hash and the submission hash.
pub const ZERO_HASH: [u8; 32] = [0u8; 32];
