use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey,
    pubkey::Pubkey,
};

use crate::IntegrationError;

pub const CHANCERY_PROGRAM_ID: Pubkey =
    pubkey!("ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz");

pub const MINT_DIRECT_ACCOUNT_NAMES: [&str; 31] = [
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceAssetTokenAccount",
    "reserveAssetTokenAccount",
    "destinationIssuedTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "mintAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "feePolicy",
    "feeRecipientTokenAccount",
    "limitPolicy",
    "hourlyUsageWindow",
    "dailyUsageWindow",
    "weeklyUsageWindow",
    "monthlyUsageWindow",
    "evidencePolicy",
    "assetLimitPolicy",
    "assetDailyUsageWindow",
    "counterpartyLimitPolicy",
    "counterpartyDailyUsageWindow",
    "eventProgram",
];

pub const REDEEM_DIRECT_ACCOUNT_NAMES: [&str; 31] = [
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceIssuedTokenAccount",
    "reserveAssetTokenAccount",
    "destinationAssetTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "reserveAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "feePolicy",
    "feeRecipientTokenAccount",
    "limitPolicy",
    "hourlyUsageWindow",
    "dailyUsageWindow",
    "weeklyUsageWindow",
    "monthlyUsageWindow",
    "evidencePolicy",
    "assetLimitPolicy",
    "assetDailyUsageWindow",
    "counterpartyLimitPolicy",
    "counterpartyDailyUsageWindow",
    "eventProgram",
];

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DirectSettlementPolicyAccounts {
    pub fee_policy: Option<Pubkey>,
    pub fee_recipient_token_account: Option<Pubkey>,
    pub limit_policy: Option<Pubkey>,
    pub hourly_usage_window: Option<Pubkey>,
    pub daily_usage_window: Option<Pubkey>,
    pub weekly_usage_window: Option<Pubkey>,
    pub monthly_usage_window: Option<Pubkey>,
    pub evidence_policy: Option<Pubkey>,
    pub asset_limit_policy: Option<Pubkey>,
    pub asset_daily_usage_window: Option<Pubkey>,
    pub counterparty_limit_policy: Option<Pubkey>,
    pub counterparty_daily_usage_window: Option<Pubkey>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MintDirectAccounts {
    pub module_activation_state: Pubkey,
    pub chancery_config: Pubkey,
    pub event_authority: Pubkey,
    pub pause_state: Pubkey,
    pub asset_config: Pubkey,
    pub pathway_policy: Pubkey,
    pub permission_record: Pubkey,
    pub source_asset_token_account: Pubkey,
    pub reserve_asset_token_account: Pubkey,
    pub destination_issued_token_account: Pubkey,
    pub asset_mint: Pubkey,
    pub issued_token_mint: Pubkey,
    pub mint_authority_pda: Pubkey,
    pub asset_token_program: Pubkey,
    pub issued_token_program: Pubkey,
    pub principal: Pubkey,
    pub asset_pause_state: Pubkey,
    pub issued_token_control: Pubkey,
    pub policy_accounts: DirectSettlementPolicyAccounts,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RedeemDirectAccounts {
    pub module_activation_state: Pubkey,
    pub chancery_config: Pubkey,
    pub event_authority: Pubkey,
    pub pause_state: Pubkey,
    pub asset_config: Pubkey,
    pub pathway_policy: Pubkey,
    pub permission_record: Pubkey,
    pub source_issued_token_account: Pubkey,
    pub reserve_asset_token_account: Pubkey,
    pub destination_asset_token_account: Pubkey,
    pub asset_mint: Pubkey,
    pub issued_token_mint: Pubkey,
    pub reserve_authority_pda: Pubkey,
    pub asset_token_program: Pubkey,
    pub issued_token_program: Pubkey,
    pub principal: Pubkey,
    pub asset_pause_state: Pubkey,
    pub issued_token_control: Pubkey,
    pub policy_accounts: DirectSettlementPolicyAccounts,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MintDirectArguments {
    pub pathway_id: [u8; 32],
    pub asset_amount: u64,
    pub minimum_issued_token_amount: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RedeemDirectArguments {
    pub pathway_id: [u8; 32],
    pub issued_token_amount: u64,
    pub minimum_asset_amount: u64,
}

pub fn build_mint_direct_instruction(
    accounts: &MintDirectAccounts,
    arguments: &MintDirectArguments,
) -> Result<Instruction, IntegrationError> {
    if arguments.asset_amount == 0 {
        return Err(IntegrationError::new("amount must be greater than zero"));
    }

    let policy_accounts = accounts.policy_accounts;
    let account_metas = vec![
        required_readonly(
            "accounts.moduleActivationState",
            accounts.module_activation_state,
            false,
        )?,
        required_writable("accounts.chanceryConfig", accounts.chancery_config, false)?,
        required_readonly("accounts.eventAuthority", accounts.event_authority, false)?,
        required_readonly("accounts.pauseState", accounts.pause_state, false)?,
        required_readonly("accounts.assetConfig", accounts.asset_config, false)?,
        required_readonly("accounts.pathwayPolicy", accounts.pathway_policy, false)?,
        required_readonly("accounts.permissionRecord", accounts.permission_record, false)?,
        required_writable(
            "accounts.sourceAssetTokenAccount",
            accounts.source_asset_token_account,
            false,
        )?,
        required_writable(
            "accounts.reserveAssetTokenAccount",
            accounts.reserve_asset_token_account,
            false,
        )?,
        required_writable(
            "accounts.destinationIssuedTokenAccount",
            accounts.destination_issued_token_account,
            false,
        )?,
        required_readonly("accounts.assetMint", accounts.asset_mint, false)?,
        required_writable("accounts.issuedTokenMint", accounts.issued_token_mint, false)?,
        required_readonly("accounts.mintAuthorityPda", accounts.mint_authority_pda, false)?,
        required_readonly("accounts.assetTokenProgram", accounts.asset_token_program, false)?,
        required_readonly(
            "accounts.issuedTokenProgram",
            accounts.issued_token_program,
            false,
        )?,
        required_readonly("accounts.principal", accounts.principal, true)?,
        required_readonly("accounts.assetPauseState", accounts.asset_pause_state, false)?,
        required_readonly(
            "accounts.issuedTokenControl",
            accounts.issued_token_control,
            false,
        )?,
        optional_readonly("accounts.policyAccounts.feePolicy", policy_accounts.fee_policy)?,
        optional_writable(
            "accounts.policyAccounts.feeRecipientTokenAccount",
            policy_accounts.fee_recipient_token_account,
        )?,
        optional_readonly(
            "accounts.policyAccounts.limitPolicy",
            policy_accounts.limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.hourlyUsageWindow",
            policy_accounts.hourly_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.dailyUsageWindow",
            policy_accounts.daily_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.weeklyUsageWindow",
            policy_accounts.weekly_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.monthlyUsageWindow",
            policy_accounts.monthly_usage_window,
        )?,
        optional_readonly(
            "accounts.policyAccounts.evidencePolicy",
            policy_accounts.evidence_policy,
        )?,
        optional_readonly(
            "accounts.policyAccounts.assetLimitPolicy",
            policy_accounts.asset_limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.assetDailyUsageWindow",
            policy_accounts.asset_daily_usage_window,
        )?,
        optional_readonly(
            "accounts.policyAccounts.counterpartyLimitPolicy",
            policy_accounts.counterparty_limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.counterpartyDailyUsageWindow",
            policy_accounts.counterparty_daily_usage_window,
        )?,
        AccountMeta::new_readonly(CHANCERY_PROGRAM_ID, false),
    ];

    ensure_account_count("mint_direct", &account_metas)?;
    Ok(Instruction {
        program_id: CHANCERY_PROGRAM_ID,
        accounts: account_metas,
        data: encode_direct_arguments(
            [4, 1],
            &arguments.pathway_id,
            arguments.asset_amount,
            arguments.minimum_issued_token_amount,
        ),
    })
}

pub fn build_redeem_direct_instruction(
    accounts: &RedeemDirectAccounts,
    arguments: &RedeemDirectArguments,
) -> Result<Instruction, IntegrationError> {
    if arguments.issued_token_amount == 0 {
        return Err(IntegrationError::new("amount must be greater than zero"));
    }

    let policy_accounts = accounts.policy_accounts;
    let account_metas = vec![
        required_readonly(
            "accounts.moduleActivationState",
            accounts.module_activation_state,
            false,
        )?,
        required_writable("accounts.chanceryConfig", accounts.chancery_config, false)?,
        required_readonly("accounts.eventAuthority", accounts.event_authority, false)?,
        required_readonly("accounts.pauseState", accounts.pause_state, false)?,
        required_readonly("accounts.assetConfig", accounts.asset_config, false)?,
        required_readonly("accounts.pathwayPolicy", accounts.pathway_policy, false)?,
        required_readonly("accounts.permissionRecord", accounts.permission_record, false)?,
        required_writable(
            "accounts.sourceIssuedTokenAccount",
            accounts.source_issued_token_account,
            false,
        )?,
        required_writable(
            "accounts.reserveAssetTokenAccount",
            accounts.reserve_asset_token_account,
            false,
        )?,
        required_writable(
            "accounts.destinationAssetTokenAccount",
            accounts.destination_asset_token_account,
            false,
        )?,
        required_readonly("accounts.assetMint", accounts.asset_mint, false)?,
        required_writable("accounts.issuedTokenMint", accounts.issued_token_mint, false)?,
        required_readonly(
            "accounts.reserveAuthorityPda",
            accounts.reserve_authority_pda,
            false,
        )?,
        required_readonly("accounts.assetTokenProgram", accounts.asset_token_program, false)?,
        required_readonly(
            "accounts.issuedTokenProgram",
            accounts.issued_token_program,
            false,
        )?,
        required_readonly("accounts.principal", accounts.principal, true)?,
        required_readonly("accounts.assetPauseState", accounts.asset_pause_state, false)?,
        required_readonly(
            "accounts.issuedTokenControl",
            accounts.issued_token_control,
            false,
        )?,
        optional_readonly("accounts.policyAccounts.feePolicy", policy_accounts.fee_policy)?,
        optional_writable(
            "accounts.policyAccounts.feeRecipientTokenAccount",
            policy_accounts.fee_recipient_token_account,
        )?,
        optional_readonly(
            "accounts.policyAccounts.limitPolicy",
            policy_accounts.limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.hourlyUsageWindow",
            policy_accounts.hourly_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.dailyUsageWindow",
            policy_accounts.daily_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.weeklyUsageWindow",
            policy_accounts.weekly_usage_window,
        )?,
        optional_writable(
            "accounts.policyAccounts.monthlyUsageWindow",
            policy_accounts.monthly_usage_window,
        )?,
        optional_readonly(
            "accounts.policyAccounts.evidencePolicy",
            policy_accounts.evidence_policy,
        )?,
        optional_readonly(
            "accounts.policyAccounts.assetLimitPolicy",
            policy_accounts.asset_limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.assetDailyUsageWindow",
            policy_accounts.asset_daily_usage_window,
        )?,
        optional_readonly(
            "accounts.policyAccounts.counterpartyLimitPolicy",
            policy_accounts.counterparty_limit_policy,
        )?,
        optional_writable(
            "accounts.policyAccounts.counterpartyDailyUsageWindow",
            policy_accounts.counterparty_daily_usage_window,
        )?,
        AccountMeta::new_readonly(CHANCERY_PROGRAM_ID, false),
    ];

    ensure_account_count("redeem_direct", &account_metas)?;
    Ok(Instruction {
        program_id: CHANCERY_PROGRAM_ID,
        accounts: account_metas,
        data: encode_direct_arguments(
            [4, 2],
            &arguments.pathway_id,
            arguments.issued_token_amount,
            arguments.minimum_asset_amount,
        ),
    })
}

fn required_readonly(
    field_name: &str,
    address: Pubkey,
    is_signer: bool,
) -> Result<AccountMeta, IntegrationError> {
    validate_non_default(field_name, address)?;
    Ok(AccountMeta::new_readonly(address, is_signer))
}

fn required_writable(
    field_name: &str,
    address: Pubkey,
    is_signer: bool,
) -> Result<AccountMeta, IntegrationError> {
    validate_non_default(field_name, address)?;
    Ok(AccountMeta::new(address, is_signer))
}

fn optional_readonly(
    field_name: &str,
    address: Option<Pubkey>,
) -> Result<AccountMeta, IntegrationError> {
    if let Some(address) = address {
        validate_non_default(field_name, address)?;
    }
    Ok(AccountMeta::new_readonly(address.unwrap_or_default(), false))
}

fn optional_writable(
    field_name: &str,
    address: Option<Pubkey>,
) -> Result<AccountMeta, IntegrationError> {
    if let Some(address) = address {
        validate_non_default(field_name, address)?;
    }
    Ok(AccountMeta::new(address.unwrap_or_default(), false))
}

fn validate_non_default(field_name: &str, address: Pubkey) -> Result<(), IntegrationError> {
    if address == Pubkey::default() {
        return Err(IntegrationError::new(format!(
            "{field_name} must not be the default public key"
        )));
    }
    Ok(())
}

fn ensure_account_count(
    operation_name: &str,
    accounts: &[AccountMeta],
) -> Result<(), IntegrationError> {
    if accounts.len() != 31 {
        return Err(IntegrationError::new(format!(
            "{operation_name} must contain 31 account positions, received {}",
            accounts.len()
        )));
    }
    Ok(())
}

fn encode_direct_arguments(
    discriminator: [u8; 2],
    pathway_id: &[u8; 32],
    amount: u64,
    minimum_output: u64,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(50);
    data.extend_from_slice(&discriminator);
    data.extend_from_slice(pathway_id);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&minimum_output.to_le_bytes());
    data
}
