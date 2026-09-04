use chancery_reference::{
    IntegrationError,
    MintDirectAccounts,
    MintDirectArguments,
    RedeemDirectAccounts,
    RedeemDirectArguments,
    build_mint_direct_instruction,
    build_redeem_direct_instruction,
    mint_instruction_to_document,
    redeem_instruction_to_document,
};

use crate::{
    MarketMakerSettlementAction,
    PreparedMarketMakerSettlement,
    PreparedMarketMakerSettlementDocument,
};

pub fn prepare_market_maker_mint(
    accounts: &MintDirectAccounts,
    arguments: &MintDirectArguments,
) -> Result<PreparedMarketMakerSettlement, IntegrationError> {
    Ok(PreparedMarketMakerSettlement {
        action: MarketMakerSettlementAction::Mint,
        principal: accounts.principal,
        input_amount: arguments.asset_amount,
        minimum_output: arguments.minimum_issued_token_amount,
        instruction: build_mint_direct_instruction(accounts, arguments)?,
    })
}

pub fn prepare_market_maker_redeem(
    accounts: &RedeemDirectAccounts,
    arguments: &RedeemDirectArguments,
) -> Result<PreparedMarketMakerSettlement, IntegrationError> {
    Ok(PreparedMarketMakerSettlement {
        action: MarketMakerSettlementAction::Redeem,
        principal: accounts.principal,
        input_amount: arguments.issued_token_amount,
        minimum_output: arguments.minimum_asset_amount,
        instruction: build_redeem_direct_instruction(accounts, arguments)?,
    })
}

pub fn prepared_settlement_to_document(
    settlement: &PreparedMarketMakerSettlement,
) -> Result<PreparedMarketMakerSettlementDocument, IntegrationError> {
    let instruction = match settlement.action {
        MarketMakerSettlementAction::Mint => {
            mint_instruction_to_document(&settlement.instruction)?
        }
        MarketMakerSettlementAction::Redeem => {
            redeem_instruction_to_document(&settlement.instruction)?
        }
    };

    Ok(PreparedMarketMakerSettlementDocument {
        action: settlement.action,
        principal: settlement.principal.to_string(),
        input_amount: settlement.input_amount.to_string(),
        minimum_output: settlement.minimum_output.to_string(),
        instruction,
    })
}
