# Python market-maker integration

This package provides Python builders and host execution contracts for authorized external entities using Chancery mint_direct and redeem_direct pathways. It parses the shared operation document, constructs the exact instruction, and carries the prepared settlement through simulation, submission, confirmation, and reconciliation using the Python standard library.

Read ../MARKET-MAKER-INTEGRATION.md, ../OPERATION-DOCUMENT.md, ../DIRECT-SETTLEMENT.md, and ../PRODUCTION-OPERATIONS.md before production use.

## Structure

- chancery_integration/direct_settlement.py contains the exact discriminators, account order, privileges, validation, and payload encoding.
- chancery_integration/operation.py strictly parses the shared operation document.
- chancery_integration/market_maker_settlement.py identifies the inventory direction and prepares the instruction.
- chancery_integration/settlement_execution.py defines the host preparation, simulation, submission, confirmation, and reconciliation boundary.
- chancery_integration/instruction_json.py emits a normalized review and adapter document.
- chancery_integration/model.py contains the public contracts.
- examples/build_mint.py and examples/build_redeem.py expose the raw wire builders.
- examples/prepare_mint_inventory.py and examples/prepare_redeem_inventory.py expose the market-maker preparation boundary.
- tests contains wire-vector and execution-order tests.

## Requirements

Python 3.11 or newer. Run the examples and tests with the Python standard library from this directory.

~~~sh
python -m examples.prepare_mint_inventory ../fixtures/direct-mint.operation.json
python -m examples.prepare_redeem_inventory ../fixtures/direct-redeem.operation.json
python -m unittest
~~~

The wire examples are:

~~~sh
python -m examples.build_mint ../fixtures/direct-mint.operation.json
python -m examples.build_redeem ../fixtures/direct-redeem.operation.json
~~~

The fixture addresses are synthetic. Replace them with the approved deployment account bundle.

## Prepare mint inventory

~~~python
from chancery_integration import (
    load_mint_direct_operation,
    prepare_market_maker_mint,
)

operation = load_mint_direct_operation("direct-mint.operation.json")
settlement = prepare_market_maker_mint(operation)
~~~

settlement.input_amount is the raw reserve-asset input. settlement.minimum_output is the minimum raw issued-token receipt. settlement.instruction is a library-neutral instruction specification.

## Prepare redemption inventory

~~~python
from chancery_integration import (
    load_redeem_direct_operation,
    prepare_market_maker_redeem,
)

operation = load_redeem_direct_operation("direct-redeem.operation.json")
settlement = prepare_market_maker_redeem(operation)
~~~

settlement.input_amount is the raw issued-token input. settlement.minimum_output is the minimum raw reserve-asset receipt.

## Host transaction adapter

Implement MarketMakerSettlementExecutionPort with the entity's existing transaction system. prepare_transaction must compile and sign one transaction. The exact object it returns is passed to simulate and submit.

~~~python
class MarketMakerSettlementExecutionPort(Protocol[PreparedTransaction]):
    def prepare_transaction(self, settlement): ...
    def simulate(self, transaction, settlement): ...
    def submit(self, transaction, settlement): ...
    def confirm(self, signature, settlement): ...
    def reconcile(self, signature, settlement): ...
~~~

execute_prepared_market_maker_settlement rejects simulation failures before submission. Confirmation and reconciliation errors retain the submitted signature.

The host remains responsible for transaction compilation and signing, fee-payer policy, blockhash handling, transaction version, lookup tables, compute budget, priority fees, RPC calls, commitment, and ledger reconciliation.

## Instruction mapping

InstructionSpec contains the program address, ordered AccountMetaSpec tuple, and raw instruction bytes. Map it explicitly into the host's Solana transaction library while preserving account order and privileges.

Amounts are decimal strings and are validated before unsigned 64-bit little-endian encoding. Supply all 12 policy-account fields and use None for an optional account confirmed as absent.
