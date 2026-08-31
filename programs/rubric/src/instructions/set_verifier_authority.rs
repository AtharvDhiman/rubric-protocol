//! `set_verifier_authority` - rotate the key allowed to rule on tasks.
//!
//! The MVP runs a single verifier key. If that key is ever exposed, the admin
//! needs to be able to revoke it in one transaction rather than redeploying the
//! program. This instruction does not touch any task and cannot move money.

use anchor_lang::prelude::*;

use crate::constants::CONFIG_SEED;
use crate::errors::RubricError;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetVerifierAuthority<'info> {
    /// Must be the admin recorded in Config.
    ///
    /// `Signer` proves the key authorized this transaction. The `has_one`
    /// constraint on `config` below is what proves it is the *right* key.
    pub admin: Signer<'info>,

    /// The singleton Config.
    ///
    /// `seeds` + `bump = config.bump` re-derive the one legitimate config address
    /// and reject any substitute account. `has_one = admin` requires
    /// `config.admin == admin.key()`, so a stranger who signs cannot rotate the
    /// verifier - this is the check that makes the instruction safe.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ RubricError::NotAdmin
    )]
    pub config: Account<'info, Config>,
}

pub fn set_verifier_authority_handler(ctx: Context<SetVerifierAuthority>, new_verifier_authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let previous = config.verifier_authority;
    config.verifier_authority = new_verifier_authority;

    msg!(
        "Verifier authority rotated: {} -> {}",
        previous,
        new_verifier_authority
    );
    Ok(())
}
