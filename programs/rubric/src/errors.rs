//! Every failure mode in the program, as a named error.
//!
//! Anchor turns this enum into error codes starting at 6000 (6000 = the first
//! variant, 6001 = the second, and so on). The tests in `tests/rubric.ts` assert
//! on these NAMES, not on the numbers, so reordering variants is safe for the
//! tests but will change the on-chain numbers - do not reorder after deploy.

use anchor_lang::prelude::*;

#[error_code]
pub enum RubricError {
    // ---- Config ----
    /// The protocol fee is capped at 10% so a misconfigured admin cannot take
    /// most of a worker's bounty.
    #[msg("Fee is above the 10% ceiling (1000 basis points).")]
    FeeTooHigh,

    // ---- Money ----
    /// A task with no bounty is not an escrow, it is a form. Refuse it.
    #[msg("Bounty amount must be greater than zero.")]
    AmountZero,

    /// MVP blast-radius limit while the program is unaudited.
    #[msg("Bounty amount is above the MVP maximum.")]
    AmountTooLarge,

    /// Any add/sub/mul/div on a u64 amount that would wrap lands here. We never
    /// let arithmetic silently wrap around on money.
    #[msg("Arithmetic overflow while computing amounts.")]
    MathOverflow,

    /// The escrow held less than the task says it should. Should be impossible;
    /// if it ever fires, something is very wrong and we refuse to pay out.
    #[msg("Escrow balance is lower than the recorded bounty.")]
    EscrowUnderfunded,

    // ---- Time ----
    /// A deadline in the past would let a task be created and immediately
    /// reclaimed, or be born un-submittable.
    #[msg("Deadline must be in the future.")]
    DeadlineInPast,

    /// Deadlines are also capped so escrow cannot be locked up for years.
    #[msg("Deadline is further out than the maximum allowed work window.")]
    DeadlineTooFar,

    /// Work submitted after the window closed is not eligible.
    #[msg("The deadline for this task has already passed.")]
    DeadlinePassed,

    /// The creator tried to reclaim before the work window closed. The worker
    /// still has time; the money is not the creator's to take back yet.
    #[msg("The deadline has not passed yet.")]
    DeadlineNotPassed,

    // ---- State machine ----
    /// The task is not in the state this instruction requires. This is the guard
    /// that makes Settled and Refunded terminal: every instruction demands a
    /// specific prior state, and no instruction accepts a terminal one.
    #[msg("Task is not in the required state for this instruction.")]
    InvalidState,

    // ---- Authority ----
    /// The single most security-critical check in the program. Only the key
    /// recorded in Config may rule on a task and thereby move escrowed funds.
    #[msg("Signer is not the configured verifier authority.")]
    NotVerifierAuthority,

    /// Only the admin recorded in Config may rotate the verifier authority.
    #[msg("Signer is not the config admin.")]
    NotAdmin,

    /// The account passed as the payout destination does not belong to the
    /// worker recorded on the task.
    #[msg("Destination token account does not belong to the recorded worker.")]
    WorkerMismatch,

    /// The account passed as the refund destination is not the poster recorded
    /// on the task.
    #[msg("Account is not the creator recorded on the task.")]
    CreatorMismatch,

    /// A task in Submitted state must have a worker. Defensive: if this fires,
    /// the state machine has a hole.
    #[msg("Task has no recorded worker.")]
    MissingWorker,

    // ---- Verdict payload ----
    /// Confidence is a percentage. 0-100, nothing else.
    #[msg("Confidence must be between 0 and 100.")]
    ConfidenceOutOfRange,

    /// An all-zero hash means "nobody actually committed to anything". Refuse it
    /// for both the rubric and the submission - a zero rubric hash would make
    /// the sealed-criteria guarantee meaningless.
    #[msg("Hash must not be all zeroes.")]
    EmptyHash,

    // ---- Accounts ----
    /// The mint passed in does not match the mint the task was funded with.
    #[msg("Mint does not match the mint recorded on the task.")]
    MintMismatch,

    /// The fee destination passed in is not the one recorded in Config.
    #[msg("Fee destination does not match the configured fee destination.")]
    FeeDestinationMismatch,
}
