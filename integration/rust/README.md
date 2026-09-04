# Rust market-maker integration

This crate provides the market-maker execution boundary for authorized external entities using Chancery mint_direct and redeem_direct pathways. It uses the top-level rust reference crate for exact instruction construction and adds preparation, simulation, submission, confirmation, and reconciliation contracts.

Read ../MARKET-MAKER-INTEGRATION.md, ../OPERATION-DOCUMENT.md, ../DIRECT-SETTLEMENT.md, and ../PRODUCTION-OPERATIONS.md before production use.

## Structure

- src/market_maker_settlement.rs converts typed direct-settlement inputs into a prepared market-maker settlement.
- src/model.rs defines actions, prepared settlements, host results, and completed settlements.
- src/settlement_execution.rs defines the host transaction execution trait and ordered lifecycle.
- examples/prepare_mint_inventory.rs prepares a mint from an operation document.
- examples/prepare_redeem_inventory.rs prepares a redeem from an operation document.
- tests/market_maker_settlement.rs covers preparation, exact prepared-transaction reuse, and simulation rejection.

The exact instruction encoding remains in ../../rust so the protocol reference and the market-maker orchestration boundary remain separate.

## Requirements

Rust 1.85 or newer.

From this directory:

~~~sh
cargo run --example prepare_mint_inventory -- ../fixtures/direct-mint.operation.json
cargo run --example prepare_redeem_inventory -- ../fixtures/direct-redeem.operation.json
cargo test
~~~

The examples emit normalized settlement and instruction documents for the host transaction pipeline. The fixture addresses are synthetic.

## Prepare mint inventory

~~~rust
use chancery_market_maker_integration_rust::prepare_market_maker_mint;
use chancery_reference::load_mint_direct_operation;

let (accounts, arguments) =
    load_mint_direct_operation("direct-mint.operation.json")?;
let settlement = prepare_market_maker_mint(&accounts, &arguments)?;
~~~

For mint, input_amount is the raw reserve-asset input and minimum_output is the minimum raw issued-token receipt.

## Prepare redemption inventory

~~~rust
use chancery_market_maker_integration_rust::prepare_market_maker_redeem;
use chancery_reference::load_redeem_direct_operation;

let (accounts, arguments) =
    load_redeem_direct_operation("direct-redeem.operation.json")?;
let settlement = prepare_market_maker_redeem(&accounts, &arguments)?;
~~~

For redeem, input_amount is the raw issued-token input and minimum_output is the minimum raw reserve-asset receipt.

## Host transaction adapter

Implement MarketMakerSettlementExecutionPort with the entity's existing transaction facilities. PreparedTransaction is the host's compiled and signed transaction representation.

~~~rust
trait MarketMakerSettlementExecutionPort {
    type Error: std::error::Error;
    type PreparedTransaction;

    fn prepare_transaction(&mut self, settlement: &PreparedMarketMakerSettlement)
        -> Result<Self::PreparedTransaction, Self::Error>;
    fn simulate(&mut self, transaction: &Self::PreparedTransaction, settlement: &PreparedMarketMakerSettlement)
        -> Result<SettlementSimulationResult, Self::Error>;
    fn submit(&mut self, transaction: &Self::PreparedTransaction, settlement: &PreparedMarketMakerSettlement)
        -> Result<String, Self::Error>;
    fn confirm(&mut self, signature: &str, settlement: &PreparedMarketMakerSettlement)
        -> Result<SettlementConfirmationResult, Self::Error>;
    fn reconcile(&mut self, signature: &str, settlement: &PreparedMarketMakerSettlement)
        -> Result<(), Self::Error>;
}
~~~

The execution helper prepares once and passes the same transaction reference to simulate and submit. It prevents submission after simulation rejection and preserves the signature for post-submission failures.

The host owns fee-payer policy, signing, recent blockhashes, transaction versions, lookup tables, compute budgets, priority fees, RPC calls, confirmation policy, and ledger reconciliation.
