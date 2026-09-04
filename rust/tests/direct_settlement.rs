use std::{fs, path::PathBuf};

use chancery_reference::{
    CHANCERY_PROGRAM_ID,
    MINT_DIRECT_ACCOUNT_NAMES,
    REDEEM_DIRECT_ACCOUNT_NAMES,
    build_mint_direct_instruction,
    build_redeem_direct_instruction,
    load_mint_direct_operation,
    load_redeem_direct_operation,
    mint_instruction_to_document,
    redeem_instruction_to_document,
};
use serde_json::Value;
use solana_sdk::pubkey::Pubkey;

const WRITABLE_FLAGS: [bool; 31] = [
    false, true, false, false, false, false, false, true, true, true,
    false, true, false, false, false, false, false, false, false, true,
    false, true, true, true, true, false, false, true, false, true, false,
];

fn fixtures_directory() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn wire_vectors() -> Value {
    let path = fixtures_directory().join("wire-vectors.json");
    let bytes = fs::read(path).expect("wire vector fixture must be readable");
    serde_json::from_slice(&bytes).expect("wire vector fixture must be valid JSON")
}

#[test]
fn mint_direct_matches_shared_wire_vector() {
    let fixture_path = fixtures_directory().join("direct-mint.operation.json");
    let (accounts, arguments) =
        load_mint_direct_operation(fixture_path).expect("mint fixture must parse");
    let instruction = build_mint_direct_instruction(&accounts, &arguments)
        .expect("mint instruction must build");
    let document = mint_instruction_to_document(&instruction)
        .expect("mint instruction document must build");
    let vectors = wire_vectors();

    assert_eq!(instruction.program_id, CHANCERY_PROGRAM_ID);
    assert_eq!(instruction.accounts.len(), 31);
    assert_eq!(instruction.data.len(), 50);
    assert_eq!(
        document.accounts.iter().map(|account| account.name.as_str()).collect::<Vec<_>>(),
        MINT_DIRECT_ACCOUNT_NAMES.to_vec(),
    );
    assert_eq!(
        document.accounts.iter().map(|account| account.is_writable).collect::<Vec<_>>(),
        WRITABLE_FLAGS.to_vec(),
    );
    assert_eq!(
        document.accounts.iter().map(|account| account.is_signer).collect::<Vec<_>>(),
        (0..31).map(|index| index == 15).collect::<Vec<_>>(),
    );
    assert!(
        document.accounts[18..30]
            .iter()
            .all(|account| account.address == Pubkey::default().to_string())
    );
    assert_eq!(document.accounts[30].address, CHANCERY_PROGRAM_ID.to_string());
    assert_eq!(document.data_hex, vectors["mint"]["dataHex"].as_str().unwrap());
    assert_eq!(
        document.data_base64,
        vectors["mint"]["dataBase64"].as_str().unwrap(),
    );
}

#[test]
fn redeem_direct_matches_shared_wire_vector() {
    let fixture_path = fixtures_directory().join("direct-redeem.operation.json");
    let (accounts, arguments) =
        load_redeem_direct_operation(fixture_path).expect("redeem fixture must parse");
    let instruction = build_redeem_direct_instruction(&accounts, &arguments)
        .expect("redeem instruction must build");
    let document = redeem_instruction_to_document(&instruction)
        .expect("redeem instruction document must build");
    let vectors = wire_vectors();

    assert_eq!(instruction.program_id, CHANCERY_PROGRAM_ID);
    assert_eq!(instruction.accounts.len(), 31);
    assert_eq!(instruction.data.len(), 50);
    assert_eq!(
        document.accounts.iter().map(|account| account.name.as_str()).collect::<Vec<_>>(),
        REDEEM_DIRECT_ACCOUNT_NAMES.to_vec(),
    );
    assert_eq!(
        document.accounts.iter().map(|account| account.is_writable).collect::<Vec<_>>(),
        WRITABLE_FLAGS.to_vec(),
    );
    assert_eq!(
        document.accounts.iter().map(|account| account.is_signer).collect::<Vec<_>>(),
        (0..31).map(|index| index == 15).collect::<Vec<_>>(),
    );
    assert!(
        document.accounts[18..30]
            .iter()
            .all(|account| account.address == Pubkey::default().to_string())
    );
    assert_eq!(document.accounts[30].address, CHANCERY_PROGRAM_ID.to_string());
    assert_eq!(document.data_hex, vectors["redeem"]["dataHex"].as_str().unwrap());
    assert_eq!(
        document.data_base64,
        vectors["redeem"]["dataBase64"].as_str().unwrap(),
    );
}

#[test]
fn zero_input_amount_is_rejected() {
    let fixture_path = fixtures_directory().join("direct-mint.operation.json");
    let (accounts, mut arguments) =
        load_mint_direct_operation(fixture_path).expect("mint fixture must parse");
    arguments.asset_amount = 0;
    assert!(build_mint_direct_instruction(&accounts, &arguments).is_err());
}

#[test]
fn required_default_public_key_is_rejected() {
    let fixture_path = fixtures_directory().join("direct-redeem.operation.json");
    let (mut accounts, arguments) =
        load_redeem_direct_operation(fixture_path).expect("redeem fixture must parse");
    accounts.principal = Pubkey::default();
    assert!(build_redeem_direct_instruction(&accounts, &arguments).is_err());
}
