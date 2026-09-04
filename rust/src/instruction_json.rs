use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use solana_sdk::instruction::Instruction;

use crate::{
    CHANCERY_PROGRAM_ID,
    IntegrationError,
    MINT_DIRECT_ACCOUNT_NAMES,
    REDEEM_DIRECT_ACCOUNT_NAMES,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMetaDocument {
    pub name: String,
    pub address: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionDocument {
    pub program_id: String,
    pub accounts: Vec<AccountMetaDocument>,
    pub data_base64: String,
    pub data_hex: String,
}

pub fn mint_instruction_to_document(
    instruction: &Instruction,
) -> Result<InstructionDocument, IntegrationError> {
    instruction_to_document(instruction, &MINT_DIRECT_ACCOUNT_NAMES)
}

pub fn redeem_instruction_to_document(
    instruction: &Instruction,
) -> Result<InstructionDocument, IntegrationError> {
    instruction_to_document(instruction, &REDEEM_DIRECT_ACCOUNT_NAMES)
}

fn instruction_to_document(
    instruction: &Instruction,
    account_names: &[&str; 31],
) -> Result<InstructionDocument, IntegrationError> {
    if instruction.program_id != CHANCERY_PROGRAM_ID {
        return Err(IntegrationError::new(
            "instruction program address does not match Chancery",
        ));
    }
    if instruction.accounts.len() != account_names.len() {
        return Err(IntegrationError::new(format!(
            "instruction must contain 31 account positions, received {}",
            instruction.accounts.len()
        )));
    }
    if instruction.data.len() != 50 {
        return Err(IntegrationError::new(format!(
            "instruction data must contain 50 bytes, received {}",
            instruction.data.len()
        )));
    }

    let accounts = instruction
        .accounts
        .iter()
        .zip(account_names)
        .map(|(account, name)| AccountMetaDocument {
            name: (*name).to_owned(),
            address: account.pubkey.to_string(),
            is_signer: account.is_signer,
            is_writable: account.is_writable,
        })
        .collect();

    Ok(InstructionDocument {
        program_id: instruction.program_id.to_string(),
        accounts,
        data_base64: STANDARD.encode(&instruction.data),
        data_hex: encode_hexadecimal(&instruction.data),
    })
}

fn encode_hexadecimal(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";

    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(DIGITS[(byte >> 4) as usize] as char);
        result.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    result
}
