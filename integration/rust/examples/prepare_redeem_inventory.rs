use std::{env, error::Error};

use chancery_market_maker_integration_rust::{
    prepare_market_maker_redeem,
    prepared_settlement_to_document,
};
use chancery_reference::{IntegrationError, load_redeem_direct_operation};

fn main() -> Result<(), Box<dyn Error>> {
    let operation_file = env::args_os().nth(1).ok_or_else(|| {
        IntegrationError::new(
            "Usage: prepare_redeem_inventory <direct-redeem.operation.json>",
        )
    })?;
    let (accounts, arguments) = load_redeem_direct_operation(operation_file)?;
    let settlement = prepare_market_maker_redeem(&accounts, &arguments)?;
    let document = prepared_settlement_to_document(&settlement)?;
    println!("{}", serde_json::to_string_pretty(&document)?);
    Ok(())
}
