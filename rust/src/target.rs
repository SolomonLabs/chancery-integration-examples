use std::env;

use solana_sdk::{pubkey, pubkey::Pubkey};

use crate::{CHANCERY_PROGRAM_ID, IntegrationError};

pub const CHANCERY_DEVNET_PROGRAM_ID: Pubkey = pubkey!("3doMTb5u94mzTDoBbyJXbZscNE3suuQe75ybYmirKute");

pub fn program_id_for_target(target: &str) -> Result<Pubkey, IntegrationError> {
    match target {
        "mainnet" => Ok(CHANCERY_PROGRAM_ID),
        "devnet" => Ok(CHANCERY_DEVNET_PROGRAM_ID),
        _ => Err(IntegrationError::new("CHANCERY_TARGET must be mainnet or devnet")),
    }
}

pub fn selected_program_id() -> Result<Pubkey, IntegrationError> {
    match env::var("CHANCERY_TARGET") {
        Ok(target) => program_id_for_target(&target),
        Err(env::VarError::NotPresent) => Ok(CHANCERY_PROGRAM_ID),
        Err(env::VarError::NotUnicode(_)) => Err(IntegrationError::new("CHANCERY_TARGET must be UTF-8")),
    }
}
