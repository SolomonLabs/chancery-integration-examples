# Market-maker integrations

This directory contains external direct-settlement integrations for authorized market makers, liquidity providers, exchanges, treasury systems, custodians, and bilateral settlement counterparties.

Each language set covers two direct-settlement pathways:

- mint_direct: transfer an approved reserve asset into the configured reserve account and receive the issued token;
- redeem_direct: burn the issued token and receive the approved reserve asset from the configured reserve account.

## Relationship to the existing examples

The repository's existing top-level TypeScript, Python, web, compatibility, and live-conformance examples remain in place. A top-level rust directory adds a Rust direct-settlement reference beside those existing language sets.

The packages under integration provide market-maker preparation, transaction handoff, confirmation, and reconciliation workflows around an approved account bundle.

## Start here

- MARKET-MAKER-INTEGRATION.md defines the integration boundary and inventory flows.
- OPERATION-DOCUMENT.md defines the strict input document accepted by all three language sets.
- DIRECT-SETTLEMENT.md defines the exact program address, instruction bytes, account positions, and account privileges.
- PRODUCTION-OPERATIONS.md defines transaction preparation, simulation, submission, confirmation, failure handling, and reconciliation.
- typescript contains dependency-free TypeScript builders and a host execution interface.
- python contains standard-library Python builders and a host execution protocol.
- rust contains a Rust market-maker adapter over the top-level rust reference crate.
- fixtures contains synthetic operation documents and language-independent wire vectors for encoding and cross-language comparison.

## Integration model

The external entity supplies or receives a current account bundle for its approved principal and pathway. For each operation it supplies the raw input amount and minimum acceptable raw output. The language package builds one Chancery instruction and hands it to the entity's existing transaction system.

The host system remains responsible for:

- business-request authorization and duplicate prevention;
- account-bundle custody and freshness;
- decimal-to-base-unit conversion;
- minimum-output policy;
- fee payer, recent blockhash, compute budget, and priority fees;
- transaction compilation and principal signing;
- simulation of the exact prepared transaction;
- submission of that same prepared transaction;
- confirmation and execution-error inspection; and
- balance and evidence reconciliation.

## Quick start

TypeScript, from integration/typescript:

~~~sh
node --experimental-strip-types examples/prepare_mint_inventory.ts ../fixtures/direct-mint.operation.json
node --experimental-strip-types examples/prepare_redeem_inventory.ts ../fixtures/direct-redeem.operation.json
node --experimental-strip-types --test test/*.test.ts
~~~

Python, from integration/python:

~~~sh
python -m examples.prepare_mint_inventory ../fixtures/direct-mint.operation.json
python -m examples.prepare_redeem_inventory ../fixtures/direct-redeem.operation.json
python -m unittest
~~~

Rust, from integration/rust:

~~~sh
cargo run --example prepare_mint_inventory -- ../fixtures/direct-mint.operation.json
cargo run --example prepare_redeem_inventory -- ../fixtures/direct-redeem.operation.json
cargo test
~~~

Each preparation example emits a normalized instruction document for the host transaction pipeline.

## Existing live conformance gate

RunDirectSettlement.mjs remains the repository's deployment-bound cross-language conformance gate. It uses the existing top-level TypeScript and Python reference clients as a separate live validation entry point.

After copying live-direct-settlement.example.json to live-direct-settlement.json and replacing every placeholder, run from the repository root:

~~~sh
yarn integration:direct integration/live-direct-settlement.json
~~~

The live configuration refers to signer paths. Store signer files in the host's protected key-custody location.
