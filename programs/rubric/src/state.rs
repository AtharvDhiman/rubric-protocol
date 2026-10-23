//! On-chain account layouts.
//!
//! Two accounts exist: a singleton `Config` and one `Task` per posted matter.
//! Both are PDAs (program-derived addresses) - accounts whose address is derived
//! from seeds plus the program id, and which therefore have no private key. That
//! is the whole trust story: a `Task` can only ever be written by this program's
//! own logic, so the sealed rubric hash cannot be edited by the poster, by a
//! worker, or by us.

use anchor_lang::prelude::*;

/// The lifecycle of a task.
///
/// Legal transitions, and nothing else:
///
/// ```text
///                 submit_work            submit_verdict(approved)
///   Open  ------------------>  Submitted -----------------------> Settled
///     |                            |
///     | reclaim_expired            | submit_verdict(!approved)
///     v                            v
///  Refunded  <---------------------+
/// ```
///
/// `Settled` and `Refunded` are TERMINAL. No instruction in this program accepts
/// a task in either state - every handler requires an explicit prior state, so
/// there is no path that moves money out of a task twice.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TaskState {
    /// Funded and sealed. Waiting for a worker.
    Open,
    /// A worker has submitted. Waiting for the verifier's ruling.
    Submitted,
    /// Approved: the worker was paid and the fee was taken. Terminal.
    Settled,
    /// Rejected or expired: the creator got their money back. Terminal.
    Refunded,
}

/// The verifier's ruling, recorded permanently on the task.
///
/// `reasoning_hash` is a SHA-256 of the full JSON verdict (per-clause pass/fail
/// and reasoning) that the off-chain judge produced. The chain stores the hash,
/// not the prose - prose is expensive and the hash is enough to prove the public
/// reasoning was not edited after the fact.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct VerdictRecord {
    /// True if every sealed clause passed.
    pub approved: bool,
    /// The judge's self-reported confidence, 0-100.
    pub confidence: u8,
    /// SHA-256 of the canonical JSON verdict published off-chain.
    pub reasoning_hash: [u8; 32],
    /// Unix timestamp of the ruling, taken from the on-chain clock.
    pub decided_at: i64,
}

/// Singleton protocol configuration.
///
/// PDA seeds: `[b"config"]` - there is exactly one, and its address is fixed for
/// the life of the program.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// May rotate `verifier_authority`, change `fee_destination`, and set the
    /// `Limits`. It can never touch a task, move escrowed money, or change
    /// `fee_bps` or `bounty_mint`. There is NO instruction that rotates the admin
    /// itself, so this is chosen once at initialisation - make it a multisig.
    pub admin: Pubkey,
    /// The ONLY key permitted to call `submit_verdict`. This is the MVP's
    /// centralization point and it is documented as such in the README.
    pub verifier_authority: Pubkey,
    /// The ONE SPL mint this deployment escrows in (USDC).
    ///
    /// Without this, `create_task` accepted any mint the poster passed, which
    /// made the bounty cap meaningless: "50_000_000 base units" is 50 USDC at 6
    /// decimals but 50 million whole tokens against a 0-decimal mint the poster
    /// minted themselves. The cap is the blast-radius limit, so the mint it is
    /// denominated in has to be fixed too.
    pub bounty_mint: Pubkey,
    /// Protocol fee in basis points (200 = 2%). Capped at `MAX_FEE_BPS`.
    pub fee_bps: u16,
    /// Wallet that owns the token account fees are paid into. The admin can
    /// change it (`set_fee_destination`), because the asset is freezable and a
    /// frozen fee account would otherwise revert every approval.
    pub fee_destination: Pubkey,
    /// Stored bump so we never have to re-derive it (and so we never trust a
    /// bump supplied by a caller).
    pub bump: u8,
}

/// Limits on NEW tasks, adjustable by the admin without redeploying.
///
/// PDA seeds: `[b"limits"]` - exactly one, at a fixed address.
///
/// This is its own account rather than more fields on `Config` for a practical
/// reason: `Config` already exists on every deployed cluster, and adding fields
/// would change its size and orphan it. A new account can be added to a running
/// deployment with one admin call.
///
/// WHAT THE LIMITS CAN AND CANNOT DO
/// ---------------------------------
/// They govern `create_task` and nothing else. Neither can ever block
/// `submit_work`, `submit_verdict` or `reclaim_expired`, so no setting here can
/// trap money that is already in escrow.
///
/// The cap bounds ONE task, not the protocol. Total exposure is the cap times the
/// number of open tasks (docs/security-review.md, R-02), so it is a dial for
/// launch caution, not a guarantee against a compromised verifier.
#[account]
#[derive(InitSpace)]
pub struct Limits {
    /// The largest bounty `create_task` accepts, in the mint's base units.
    ///
    /// Always between 1 and `ABSOLUTE_MAX_BOUNTY`. The admin chooses the value;
    /// the ceiling is compiled in, so even a compromised admin key cannot make
    /// the cap unbounded - only a program upgrade can raise the ceiling.
    pub max_bounty: u64,
    /// While true, `create_task` is refused. Existing tasks are unaffected.
    pub paused: bool,
    /// Stored canonical bump.
    pub bump: u8,
}

impl Limits {
    /// A cap must be positive and no more than the compile-time ceiling.
    ///
    /// One function, used by both the instruction that creates the account and
    /// the one that changes it, so the two can never disagree about what is
    /// allowed.
    pub fn validate_max_bounty(max_bounty: u64) -> Result<()> {
        require!(
            max_bounty > 0 && max_bounty <= crate::constants::ABSOLUTE_MAX_BOUNTY,
            crate::errors::RubricError::LimitOutOfRange
        );
        Ok(())
    }
}

/// One posted matter: the sealed criteria, the money, and the ruling.
///
/// PDA seeds: `[b"task", creator.key(), task_id.to_le_bytes()]`
///
/// Keying on the creator means two different posters can independently use
/// `task_id = 1` without colliding, and a poster cannot squat on someone else's
/// task id.
#[account]
#[derive(InitSpace)]
pub struct Task {
    /// Who posted and funded this task. Receives the refund on rejection or
    /// expiry.
    pub creator: Pubkey,
    /// The caller-chosen id, part of the PDA seeds. Stored so clients can read
    /// it back off a fetched account without re-deriving.
    pub task_id: u64,
    /// Set when work is submitted. Receives the payout on approval.
    pub worker: Option<Pubkey>,
    /// The SPL mint the bounty is denominated in (USDC on devnet/mainnet).
    /// Recorded at creation so payout cannot be redirected to a different token.
    pub mint: Pubkey,
    /// SHA-256 of the canonical clause text. THE central commitment: written at
    /// creation, never mutated by any instruction in this program.
    pub rubric_hash: [u8; 32],
    /// SHA-256 of the submitted deliverable, set once on `submit_work`.
    pub submission_hash: Option<[u8; 32]>,
    /// Amount held in escrow, in the mint's base units.
    pub bounty_amount: u64,
    /// Unix timestamp after which the creator may reclaim an unworked task.
    pub deadline: i64,
    /// Current lifecycle position. See `TaskState`.
    pub state: TaskState,
    /// The verifier's ruling, once one exists.
    pub verdict: Option<VerdictRecord>,
    /// Stored bump for the task PDA. Used to sign escrow transfers as the PDA.
    pub bump: u8,
}

impl Task {
    /// True if no instruction may ever mutate this task again.
    pub fn is_terminal(&self) -> bool {
        matches!(self.state, TaskState::Settled | TaskState::Refunded)
    }
}
