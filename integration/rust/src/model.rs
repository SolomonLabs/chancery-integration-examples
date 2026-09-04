use chancery_reference::InstructionDocument;
use serde::Serialize;
use solana_sdk::{instruction::Instruction, pubkey::Pubkey};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MarketMakerSettlementAction {
    Mint,
    Redeem,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PreparedMarketMakerSettlement {
    pub action: MarketMakerSettlementAction,
    pub principal: Pubkey,
    pub input_amount: u64,
    pub minimum_output: u64,
    pub instruction: Instruction,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMarketMakerSettlementDocument {
    pub action: MarketMakerSettlementAction,
    pub principal: String,
    pub input_amount: String,
    pub minimum_output: String,
    pub instruction: InstructionDocument,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettlementSimulationResult {
    Accepted,
    Rejected { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettlementConfirmationResult {
    Confirmed,
    Rejected { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutedMarketMakerSettlement {
    pub action: MarketMakerSettlementAction,
    pub signature: String,
}
