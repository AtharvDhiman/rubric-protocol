//! `initialize_config` - create the singleton protocol config.
//!
//! Run exactly once per deployment, by whoever deployed the program.
//!
//! THIS INSTRUCTION IS A LAND-GRAB TARGET. It creates the account that names the
//! verifier authority, and `init` means only the first caller ever succeeds. An
//! earlier version accepted any signer as `admin`, which meant anyone watching
//! the chain could call it between `anchor deploy` and the operator's own init
//! transaction, install themselves as both admin and verifier authority, and own
//! the protocol permanently - the only remedy being a redeploy under a new
//! program id. The `program` / `program_data` constraints below close that race
//! by requiring the signer to be the program's upgrade authority, which only the
//! deployer holds.

use anchor_lang::prelude::*;

use crate::constants::{CONFIG_SEED, MAX_FEE_BPS};
use crate::errors::RubricError;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// The admin. Signs, and pays the rent for the Config account.
    ///
    /// `mut` because lamports leave this account to fund the new one. `Signer`
    /// means the transaction is invalid unless this key actually signed it. On
    /// its own that is not enough - see `program_data` below, which is what ties
    /// this signer to the person who deployed the program.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The Config PDA at seeds `[b"config"]`.
    ///
    /// `init` prevents this from running twice: creating an account that already
    /// exists fails at the system-program level, so the config cannot be
    /// re-initialized to install a different verifier authority. `seeds` + `bump`
    /// mean the address is derived by the program, not chosen by the caller, so
    /// there is exactly one config account and its address is fixed forever.
    /// `space` is 8 bytes of Anchor discriminator plus the derived struct size.
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// This program, used only to find its ProgramData account.
    ///
    /// `Program<'info, Rubric>` makes Anchor check that the account really is
    /// this program, so a caller cannot point it at some other program whose
    /// upgrade authority they happen to hold.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ RubricError::NotAdmin
    )]
    pub program: Program<'info, crate::program::Rubric>,

    /// The program's ProgramData account, which records who may upgrade it.
    ///
    /// THE CHECK THAT CLOSES THE INIT RACE: the signer must be the program's
    /// upgrade authority. Only the deployer holds that key, so nobody can
    /// front-run the operator's initialization transaction.
    ///
    /// Consequence worth knowing: if the program is ever made immutable (upgrade
    /// authority set to None) BEFORE the config is initialized, this instruction
    /// becomes uncallable and the deployment is dead. Initialize first, then make
    /// it immutable.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ RubricError::NotAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    /// Required by `init` to actually allocate the account. Anchor checks that
    /// the address really is the system program, so a fake one cannot be passed.
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    verifier_authority: Pubkey,
    bounty_mint: Pubkey,
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
    config.bounty_mint = bounty_mint;
    config.fee_bps = fee_bps;
    config.fee_destination = fee_destination;
    // Store the canonical bump Anchor just derived. Every later instruction uses
    // this stored value rather than accepting a bump from the caller - a caller
    // supplied bump can point at a different (non-canonical) address.
    config.bump = ctx.bumps.config;

    msg!(
        "Rubric config initialized. verifier_authority={} mint={} fee_bps={}",
        verifier_authority,
        bounty_mint,
        fee_bps
    );
    Ok(())
}
