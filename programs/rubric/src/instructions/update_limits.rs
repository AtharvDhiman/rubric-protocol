//! `set_max_bounty` and `set_paused` - the admin's two levers on NEW tasks.
//!
//! They are two instructions rather than one `set_limits(max_bounty, paused)` on
//! purpose. The pause switch is an incident lever, used in a hurry and possibly
//! under stress. A single call that also takes the cap would force the admin to
//! restate it in the same breath, and a mistyped cap during an incident is the
//! last thing wanted. `set_paused` takes one boolean and can change nothing else.
//!
//! Both share one account list, so the access check is written once.
//!
//! NEITHER CAN TRAP MONEY. They govern `create_task` and nothing else:
//! `submit_work`, `submit_verdict` and `reclaim_expired` never read `Limits`, so a
//! paused protocol still settles, refunds and reclaims everything already in
//! escrow. Lowering the cap does not touch tasks that already exist.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LIMITS_SEED};
use crate::errors::RubricError;
use crate::state::{Config, Limits};

#[derive(Accounts)]
pub struct UpdateLimits<'info> {
    /// Must be the admin recorded in Config.
    ///
    /// `Signer` proves this key authorised the transaction; the `has_one` on
    /// `config` below proves it is the RIGHT key. Both are needed.
    pub admin: Signer<'info>,

    /// The singleton Config, read only to check who the admin is.
    ///
    /// `seeds` + `bump = config.bump` re-derive the one legitimate config address
    /// and reject a look-alike. `has_one = admin` requires
    /// `config.admin == admin.key()`, so a stranger who signs cannot change the
    /// limits - this is the check that makes both instructions safe.
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RubricError::NotAdmin
    )]
    pub config: Account<'info, Config>,

    /// The singleton Limits being changed.
    ///
    /// Re-derived from its seeds with the stored bump, so it is provably the one
    /// account `create_task` reads and not a look-alike. `mut` because a field is
    /// written.
    #[account(
        mut,
        seeds = [LIMITS_SEED],
        bump = limits.bump
    )]
    pub limits: Account<'info, Limits>,
}

pub fn set_max_bounty_handler(ctx: Context<UpdateLimits>, max_bounty: u64) -> Result<()> {
    // Positive, and no more than the compile-time ceiling: even a compromised admin
    // cannot make the cap unbounded.
    Limits::validate_max_bounty(max_bounty)?;

    let limits = &mut ctx.accounts.limits;
    let previous = limits.max_bounty;
    limits.max_bounty = max_bounty;

    msg!("Max bounty changed: {} -> {}", previous, max_bounty);
    Ok(())
}

pub fn set_paused_handler(ctx: Context<UpdateLimits>, paused: bool) -> Result<()> {
    let limits = &mut ctx.accounts.limits;
    limits.paused = paused;

    msg!("New tasks paused: {}", paused);
    Ok(())
}
