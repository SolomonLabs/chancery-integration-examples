use std::{error::Error, fmt};

use crate::{
    ExecutedMarketMakerSettlement,
    PreparedMarketMakerSettlement,
    SettlementConfirmationResult,
    SettlementSimulationResult,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlementExecutionStage {
    Preparation,
    Simulation,
    Submission,
    Confirmation,
    Reconciliation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementExecutionError {
    pub stage: SettlementExecutionStage,
    pub signature: Option<String>,
    message: String,
}

impl SettlementExecutionError {
    pub fn new(
        stage: SettlementExecutionStage,
        message: impl Into<String>,
        signature: Option<String>,
    ) -> Self {
        Self {
            stage,
            signature,
            message: message.into(),
        }
    }
}

impl fmt::Display for SettlementExecutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for SettlementExecutionError {}

pub trait MarketMakerSettlementExecutionPort {
    type Error: Error;
    type PreparedTransaction;

    fn prepare_transaction(
        &mut self,
        settlement: &PreparedMarketMakerSettlement,
    ) -> Result<Self::PreparedTransaction, Self::Error>;

    fn simulate(
        &mut self,
        transaction: &Self::PreparedTransaction,
        settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementSimulationResult, Self::Error>;

    fn submit(
        &mut self,
        transaction: &Self::PreparedTransaction,
        settlement: &PreparedMarketMakerSettlement,
    ) -> Result<String, Self::Error>;

    fn confirm(
        &mut self,
        signature: &str,
        settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementConfirmationResult, Self::Error>;

    fn reconcile(
        &mut self,
        signature: &str,
        settlement: &PreparedMarketMakerSettlement,
    ) -> Result<(), Self::Error>;
}

pub fn execute_prepared_market_maker_settlement<ExecutionPort>(
    settlement: &PreparedMarketMakerSettlement,
    execution_port: &mut ExecutionPort,
) -> Result<ExecutedMarketMakerSettlement, SettlementExecutionError>
where
    ExecutionPort: MarketMakerSettlementExecutionPort,
{
    let transaction = execution_port
        .prepare_transaction(settlement)
        .map_err(|error| {
            SettlementExecutionError::new(
                SettlementExecutionStage::Preparation,
                error.to_string(),
                None,
            )
        })?;

    let simulation = execution_port
        .simulate(&transaction, settlement)
        .map_err(|error| {
            SettlementExecutionError::new(
                SettlementExecutionStage::Simulation,
                error.to_string(),
                None,
            )
        })?;
    if let SettlementSimulationResult::Rejected { reason } = simulation {
        return Err(SettlementExecutionError::new(
            SettlementExecutionStage::Simulation,
            reason,
            None,
        ));
    }

    let signature = execution_port
        .submit(&transaction, settlement)
        .map_err(|error| {
            SettlementExecutionError::new(
                SettlementExecutionStage::Submission,
                error.to_string(),
                None,
            )
        })?;
    if signature.trim().is_empty() {
        return Err(SettlementExecutionError::new(
            SettlementExecutionStage::Submission,
            "Settlement submission returned an empty transaction signature",
            None,
        ));
    }

    let confirmation = execution_port
        .confirm(&signature, settlement)
        .map_err(|error| {
            SettlementExecutionError::new(
                SettlementExecutionStage::Confirmation,
                error.to_string(),
                Some(signature.clone()),
            )
        })?;
    if let SettlementConfirmationResult::Rejected { reason } = confirmation {
        return Err(SettlementExecutionError::new(
            SettlementExecutionStage::Confirmation,
            reason,
            Some(signature),
        ));
    }

    execution_port
        .reconcile(&signature, settlement)
        .map_err(|error| {
            SettlementExecutionError::new(
                SettlementExecutionStage::Reconciliation,
                error.to_string(),
                Some(signature.clone()),
            )
        })?;

    Ok(ExecutedMarketMakerSettlement {
        action: settlement.action,
        signature,
    })
}
