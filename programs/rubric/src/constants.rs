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

/// MVP blast-radius cap on a single bounty.
///
/// USDC has 6 decimals, so this is 50.000000 USDC. The protocol is unaudited and
/// runs on a SINGLE verifier authority; if that key is compromised, this constant
/// is the ceiling on what any one task can lose. Raise it only after an audit and
/// after the verifier is no longer a single key.
pub const MAX_BOUNTY: u64 = 50_000_000;

/// Longest work window a task may set, in seconds (30 days).
///
/// Without this, a creator could set a deadline in the year 2200 and lock their
/// own escrow forever if no worker ever submits - `reclaim_expired` would be
/// unreachable for a human lifetime.
pub const MAX_WORK_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;

/// A hash of all zeroes. Used to reject "I didn't actually commit to anything"
/// values for both the rubric hash and the submission hash.
pub const ZERO_HASH: [u8; 32] = [0u8; 32];
