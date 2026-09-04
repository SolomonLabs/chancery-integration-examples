use std::{env, error::Error};

use chancery_reference::{
    IntegrationError,
    build_mint_direct_instruction,
    load_mint_direct_operation,
    mint_instruction_to_document,
};

fn main() -> Result<(), Box<dyn Error>> {
    let operation_file = env::args_os().nth(1).ok_or_else(|| {
        IntegrationError::new("Usage: build_mint <direct-mint.operation.json>")
    })?;
    let (accounts, arguments) = load_mint_direct_operation(operation_file)?;
    let instruction = build_mint_direct_instruction(&accounts, &arguments)?;
    let document = mint_instruction_to_document(&instruction)?;
    println!("{}", serde_json::to_string_pretty(&document)?);
    Ok(())
}
