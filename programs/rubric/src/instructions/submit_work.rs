//! `submit_work` - a worker claims a task by committing a deliverable hash.
//!
//! This instruction moves no money. It records who did the work and a hash of
//! what they submitted, so the deliverable that gets judged is provably the one
//! that was submitted before the ruling - a worker cannot swap in better work
//! after seeing a rejection.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::constants::{TASK_SEED, ZERO_HASH};
use crate::errors::RubricError;
use crate::state::{Task, TaskState};

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    /// The worker. Whoever signs this becomes the payee if the verdict approves,
    /// so the signature is what binds the payout address.
    pub worker: Signer<'info>,

    /// The task being claimed.
    ///
    /// Re-derived from `[b"task", task.creator, task.task_id]` with the stored
    /// bump. This proves the account really is a Task this program created, and
    /// not a look-alike account an attacker crafted with a state field set to
    /// `Open` and a bounty they do not own.
    #[account(
        mut,
        seeds = [TASK_SEED, task.creator.as_ref(), task.task_id.to_le_bytes().as_ref()],
        bump = task.bump
    )]
    pub task: Account<'info, Task>,

    /// The mint the task was funded in.
    ///
    /// `address = task.mint` pins it to the mint recorded at creation, so the
    /// worker token account checked below is checked against the right token.
    #[account(address = task.mint @ RubricError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    /// The worker's USDC account, checked to exist here for a liveness reason.
    ///
    /// `submit_verdict` has to pay this exact account. If the worker had no token
    /// account at verdict time, the payout transfer would fail and the task would
    /// be stuck in `Submitted` forever with the money trapped - there is no
    /// reclaim path out of `Submitted`. Requiring the account up front makes that
    /// failure impossible to reach by accident.
    ///
    /// The `associated_token::*` constraints derive the canonical ATA for
    /// (worker, mint), so the worker cannot nominate somebody else's account.
    #[account(
        associated_token::mint = mint,
        associated_token::authority = worker,
    )]
    pub worker_token_account: Account<'info, TokenAccount>,
}

pub fn submit_work_handler(ctx: Context<SubmitWork>, submission_hash: [u8; 32]) -> Result<()> {
    let task = &mut ctx.accounts.task;

    // Only an Open task accepts work. This single check rejects:
    //   - submitting to a task that already has a submission (Submitted)
    //   - submitting to a task that has already been paid out (Settled)
    //   - submitting to a task that has already been refunded (Refunded)
    // It is what makes the terminal states terminal for this instruction.
    require!(task.state == TaskState::Open, RubricError::InvalidState);

    // The work window is a promise to the poster that their capital is not
    // locked indefinitely. Past the deadline, only `reclaim_expired` applies.
    let now = Clock::get()?.unix_timestamp;
    require!(now <= task.deadline, RubricError::DeadlinePassed);

    // An all-zero submission hash is what a buggy client sends when it forgets
    // to hash. Refuse it rather than recording a meaningless commitment.
    require!(submission_hash != ZERO_HASH, RubricError::EmptyHash);

    task.worker = Some(ctx.accounts.worker.key());
    task.submission_hash = Some(submission_hash);
    task.state = TaskState::Submitted;

    msg!(
        "Work submitted. task_id={} worker={}",
        task.task_id,
        ctx.accounts.worker.key()
    );
    Ok(())
}
