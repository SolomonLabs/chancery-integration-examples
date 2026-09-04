# TypeScript market-maker integration

This package provides dependency-free TypeScript builders and host execution contracts for authorized external entities using Chancery mint_direct and redeem_direct pathways. It parses the shared operation document, constructs the exact instruction, and carries the prepared settlement through simulation, submission, confirmation, and reconciliation.

Read ../MARKET-MAKER-INTEGRATION.md, ../OPERATION-DOCUMENT.md, ../DIRECT-SETTLEMENT.md, and ../PRODUCTION-OPERATIONS.md before production use.

## Structure

- src/direct_settlement.ts contains the exact discriminators, account order, privileges, validation, and payload encoding.
- src/operation.ts strictly parses the shared operation document.
- src/market_maker_settlement.ts identifies the inventory direction and prepares the instruction.
- src/settlement_execution.ts defines the host preparation, simulation, submission, confirmation, and reconciliation boundary.
- src/instruction_json.ts emits a normalized review and adapter document.
- src/model.ts contains the public contracts.
- examples/build_mint.ts and examples/build_redeem.ts expose the raw wire builders.
- examples/prepare_mint_inventory.ts and examples/prepare_redeem_inventory.ts expose the market-maker preparation boundary.
- test contains wire-vector and execution-order tests.

## Requirements

Node.js 24 or newer. Run the examples and tests directly with Node.js from this directory.

From this directory:

~~~sh
node --experimental-strip-types examples/prepare_mint_inventory.ts ../fixtures/direct-mint.operation.json
node --experimental-strip-types examples/prepare_redeem_inventory.ts ../fixtures/direct-redeem.operation.json
node --experimental-strip-types --test test/*.test.ts
~~~

The wire examples are:

~~~sh
node --experimental-strip-types examples/build_mint.ts ../fixtures/direct-mint.operation.json
node --experimental-strip-types examples/build_redeem.ts ../fixtures/direct-redeem.operation.json
~~~

The fixture addresses are synthetic. Replace them with the approved deployment account bundle.

## Prepare mint inventory

~~~ts
import {
    loadMintDirectOperation,
    prepareMarketMakerMint,
} from "./src/index.ts";

const operation = loadMintDirectOperation("direct-mint.operation.json");
const settlement = prepareMarketMakerMint(operation);
~~~

settlement.inputAmount is the raw reserve-asset input. settlement.minimumOutput is the minimum raw issued-token receipt. settlement.instruction is a library-neutral instruction specification.

## Prepare redemption inventory

~~~ts
import {
    loadRedeemDirectOperation,
    prepareMarketMakerRedeem,
} from "./src/index.ts";

const operation = loadRedeemDirectOperation("direct-redeem.operation.json");
const settlement = prepareMarketMakerRedeem(operation);
~~~

settlement.inputAmount is the raw issued-token input. settlement.minimumOutput is the minimum raw reserve-asset receipt.

## Host transaction adapter

Implement MarketMakerSettlementExecutionPort with the entity's existing Solana transaction system. The type parameter is the host's prepared transaction representation.

~~~ts
interface MarketMakerSettlementExecutionPort<PreparedTransaction> {
    prepareTransaction(settlement: PreparedMarketMakerSettlement): Promise<PreparedTransaction>;
    simulate(transaction: PreparedTransaction, settlement: PreparedMarketMakerSettlement): Promise<SettlementSimulationResult>;
    submit(transaction: PreparedTransaction, settlement: PreparedMarketMakerSettlement): Promise<string>;
    confirm(signature: string, settlement: PreparedMarketMakerSettlement): Promise<SettlementConfirmationResult>;
    reconcile(signature: string, settlement: PreparedMarketMakerSettlement): Promise<void>;
}
~~~

executePreparedMarketMakerSettlement prepares once and passes the same transaction object to simulate and submit. A rejected simulation prevents submission. Confirmation and reconciliation errors retain the submitted signature.

The host remains responsible for compiling and signing the instruction, fee-payer policy, blockhash handling, transaction version, lookup tables, compute budget, priority fees, RPC calls, commitment, and ledger reconciliation.

## Instruction mapping

InstructionSpec contains:

~~~ts
interface InstructionSpec {
    readonly programId: string;
    readonly accounts: readonly AccountMetaSpec[];
    readonly data: Uint8Array;
}
~~~

Map it explicitly into the host transaction library. Preserve programId, all account positions, signer flags, writable flags, and data bytes exactly.

Amounts remain decimal strings until encoded so the full unsigned 64-bit range is preserved. Supply all 12 policy-account fields and use null for an optional account confirmed as absent.
