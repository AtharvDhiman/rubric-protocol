//! `set_fee_destination` - change which wallet collects the protocol fee.
//!
//! WHY THIS EXISTS
//! ---------------
//! `fee_destination` used to be set once, in `initialize_config`, and never again.
//! That is fine until the account it points at stops being usable. Mainnet USDC's
//! mint has a freeze authority, and the SPL Token program refuses a transfer into
//! a frozen account. Every approved verdict pays the fee as part of the same
//! instruction, so one frozen fee account would make EVERY approval revert: the
//! worker is not paid, the task sits in `Submitted`, and a week after the
//! deadline the poster reclaims the whole bounty for work that was approved. With
//! no way to change the destination, the only remedy was redeploying the program
//! under a new id and abandoning every task PDA. (docs/security-review.md, R-03)
//!
//! WHAT IT CAN AND CANNOT DO
//! -------------------------
//! It moves no money and touches no task. It changes one field on `Config`, and
//! only for verdicts that happen AFTER it lands - a task already settled keeps the
//! fee it paid. The admin can already install any verifier, so the power added
//! here is small and bounded: at most `fee_bps` (itself capped at 10% and not
//! changeable) of future bounties can be redirected.
//!
//! It deliberately does NOT validate that the destination has a USDC token
//! account. The verifier creates a missing one in the same transaction as the
//! verdict, and the program cannot create it for itself here without taking on
//! the payer and the mint.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::RubricError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetFeeDestination<'info> {
    /// Must be the admin recorded in Config.
    ///
    /// `Signer` proves this key authorised the transaction. The `has_one`
    /// constraint on `config` below proves it is the RIGHT key. Both are needed: a
    /// signature from the wrong key, or the right key without a signature, both
    /// fail.
    pub admin: Signer<'info>,

    /// The singleton Config.
    ///
    /// `seeds` + `bump = config.bump` re-derive the one legitimate config address
    /// and reject any look-alike account. `has_one = admin` requires
    /// `config.admin == admin.key()`, so a stranger who signs cannot redirect the
    /// protocol's fees - this is the check that makes the instruction safe.
    /// `mut` because the destination is written.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RubricError::NotAdmin
    )]
    pub config: Account<'info, Config>,
}

pub fn set_fee_destination_handler(
    ctx: Context<SetFeeDestination>,
    new_fee_destination: Pubkey,
) -> Result<()> {
    // The all-zero key is what an uninitialised client field or a dropped
    // argument looks like. It is not a wallet anyone controls, and fees sent to
    // its token account would be unrecoverable, so refuse it rather than burn the
    // protocol's revenue on a typo.
    require!(
        new_fee_destination != Pubkey::default(),
        RubricError::InvalidFeeDestination
    );

    let config = &mut ctx.accounts.config;
    let previous = config.fee_destination;
    config.fee_destination = new_fee_destination;

    msg!(
        "Fee destination changed: {} -> {}",
        previous,
        new_fee_destination
    );
    Ok(())
}
