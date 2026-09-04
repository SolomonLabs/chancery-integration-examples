# Rust direct-settlement reference

The top-level rust crate adds a Rust example set beside the repository's existing TypeScript and Python references. It provides typed Solana instruction builders for Chancery mint_direct and redeem_direct, strict operation-document parsing, normalized instruction output, runnable examples, and shared wire-vector tests.

The crate uses public Rust crates to construct typed Solana instructions for mint_direct and redeem_direct.

## Structure

- src/direct_settlement.rs defines typed account and argument contracts, validation, account metadata, discriminators, and payload encoding.
- src/operation.rs strictly parses mint and redeem operation documents.
- src/instruction_json.rs emits normalized output for review and cross-language comparison.
- src/error.rs defines reference-boundary errors.
- examples/build_mint.rs builds one direct mint instruction.
- examples/build_redeem.rs builds one direct redeem instruction.
- fixtures contains self-contained synthetic operation documents and wire vectors.
- tests/direct_settlement.rs covers instruction layout and rejected inputs.

The exact wire contract is documented in ../integration/DIRECT-SETTLEMENT.md. The external operation-document contract is documented in ../integration/OPERATION-DOCUMENT.md.

## Requirements

Rust 1.85 or newer.

From this directory:

~~~sh
cargo run --example build_mint -- fixtures/direct-mint.operation.json
cargo run --example build_redeem -- fixtures/direct-redeem.operation.json
cargo test
~~~

The examples emit the program address, all ordered account metadata, and instruction data in base64 and hexadecimal form for insertion into the host transaction pipeline.

The fixture public keys and pathway identifier are synthetic. Replace them with the approved deployment values.

## Use the builders

~~~rust
use chancery_reference::{
    build_mint_direct_instruction,
    load_mint_direct_operation,
};

let (accounts, arguments) =
    load_mint_direct_operation("mint.operation.json")?;
let instruction = build_mint_direct_instruction(&accounts, &arguments)?;
~~~

The returned value is solana_sdk::instruction::Instruction and can be inserted into the host application's existing transaction pipeline.

MintDirectAccounts and RedeemDirectAccounts keep every required account explicit. DirectSettlementPolicyAccounts uses Option<Pubkey> for the 12 optional policy and usage-window positions. None becomes Pubkey::default() in the fixed position while preserving all 31 positions.

## Host integration

The reference crate constructs protocol instructions. The host application supplies account sourcing, pathway authorization, transaction compilation, key custody, signing, simulation, submission, confirmation, and reconciliation.

The examples under ../integration/rust add the market-maker preparation and execution lifecycle.
