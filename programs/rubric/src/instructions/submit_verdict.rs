//! `submit_verdict` - rule on a submission and settle the escrow.
//!
//! THIS IS THE MOST SECURITY-CRITICAL INSTRUCTION IN THE PROGRAM. It is the only
//! path by which a submitted task's money moves. If you read one file in this
//! repository closely, make it this one.
//!
//! The security model in three sentences:
//!
//!  1. Only `config.verifier_authority` may sign. That is enforced by a
//!     constraint on the `config` account below, not by an `if` in the handler.
//!  2. The verifier authorizes a *state transition*. It never receives, holds, or
//!     routes the funds - the program moves them, signing as the Task PDA, and
//!     the only two shapes it can move them in are "pay the worker minus fee" and
//!     "refund the poster in full".
//!  3. Every destination account is derived from data recorded on the task at
//!     creation or submission time. None of them is trusted from the caller.

use anchor_lang::prelude::*;
use anchor_spl::token::{
    close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
};

use crate::constants::{BPS_DENOMINATOR, CONFIG_SEED, TASK_SEED, ZERO_HASH};
use crate::errors::RubricError;
use crate::state::{Config, Task, TaskState, VerdictRecord};

#[derive(Accounts)]
pub struct SubmitVerdict<'info> {
    /// The verifier. Must be exactly `config.verifier_authority`.
    ///
    /// `Signer` proves this key authorized the transaction; the `constraint` on
    /// `config` below proves it is the right key. Both are required: a signature
    /// from the wrong key, or the right key without a signature, both fail.
    pub verifier: Signer<'info>,

    /// The singleton Config, re-derived from its seeds so a look-alike config
    /// (with the attacker's key as verifier_authority) cannot be substituted.
    ///
    /// THE CHECK THAT MATTERS: `config.verifier_authority == verifier.key()`.
    /// Nothing else in this program can release escrow, and this line is what
    /// stops anyone else from doing it. If this constraint is ever removed or
    /// weakened, any wallet on Solana can drain every open task.
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.verifier_authority == verifier.key() @ RubricError::NotVerifierAuthority
    )]
    pub config: Account<'info, Config>,

    /// The task being ruled on.
    ///
    /// Re-derived from its seeds with the stored bump, so it is provably a Task
    /// this program created. `has_one = creator` requires the `creator` account
    /// passed below to be the poster recorded at creation - that is what stops a
    /// refund from being routed to an attacker's wallet.
    #[account(
        mut,
        seeds = [TASK_SEED, task.creator.as_ref(), task.task_id.to_le_bytes().as_ref()],
        bump = task.bump,
        has_one = creator @ RubricError::CreatorMismatch
    )]
    pub task: Account<'info, Task>,

    /// The mint recorded on the task.
    ///
    /// Pinned with `address = task.mint`. Without this, a caller could pass a
    /// worthless mint they control, and every token account below would be
    /// derived for that mint instead - paying the worker in fake tokens while the
    /// real USDC stayed in escrow.
    #[account(address = task.mint @ RubricError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    /// THE ESCROW. Derived from (task, mint), never accepted from the caller.
    ///
    /// This is the account being drained, so its derivation is what guarantees we
    /// are draining the right one. Its authority is the Task PDA, so only this
    /// program can sign for it.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = task,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// CHECK: Not read or written - it exists only as the authority that the
    /// worker's token account is derived from. It is pinned to the worker
    /// recorded on the task at `submit_work` time by the `constraint` below, so
    /// the payout cannot be redirected to anyone else.
    #[account(constraint = task.worker == Some(worker.key()) @ RubricError::WorkerMismatch)]
    pub worker: UncheckedAccount<'info>,

    /// Where an approved payout goes.
    ///
    /// Derived as the canonical ATA for (worker, mint). `submit_work` already
    /// required this account to exist, so an approval cannot fail here and strand
    /// the task in `Submitted`.
    ///
    /// `dup` is required because Anchor 1.0 rejects two mutable `Account` fields
    /// that resolve to the same address. That collision is legitimate here: a
    /// poster is allowed to do their own task, in which case this account and
    /// `creator_token_account` are the same one. Without `dup` those tasks would
    /// be permanently unsettleable. It is safe because nothing below re-reads a
    /// cached balance after a transfer - every amount is computed up front.
    #[account(
        mut,
        dup,
        associated_token::mint = mint,
        associated_token::authority = worker,
    )]
    pub worker_token_account: Account<'info, TokenAccount>,

    /// CHECK: Not read or written - the authority the creator's token account is
    /// derived from. Pinned to `task.creator` by the `has_one = creator`
    /// constraint on the task account above.
    pub creator: UncheckedAccount<'info>,

    /// Where a rejected bounty is refunded, and where the escrow account's rent
    /// goes when it is closed (the creator paid that rent at creation).
    ///
    /// `dup` for the same reason as the worker account above: creator, worker and
    /// fee destination are three roles that a single wallet may legitimately hold.
    #[account(
        mut,
        dup,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// CHECK: Not read or written - the authority the fee token account is
    /// derived from. Pinned to `config.fee_destination` so fees cannot be
    /// diverted, not even by the verifier.
    #[account(constraint = config.fee_destination == fee_destination.key() @ RubricError::FeeDestinationMismatch)]
    pub fee_destination: UncheckedAccount<'info>,

    /// Where the protocol fee goes on an approval. Derived from
    /// (config.fee_destination, mint). Must already exist - the admin creates it
    /// once when setting up the protocol.
    ///
    /// `dup` because the fee destination may be the same wallet as the poster or
    /// the worker, especially in local tests.
    #[account(
        mut,
        dup,
        associated_token::mint = mint,
        associated_token::authority = fee_destination,
    )]
    pub fee_destination_token_account: Account<'info, TokenAccount>,

    /// Anchor verifies this is the genuine SPL Token program, so a counterfeit
    /// program cannot be passed to fake the transfers.
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<SubmitVerdict>,
    approved: bool,
    confidence: u8,
    reasoning_hash: [u8; 32],
) -> Result<()> {
    // ---- Guard the state machine ------------------------------------------
    // Only a Submitted task can be ruled on. This one line is what makes the
    // terminal states terminal here: a second call on a Settled or Refunded task
    // finds the wrong state and fails, so escrow cannot be paid out twice.
    require!(
        ctx.accounts.task.state == TaskState::Submitted,
        RubricError::InvalidState
    );

    // ---- Validate the ruling payload --------------------------------------
    require!(confidence <= 100, RubricError::ConfidenceOutOfRange);
    require!(reasoning_hash != ZERO_HASH, RubricError::EmptyHash);

    // Defensive: a Submitted task always has a worker. If it somehow does not,
    // the state machine has a hole and we must not move money.
    require!(ctx.accounts.task.worker.is_some(), RubricError::MissingWorker);

    // ---- Read what we need before taking a mutable borrow -----------------
    let bounty = ctx.accounts.task.bounty_amount;
    let fee_bps = ctx.accounts.config.fee_bps;
    let decimals = ctx.accounts.mint.decimals;
    let escrow_balance = ctx.accounts.escrow.amount;

    // The escrow must hold at least what the task says it does. If it holds less,
    // something has gone badly wrong and we refuse to settle rather than paying
    // out a partial or failing halfway.
    require!(
        escrow_balance >= bounty,
        RubricError::EscrowUnderfunded
    );

    // Anyone can transfer extra tokens into any token account, including this
    // escrow. Track the surplus so the account can be fully drained and closed;
    // it is returned to the creator, who paid the rent.
    let surplus = escrow_balance
        .checked_sub(bounty)
        .ok_or(RubricError::MathOverflow)?;

    // ---- PDA signing seeds -------------------------------------------------
    // The Task PDA owns the escrow, so the program signs as the Task PDA to move
    // the tokens. The bump is the stored canonical one, never a caller-supplied
    // value - a non-canonical bump derives a different address.
    let creator_key = ctx.accounts.task.creator;
    let task_id_bytes = ctx.accounts.task.task_id.to_le_bytes();
    let task_bump = ctx.accounts.task.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        TASK_SEED,
        creator_key.as_ref(),
        task_id_bytes.as_ref(),
        &[task_bump],
    ]];

    if approved {
        // ---- Fee, computed with checked arithmetic -------------------------
        // Multiply first, then divide. Doing it the other way
        // (bounty / 10_000 * fee_bps) truncates to zero for any bounty under
        // 10,000 base units and silently makes the fee free.
        //
        // Integer division truncates, so the fee always rounds DOWN and the
        // rounding remainder goes to the worker. That is the direction we want:
        // the protocol never rounds in its own favour.
        let fee = bounty
            .checked_mul(fee_bps as u64)
            .ok_or(RubricError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(RubricError::MathOverflow)?;

        let payout = bounty.checked_sub(fee).ok_or(RubricError::MathOverflow)?;

        // Pay the worker.
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.worker_token_account.to_account_info(),
                    authority: ctx.accounts.task.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
            decimals,
        )?;

        // Pay the protocol fee. Skipped entirely when fee_bps is 0, so a
        // zero-fee deployment does not need a funded fee account.
        if fee > 0 {
            transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.escrow.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.fee_destination_token_account.to_account_info(),
                        authority: ctx.accounts.task.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee,
                decimals,
            )?;
        }

        msg!(
            "Verdict APPROVED. task_id={} payout={} fee={} confidence={}",
            ctx.accounts.task.task_id,
            payout,
            fee,
            confidence
        );
    } else {
        // Rejection: the poster gets the entire bounty back. No fee is taken on a
        // rejection - the protocol does not profit from work it refused.
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.task.to_account_info(),
                },
                signer_seeds,
            ),
            bounty,
            decimals,
        )?;

        msg!(
            "Verdict REJECTED. task_id={} refunded={} confidence={}",
            ctx.accounts.task.task_id,
            bounty,
            confidence
        );
    }

    // Return any tokens somebody sent to the escrow beyond the bounty. Doing this
    // unconditionally keeps the close below from failing on a non-zero balance.
    if surplus > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.task.to_account_info(),
                },
                signer_seeds,
            ),
            surplus,
            decimals,
        )?;
    }

    // The escrow is empty now. Close it and return its rent to the creator, who
    // paid it. A closed escrow is also a second, structural guarantee that this
    // task can never pay out again.
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.escrow.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.task.to_account_info(),
        },
        signer_seeds,
    ))?;

    // ---- Record the ruling and enter a terminal state ----------------------
    let now = Clock::get()?.unix_timestamp;
    let task = &mut ctx.accounts.task;
    task.verdict = Some(VerdictRecord {
        approved,
        confidence,
        reasoning_hash,
        decided_at: now,
    });
    task.state = if approved {
        TaskState::Settled
    } else {
        TaskState::Refunded
    };

    Ok(())
}
