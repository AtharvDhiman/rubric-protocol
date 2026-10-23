//! `initialize_limits` - create the singleton `Limits` account.
//!
//! Run once per deployment, by the admin, after `initialize_config`. On a
//! deployment that predates `Limits` this is the one-time setup step that must
//! happen before ANY task can be created: `create_task` requires the account, so
//! an upgraded program with no `Limits` refuses every new task until this runs.
//! That is deliberate. The alternative - treating a missing account as "no cap" -
//! would let the cap be bypassed simply by leaving it out.
//!
//! It starts UNPAUSED. A cap is the only thing the admin chooses here; pausing is
//! a separate, deliberate act (`set_paused`).

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, LIMITS_SEED};
use crate::errors::RubricError;
use crate::state::{Config, Limits};

#[derive(Accounts)]
pub struct InitializeLimits<'info> {
    /// Must be the admin recorded in Config. Signs, and pays the rent for the new
    /// account.
    ///
    /// `mut` because lamports leave this account to fund `limits`. `Signer`
    /// proves this key authorised the transaction; the `has_one` on `config`
    /// below proves it is the RIGHT key.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The singleton Config, read only to check who the admin is.
    ///
    /// `seeds` + `bump = config.bump` re-derive the one legitimate config address
    /// so a look-alike (naming the attacker as admin) cannot be substituted.
    /// `has_one = admin` requires `config.admin == admin.key()`: this is the check
    /// that stops a stranger setting the protocol's limits.
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RubricError::NotAdmin
    )]
    pub config: Account<'info, Config>,

    /// The Limits PDA at seeds `[b"limits"]`.
    ///
    /// `init` means this can only ever succeed once: creating an account that
    /// already exists fails at the system-program level, so the limits cannot be
    /// re-initialised to quietly reset the cap or un-pause the protocol. `seeds`
    /// + `bump` mean the address is derived by the program, not chosen by the
    /// caller, so there is exactly one and `create_task` can find it. `space` is
    /// 8 bytes of Anchor discriminator plus the derived struct size.
    #[account(
        init,
        payer = admin,
        space = 8 + Limits::INIT_SPACE,
        seeds = [LIMITS_SEED],
        bump
    )]
    pub limits: Account<'info, Limits>,

    /// Required by `init` to allocate the account. Anchor checks the address really
    /// is the system program, so a fake one cannot be passed.
    pub system_program: Program<'info, System>,
}

pub fn initialize_limits_handler(ctx: Context<InitializeLimits>, max_bounty: u64) -> Result<()> {
    // Positive, and no more than the compile-time ceiling. The same check
    // `set_max_bounty` runs, from the same function.
    Limits::validate_max_bounty(max_bounty)?;

    let limits = &mut ctx.accounts.limits;
    limits.max_bounty = max_bounty;
    limits.paused = false;
    // Store the canonical bump Anchor just derived; `create_task` re-derives with
    // this stored value rather than accepting a bump from the caller.
    limits.bump = ctx.bumps.limits;

    msg!("Limits initialised. max_bounty={} paused=false", max_bounty);
    Ok(())
}
