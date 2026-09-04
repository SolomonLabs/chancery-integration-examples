use std::path::PathBuf;

use chancery_market_maker_integration_rust::{
    MarketMakerSettlementAction,
    MarketMakerSettlementExecutionPort,
    PreparedMarketMakerSettlement,
    SettlementConfirmationResult,
    SettlementExecutionStage,
    SettlementSimulationResult,
    execute_prepared_market_maker_settlement,
    prepare_market_maker_mint,
    prepare_market_maker_redeem,
    prepared_settlement_to_document,
};
use chancery_reference::{
    IntegrationError,
    load_mint_direct_operation,
    load_redeem_direct_operation,
};

fn fixtures_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
}

#[test]
fn prepares_market_maker_mint_and_redeem() {
    let (mint_accounts, mint_arguments) = load_mint_direct_operation(
        fixtures_directory().join("direct-mint.operation.json"),
    )
    .expect("mint fixture must parse");
    let mint = prepare_market_maker_mint(&mint_accounts, &mint_arguments)
        .expect("mint settlement must prepare");
    let mint_document = prepared_settlement_to_document(&mint)
        .expect("mint document must build");
    assert_eq!(mint_document.action, MarketMakerSettlementAction::Mint);
    assert_eq!(mint_document.input_amount, "1000000");
    assert_eq!(mint_document.minimum_output, "995000");

    let (redeem_accounts, redeem_arguments) = load_redeem_direct_operation(
        fixtures_directory().join("direct-redeem.operation.json"),
    )
    .expect("redeem fixture must parse");
    let redeem = prepare_market_maker_redeem(&redeem_accounts, &redeem_arguments)
        .expect("redeem settlement must prepare");
    let redeem_document = prepared_settlement_to_document(&redeem)
        .expect("redeem document must build");
    assert_eq!(redeem_document.action, MarketMakerSettlementAction::Redeem);
    assert_eq!(redeem_document.input_amount, "500000");
    assert_eq!(redeem_document.minimum_output, "497000");
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PreparedTransaction {
    identifier: &'static str,
}

#[derive(Default)]
struct AcceptingExecutionPort {
    stages: Vec<&'static str>,
}

impl MarketMakerSettlementExecutionPort for AcceptingExecutionPort {
    type Error = IntegrationError;
    type PreparedTransaction = PreparedTransaction;

    fn prepare_transaction(
        &mut self,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<Self::PreparedTransaction, Self::Error> {
        self.stages.push("prepare");
        Ok(PreparedTransaction {
            identifier: "signed-transaction",
        })
    }

    fn simulate(
        &mut self,
        transaction: &Self::PreparedTransaction,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementSimulationResult, Self::Error> {
        assert_eq!(transaction.identifier, "signed-transaction");
        self.stages.push("simulate");
        Ok(SettlementSimulationResult::Accepted)
    }

    fn submit(
        &mut self,
        transaction: &Self::PreparedTransaction,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<String, Self::Error> {
        assert_eq!(transaction.identifier, "signed-transaction");
        self.stages.push("submit");
        Ok("transaction-signature".to_owned())
    }

    fn confirm(
        &mut self,
        _signature: &str,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementConfirmationResult, Self::Error> {
        self.stages.push("confirm");
        Ok(SettlementConfirmationResult::Confirmed)
    }

    fn reconcile(
        &mut self,
        _signature: &str,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<(), Self::Error> {
        self.stages.push("reconcile");
        Ok(())
    }
}

#[test]
fn reuses_one_prepared_transaction_for_simulation_and_submission() {
    let (accounts, arguments) = load_mint_direct_operation(
        fixtures_directory().join("direct-mint.operation.json"),
    )
    .expect("mint fixture must parse");
    let settlement = prepare_market_maker_mint(&accounts, &arguments)
        .expect("mint settlement must prepare");
    let mut execution_port = AcceptingExecutionPort::default();

    let executed = execute_prepared_market_maker_settlement(
        &settlement,
        &mut execution_port,
    )
    .expect("settlement must execute");

    assert_eq!(executed.signature, "transaction-signature");
    assert_eq!(
        execution_port.stages,
        vec!["prepare", "simulate", "submit", "confirm", "reconcile"],
    );
}

struct RejectingSimulationPort;

impl MarketMakerSettlementExecutionPort for RejectingSimulationPort {
    type Error = IntegrationError;
    type PreparedTransaction = PreparedTransaction;

    fn prepare_transaction(
        &mut self,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<Self::PreparedTransaction, Self::Error> {
        Ok(PreparedTransaction {
            identifier: "signed-transaction",
        })
    }

    fn simulate(
        &mut self,
        _transaction: &Self::PreparedTransaction,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementSimulationResult, Self::Error> {
        Ok(SettlementSimulationResult::Rejected {
            reason: "not executable".to_owned(),
        })
    }

    fn submit(
        &mut self,
        _transaction: &Self::PreparedTransaction,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<String, Self::Error> {
        panic!("submission must not run after simulation rejection")
    }

    fn confirm(
        &mut self,
        _signature: &str,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<SettlementConfirmationResult, Self::Error> {
        panic!("confirmation must not run after simulation rejection")
    }

    fn reconcile(
        &mut self,
        _signature: &str,
        _settlement: &PreparedMarketMakerSettlement,
    ) -> Result<(), Self::Error> {
        panic!("reconciliation must not run after simulation rejection")
    }
}

#[test]
fn simulation_rejection_prevents_submission() {
    let (accounts, arguments) = load_mint_direct_operation(
        fixtures_directory().join("direct-mint.operation.json"),
    )
    .expect("mint fixture must parse");
    let settlement = prepare_market_maker_mint(&accounts, &arguments)
        .expect("mint settlement must prepare");
    let mut execution_port = RejectingSimulationPort;

    let error = execute_prepared_market_maker_settlement(
        &settlement,
        &mut execution_port,
    )
    .expect_err("simulation rejection must fail");

    assert_eq!(error.stage, SettlementExecutionStage::Simulation);
    assert_eq!(error.signature, None);
}
