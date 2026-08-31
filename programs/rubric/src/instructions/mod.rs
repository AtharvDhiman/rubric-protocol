pub mod create_task;
pub mod initialize_config;
pub mod reclaim_expired;
pub mod set_verifier_authority;
pub mod submit_verdict;
pub mod submit_work;

// These globs are REQUIRED, not stylistic. `#[derive(Accounts)]` generates
// hidden `__client_accounts_*` and `__cpi_client_accounts_*` modules alongside
// each struct, and the `#[program]` macro resolves them through this re-export.
// Narrowing these to `pub use create_task::CreateTask;` fails to compile with
// "unresolved import `crate`" from inside the macro expansion.
//
// Each handler is named after its instruction rather than all six being called
// `handler`, which would make the name ambiguous across these globs.
pub use create_task::*;
pub use initialize_config::*;
pub use reclaim_expired::*;
pub use set_verifier_authority::*;
pub use submit_verdict::*;
pub use submit_work::*;
