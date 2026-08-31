//! `reclaim_expired` - the poster takes back a bounty nobody resolved.
//!
//! This is the only way money leaves a task without a verdict, and it is
//! deliberately narrow. Two doors, and nothing else:
//!
//!   1. `Open` and past the deadline. Nobody submitted; the money goes home.
//!   2. `Submitted` and past the deadline PLUS `VERDICT_GRACE_SECONDS`. A worker
//!      claimed the task but the verifier never ruled on it.
//!
//! Door 2 needs justifying, because it looks like a hole in the promise that a
//! poster cannot receive good work and then yank the bounty back. It is not, for
//! two reasons: it only opens a full week after the work window closed, and a
//! verdict takes seconds, so in normal operation it is unreachable. What it
//! prevents is much worse than what it risks. Anyone may call `submit_work`, so
//! anyone can push every open task into `Submitted`; without door 2, only the
//! verifier key could ever move them out again, and a griefer plus a lost or
//! offline verifier key would freeze every escrow in the protocol permanently.
//! A one-key liveness dependency on an unaudited MVP is not acceptable, so the
//! poster gets a slow escape hatch.
//!
//! `submit_verdict` has no deadline check, so the verifier can still rule
//! normally at any point inside the grace window.

use anchor_lang::prelude::*;
use anchor_spl::token::{
    close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
};

use crate::constants::{TASK_SEED, VERDICT_GRACE_SECONDS};
use crate::errors::RubricError;
use crate::state::{Task, TaskState};

#[derive(Accounts)]
pub struct ReclaimExpired<'info> {
    /// The poster. Must be the creator recorded on the task - enforced by
    /// `has_one = creator` below, so a stranger cannot reclaim someone else's
    /// expired bounty into their own wallet.
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The expired task.
    ///
    /// Re-derived from its seeds with the stored bump so it is provably one of
    /// ours. `has_one = creator` ties it to the signer above.
    #[account(
        mut,
        seeds = [TASK_SEED, task.creator.as_ref(), task.task_id.to_le_bytes().as_ref()],
        bump = task.bump,
        has_one = creator @ RubricError::CreatorMismatch
    )]
    pub task: Account<'info, Task>,

    /// Pinned to the mint recorded at creation, so the refund is denominated in
    /// the token that was actually escrowed.
    #[account(address = task.mint @ RubricError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    /// THE ESCROW. Derived from (task, mint), never accepted from the caller, so
    /// this instruction provably drains the task's own escrow and nothing else.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = task,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// Where the refund lands. Derived as the canonical ATA for (creator, mint),
    /// so the poster cannot redirect it and nobody can redirect it for them.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// Anchor verifies this is the genuine SPL Token program.
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReclaimExpired>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let deadline = ctx.accounts.task.deadline;

    // The state machine, and the clock, in one place.
    //
    // Note what is NOT here: `Settled` and `Refunded` fall through to the catch-
    // all and are rejected, so the terminal states stay terminal for this
    // instruction too. There is no arm that accepts them.
    match ctx.accounts.task.state {
        // Nobody submitted. The work window must actually have closed - without
        // that check a poster could fund a task and immediately pull the money
        // back out, which would make every open bounty on the docket a lie.
        TaskState::Open => {
            require!(now > deadline, RubricError::DeadlineNotPassed);
        }
        // A worker claimed it but no verdict ever landed. The poster waits a
        // further grace period on top of the deadline before the escape hatch
        // opens. See the module comment for why this door exists at all.
        TaskState::Submitted => {
            let grace_end = deadline
                .checked_add(VERDICT_GRACE_SECONDS)
                .ok_or(RubricError::MathOverflow)?;
            require!(now > grace_end, RubricError::DeadlineNotPassed);
        }
        TaskState::Settled | TaskState::Refunded => {
            return Err(RubricError::InvalidState.into());
        }
    }

    // Drain whatever is actually in the escrow, not just the recorded bounty, so
    // that any stray tokens sent to the account come back too and the account can
    // be closed cleanly.
    let amount = ctx.accounts.escrow.amount;
    let decimals = ctx.accounts.mint.decimals;

    let creator_key = ctx.accounts.task.creator;
    let task_id_bytes = ctx.accounts.task.task_id.to_le_bytes();
    let task_bump = ctx.accounts.task.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TASK_SEED,
        creator_key.as_ref(),
        task_id_bytes.as_ref(),
        &[task_bump],
    ]];

    if amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    // The Task PDA owns the escrow; the program signs as it.
                    authority: ctx.accounts.task.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            decimals,
        )?;
    }

    // Close the empty escrow and return its rent to the creator, who paid it.
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.task.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Terminal. No instruction accepts a Refunded task, so this task is finished.
    let task = &mut ctx.accounts.task;
    task.state = TaskState::Refunded;

    msg!(
        "Expired task reclaimed. task_id={} refunded={}",
        task.task_id,
        amount
    );
    // NOTE: a task reclaimed out of `Submitted` records no verdict. That is
    // correct - nobody ruled on it - and the off-chain record shows it as
    // refunded on a timeout rather than on the merits.
    Ok(())
}
