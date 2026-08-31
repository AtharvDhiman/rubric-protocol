//! `create_task` - seal a rubric and fund its escrow, in one transaction.
//!
//! This is the instruction that creates the product's core guarantee. The clause
//! hash and the money land together, atomically. There is no window in which a
//! task exists with editable criteria, and no instruction anywhere in this
//! program mutates `rubric_hash` afterwards.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{CONFIG_SEED, MAX_BOUNTY, MAX_WORK_WINDOW_SECONDS, TASK_SEED, ZERO_HASH};
use crate::errors::RubricError;
use crate::state::{Config, Task, TaskState};

#[derive(Accounts)]
#[instruction(task_id: u64)]
pub struct CreateTask<'info> {
    /// The poster. Signs, pays rent for the Task and escrow accounts, and is the
    /// source of the bounty.
    #[account(mut)]
    pub creator: Signer<'info>,

    /// The singleton Config. Read-only here; we only need it to exist so that a
    /// task cannot be created against an uninitialized protocol.
    ///
    /// Re-derived from its seeds so a caller cannot pass a look-alike account.
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// The Task PDA at seeds `[b"task", creator, task_id]`.
    ///
    /// `init` means this fails if the task already exists, so a task id can never
    /// be reused to overwrite a live escrow. Including `creator` in the seeds
    /// means two posters can both use `task_id = 1` without colliding, and no
    /// poster can squat on another's id. The address is derived by the program,
    /// so the caller cannot point this at an account they control.
    #[account(
        init,
        payer = creator,
        space = 8 + Task::INIT_SPACE,
        seeds = [TASK_SEED, creator.key().as_ref(), task_id.to_le_bytes().as_ref()],
        bump
    )]
    pub task: Account<'info, Task>,

    /// The SPL token the bounty is denominated in - USDC in production.
    ///
    /// `address = config.bounty_mint` pins it to the single mint this deployment
    /// was configured for. It is passed in rather than hardcoded so the same
    /// program works with devnet and mainnet USDC without a code change, but it
    /// is NOT free choice: without this constraint a poster could escrow a token
    /// they minted themselves, and `MAX_BOUNTY` - which is denominated in base
    /// units and assumes 6 decimals - would stop meaning what it says.
    #[account(address = config.bounty_mint @ RubricError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    /// The poster's own token account, which the bounty comes out of.
    ///
    /// The `associated_token::*` constraints require this to be exactly the
    /// canonical ATA for (creator, mint). That means we are provably debiting the
    /// signer's own account and not some third party's account they happened to
    /// pass in.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// THE ESCROW. An associated token account owned by the Task PDA.
    ///
    /// This is the most important constraint in the instruction. The address is
    /// DERIVED from (task, mint) - it is never accepted as an arbitrary account
    /// from the client. Without this, an attacker could pass their own token
    /// account as "the escrow", have the bounty deposited straight into their
    /// wallet, and leave the task looking funded.
    ///
    /// Its authority is the Task PDA, which has no private key. Only this program
    /// can move these tokens, and only through `submit_verdict` or
    /// `reclaim_expired`.
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = task,
    )]
    pub escrow: Account<'info, TokenAccount>,

    /// Anchor verifies these are the real SPL Token, Associated Token and System
    /// programs. Passing a counterfeit "token program" that fakes a transfer is a
    /// classic Solana attack; these three type checks close it.
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateTask>,
    task_id: u64,
    rubric_hash: [u8; 32],
    bounty_amount: u64,
    deadline: i64,
) -> Result<()> {
    // ---- Validate the money ------------------------------------------------
    // A zero bounty is not an escrow. Reject it rather than creating a task that
    // can never pay anyone.
    require!(bounty_amount > 0, RubricError::AmountZero);

    // MVP blast-radius cap. The protocol is unaudited and runs on one verifier
    // key; this constant bounds what a single task can lose.
    require!(bounty_amount <= MAX_BOUNTY, RubricError::AmountTooLarge);

    // ---- Validate the commitment ------------------------------------------
    // An all-zero hash would mean the poster committed to nothing, which would
    // make the sealed-criteria guarantee meaningless. It is also what you get if
    // a client forgets to fill the field in.
    require!(rubric_hash != ZERO_HASH, RubricError::EmptyHash);

    // ---- Validate the clock ------------------------------------------------
    let now = Clock::get()?.unix_timestamp;

    // A deadline already in the past would create a task that is born
    // un-submittable and immediately reclaimable.
    require!(deadline > now, RubricError::DeadlineInPast);

    // And a deadline far in the future would let a poster lock escrow up
    // effectively forever if no worker ever submits.
    let max_deadline = now
        .checked_add(MAX_WORK_WINDOW_SECONDS)
        .ok_or(RubricError::MathOverflow)?;
    require!(deadline <= max_deadline, RubricError::DeadlineTooFar);

    // ---- Move the money ----------------------------------------------------
    // Do this BEFORE writing the task state, so that if the transfer fails the
    // whole transaction reverts and no half-funded task exists. (Solana reverts
    // everything on error anyway; the ordering is for readability.)
    //
    // `transfer_checked` rather than the deprecated `transfer`: it re-verifies
    // the mint and decimals inside the token program, which prevents a
    // decimals-confusion attack where a token account for a different mint is
    // passed and the amount is silently misinterpreted.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.creator_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
                // The creator signed this transaction, so they authorize the debit.
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        bounty_amount,
        ctx.accounts.mint.decimals,
    )?;

    // ---- Seal ---------------------------------------------------------------
    let task = &mut ctx.accounts.task;
    task.creator = ctx.accounts.creator.key();
    task.task_id = task_id;
    task.worker = None;
    task.mint = ctx.accounts.mint.key();
    task.rubric_hash = rubric_hash;
    task.submission_hash = None;
    task.bounty_amount = bounty_amount;
    task.deadline = deadline;
    task.state = TaskState::Open;
    task.verdict = None;
    // Store the canonical bump so later instructions can sign as this PDA
    // without trusting a bump supplied by whoever builds the transaction.
    task.bump = ctx.bumps.task;

    // Deliberately does NOT log the rubric hash. Formatting 32 bytes as hex cost
    // 33 heap allocations from the bump allocator (which never frees) and 32
    // trips through core::fmt, on the compute budget of the instruction that
    // also creates two accounts and does a token CPI - all to print something
    // already readable in the account data.
    msg!(
        "Task sealed. id={} bounty={} deadline={}",
        task_id,
        bounty_amount,
        deadline
    );
    Ok(())
}
