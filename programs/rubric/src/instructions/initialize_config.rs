//! `initialize_config` - create the singleton protocol config.
//!
//! Run exactly once per deployment. It records who may rule on tasks, what the
//! protocol fee is, and where fees go.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MAX_FEE_BPS};
use crate::errors::RubricError;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// The admin. Signs, and pays the rent for the Config account.
    ///
    /// `mut` because lamports leave this account to fund the new one. `Signer`
    /// means the transaction is invalid unless this key actually signed it - so
    /// nobody can initialize the protocol on someone else's behalf and name
    /// themselves admin.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The Config PDA at seeds `[b"config"]`.
    ///
    /// `init` prevents this from running twice: creating an account that already
    /// exists fails at the system-program level, so the config cannot be
    /// re-initialized by an attacker to install their own verifier authority.
    /// `seeds` + `bump` mean the address is derived by the program, not chosen by
    /// the caller, so there is exactly one config account for this program and
    /// its address is fixed forever. `space` is 8 bytes of Anchor discriminator
    /// plus the derived size of the struct.
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Required by `init` to actually allocate the account. Anchor checks that
    /// the address really is the system program, so a fake one cannot be passed.
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    verifier_authority: Pubkey,
    fee_bps: u16,
    fee_destination: Pubkey,
) -> Result<()> {
    // A fee above 10% would let a misconfigured or malicious admin take most of
    // a worker's bounty. Hard ceiling, checked here and never changeable
    // afterwards because there is no instruction that edits fee_bps.
    require!(fee_bps <= MAX_FEE_BPS, RubricError::FeeTooHigh);

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.verifier_authority = verifier_authority;
    config.fee_bps = fee_bps;
    config.fee_destination = fee_destination;
    // Store the canonical bump Anchor just derived. Every later instruction uses
    // this stored value rather than accepting a bump from the caller - a caller
    // supplied bump can point at a different (non-canonical) address.
    config.bump = ctx.bumps.config;

    msg!(
        "Rubric config initialized. verifier_authority={} fee_bps={}",
        verifier_authority,
        fee_bps
    );
    Ok(())
}
