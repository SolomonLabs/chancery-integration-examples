use std::{fs, path::Path, str::FromStr};

use serde::Deserialize;
use solana_sdk::pubkey::Pubkey;

use crate::{
    DirectSettlementPolicyAccounts,
    IntegrationError,
    MintDirectAccounts,
    MintDirectArguments,
    RedeemDirectAccounts,
    RedeemDirectArguments,
};

#[derive(Debug, Deserialize)]
#[serde(transparent)]
struct RequiredNullableString(Option<String>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectSettlementPolicyAccountInput {
    fee_policy: RequiredNullableString,
    fee_recipient_token_account: RequiredNullableString,
    limit_policy: RequiredNullableString,
    hourly_usage_window: RequiredNullableString,
    daily_usage_window: RequiredNullableString,
    weekly_usage_window: RequiredNullableString,
    monthly_usage_window: RequiredNullableString,
    evidence_policy: RequiredNullableString,
    asset_limit_policy: RequiredNullableString,
    asset_daily_usage_window: RequiredNullableString,
    counterparty_limit_policy: RequiredNullableString,
    counterparty_daily_usage_window: RequiredNullableString,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MintDirectAccountInput {
    module_activation_state: String,
    chancery_config: String,
    event_authority: String,
    pause_state: String,
    asset_config: String,
    pathway_policy: String,
    permission_record: String,
    source_asset_token_account: String,
    reserve_asset_token_account: String,
    destination_issued_token_account: String,
    asset_mint: String,
    issued_token_mint: String,
    mint_authority_pda: String,
    asset_token_program: String,
    issued_token_program: String,
    principal: String,
    asset_pause_state: String,
    issued_token_control: String,
    policy_accounts: DirectSettlementPolicyAccountInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RedeemDirectAccountInput {
    module_activation_state: String,
    chancery_config: String,
    event_authority: String,
    pause_state: String,
    asset_config: String,
    pathway_policy: String,
    permission_record: String,
    source_issued_token_account: String,
    reserve_asset_token_account: String,
    destination_asset_token_account: String,
    asset_mint: String,
    issued_token_mint: String,
    reserve_authority_pda: String,
    asset_token_program: String,
    issued_token_program: String,
    principal: String,
    asset_pause_state: String,
    issued_token_control: String,
    policy_accounts: DirectSettlementPolicyAccountInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MintDirectOperationFile {
    pathway_id: String,
    amount: String,
    minimum_output: String,
    accounts: MintDirectAccountInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RedeemDirectOperationFile {
    pathway_id: String,
    amount: String,
    minimum_output: String,
    accounts: RedeemDirectAccountInput,
}

pub fn load_mint_direct_operation(
    path: impl AsRef<Path>,
) -> Result<(MintDirectAccounts, MintDirectArguments), IntegrationError> {
    let operation: MintDirectOperationFile = read_json_file(path)?;
    let accounts = operation.accounts;
    Ok((
        MintDirectAccounts {
            module_activation_state: parse_required_public_key(
                &accounts.module_activation_state,
                "accounts.moduleActivationState",
            )?,
            chancery_config: parse_required_public_key(
                &accounts.chancery_config,
                "accounts.chanceryConfig",
            )?,
            event_authority: parse_required_public_key(
                &accounts.event_authority,
                "accounts.eventAuthority",
            )?,
            pause_state: parse_required_public_key(
                &accounts.pause_state,
                "accounts.pauseState",
            )?,
            asset_config: parse_required_public_key(
                &accounts.asset_config,
                "accounts.assetConfig",
            )?,
            pathway_policy: parse_required_public_key(
                &accounts.pathway_policy,
                "accounts.pathwayPolicy",
            )?,
            permission_record: parse_required_public_key(
                &accounts.permission_record,
                "accounts.permissionRecord",
            )?,
            source_asset_token_account: parse_required_public_key(
                &accounts.source_asset_token_account,
                "accounts.sourceAssetTokenAccount",
            )?,
            reserve_asset_token_account: parse_required_public_key(
                &accounts.reserve_asset_token_account,
                "accounts.reserveAssetTokenAccount",
            )?,
            destination_issued_token_account: parse_required_public_key(
                &accounts.destination_issued_token_account,
                "accounts.destinationIssuedTokenAccount",
            )?,
            asset_mint: parse_required_public_key(
                &accounts.asset_mint,
                "accounts.assetMint",
            )?,
            issued_token_mint: parse_required_public_key(
                &accounts.issued_token_mint,
                "accounts.issuedTokenMint",
            )?,
            mint_authority_pda: parse_required_public_key(
                &accounts.mint_authority_pda,
                "accounts.mintAuthorityPda",
            )?,
            asset_token_program: parse_required_public_key(
                &accounts.asset_token_program,
                "accounts.assetTokenProgram",
            )?,
            issued_token_program: parse_required_public_key(
                &accounts.issued_token_program,
                "accounts.issuedTokenProgram",
            )?,
            principal: parse_required_public_key(
                &accounts.principal,
                "accounts.principal",
            )?,
            asset_pause_state: parse_required_public_key(
                &accounts.asset_pause_state,
                "accounts.assetPauseState",
            )?,
            issued_token_control: parse_required_public_key(
                &accounts.issued_token_control,
                "accounts.issuedTokenControl",
            )?,
            policy_accounts: resolve_policy_accounts(accounts.policy_accounts)?,
        },
        MintDirectArguments {
            pathway_id: parse_pathway_id(&operation.pathway_id)?,
            asset_amount: parse_positive_u64(&operation.amount, "amount")?,
            minimum_issued_token_amount: parse_decimal_u64(
                &operation.minimum_output,
                "minimumOutput",
            )?,
        },
    ))
}

pub fn load_redeem_direct_operation(
    path: impl AsRef<Path>,
) -> Result<(RedeemDirectAccounts, RedeemDirectArguments), IntegrationError> {
    let operation: RedeemDirectOperationFile = read_json_file(path)?;
    let accounts = operation.accounts;
    Ok((
        RedeemDirectAccounts {
            module_activation_state: parse_required_public_key(
                &accounts.module_activation_state,
                "accounts.moduleActivationState",
            )?,
            chancery_config: parse_required_public_key(
                &accounts.chancery_config,
                "accounts.chanceryConfig",
            )?,
            event_authority: parse_required_public_key(
                &accounts.event_authority,
                "accounts.eventAuthority",
            )?,
            pause_state: parse_required_public_key(
                &accounts.pause_state,
                "accounts.pauseState",
            )?,
            asset_config: parse_required_public_key(
                &accounts.asset_config,
                "accounts.assetConfig",
            )?,
            pathway_policy: parse_required_public_key(
                &accounts.pathway_policy,
                "accounts.pathwayPolicy",
            )?,
            permission_record: parse_required_public_key(
                &accounts.permission_record,
                "accounts.permissionRecord",
            )?,
            source_issued_token_account: parse_required_public_key(
                &accounts.source_issued_token_account,
                "accounts.sourceIssuedTokenAccount",
            )?,
            reserve_asset_token_account: parse_required_public_key(
                &accounts.reserve_asset_token_account,
                "accounts.reserveAssetTokenAccount",
            )?,
            destination_asset_token_account: parse_required_public_key(
                &accounts.destination_asset_token_account,
                "accounts.destinationAssetTokenAccount",
            )?,
            asset_mint: parse_required_public_key(
                &accounts.asset_mint,
                "accounts.assetMint",
            )?,
            issued_token_mint: parse_required_public_key(
                &accounts.issued_token_mint,
                "accounts.issuedTokenMint",
            )?,
            reserve_authority_pda: parse_required_public_key(
                &accounts.reserve_authority_pda,
                "accounts.reserveAuthorityPda",
            )?,
            asset_token_program: parse_required_public_key(
                &accounts.asset_token_program,
                "accounts.assetTokenProgram",
            )?,
            issued_token_program: parse_required_public_key(
                &accounts.issued_token_program,
                "accounts.issuedTokenProgram",
            )?,
            principal: parse_required_public_key(
                &accounts.principal,
                "accounts.principal",
            )?,
            asset_pause_state: parse_required_public_key(
                &accounts.asset_pause_state,
                "accounts.assetPauseState",
            )?,
            issued_token_control: parse_required_public_key(
                &accounts.issued_token_control,
                "accounts.issuedTokenControl",
            )?,
            policy_accounts: resolve_policy_accounts(accounts.policy_accounts)?,
        },
        RedeemDirectArguments {
            pathway_id: parse_pathway_id(&operation.pathway_id)?,
            issued_token_amount: parse_positive_u64(&operation.amount, "amount")?,
            minimum_asset_amount: parse_decimal_u64(
                &operation.minimum_output,
                "minimumOutput",
            )?,
        },
    ))
}

fn read_json_file<T: for<'de> Deserialize<'de>>(
    path: impl AsRef<Path>,
) -> Result<T, IntegrationError> {
    let path = path.as_ref();
    let bytes = fs::read(path).map_err(|error| {
        IntegrationError::new(format!(
            "failed to read operation file {}: {error}",
            path.display()
        ))
    })?;
    serde_json::from_slice(&bytes).map_err(|error| {
        IntegrationError::new(format!(
            "failed to decode operation file {}: {error}",
            path.display()
        ))
    })
}

fn resolve_policy_accounts(
    accounts: DirectSettlementPolicyAccountInput,
) -> Result<DirectSettlementPolicyAccounts, IntegrationError> {
    Ok(DirectSettlementPolicyAccounts {
        fee_policy: parse_optional_public_key(
            accounts.fee_policy,
            "accounts.policyAccounts.feePolicy",
        )?,
        fee_recipient_token_account: parse_optional_public_key(
            accounts.fee_recipient_token_account,
            "accounts.policyAccounts.feeRecipientTokenAccount",
        )?,
        limit_policy: parse_optional_public_key(
            accounts.limit_policy,
            "accounts.policyAccounts.limitPolicy",
        )?,
        hourly_usage_window: parse_optional_public_key(
            accounts.hourly_usage_window,
            "accounts.policyAccounts.hourlyUsageWindow",
        )?,
        daily_usage_window: parse_optional_public_key(
            accounts.daily_usage_window,
            "accounts.policyAccounts.dailyUsageWindow",
        )?,
        weekly_usage_window: parse_optional_public_key(
            accounts.weekly_usage_window,
            "accounts.policyAccounts.weeklyUsageWindow",
        )?,
        monthly_usage_window: parse_optional_public_key(
            accounts.monthly_usage_window,
            "accounts.policyAccounts.monthlyUsageWindow",
        )?,
        evidence_policy: parse_optional_public_key(
            accounts.evidence_policy,
            "accounts.policyAccounts.evidencePolicy",
        )?,
        asset_limit_policy: parse_optional_public_key(
            accounts.asset_limit_policy,
            "accounts.policyAccounts.assetLimitPolicy",
        )?,
        asset_daily_usage_window: parse_optional_public_key(
            accounts.asset_daily_usage_window,
            "accounts.policyAccounts.assetDailyUsageWindow",
        )?,
        counterparty_limit_policy: parse_optional_public_key(
            accounts.counterparty_limit_policy,
            "accounts.policyAccounts.counterpartyLimitPolicy",
        )?,
        counterparty_daily_usage_window: parse_optional_public_key(
            accounts.counterparty_daily_usage_window,
            "accounts.policyAccounts.counterpartyDailyUsageWindow",
        )?,
    })
}

fn parse_required_public_key(
    value: &str,
    field_name: &str,
) -> Result<Pubkey, IntegrationError> {
    let public_key = Pubkey::from_str(value).map_err(|error| {
        IntegrationError::new(format!(
            "{field_name} is not a Solana public key: {error}"
        ))
    })?;
    if public_key == Pubkey::default() {
        return Err(IntegrationError::new(format!(
            "{field_name} must not be the default public key"
        )));
    }
    Ok(public_key)
}

fn parse_optional_public_key(
    value: RequiredNullableString,
    field_name: &str,
) -> Result<Option<Pubkey>, IntegrationError> {
    value
        .0
        .map(|address| parse_required_public_key(&address, field_name))
        .transpose()
}

fn parse_decimal_u64(value: &str, field_name: &str) -> Result<u64, IntegrationError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(IntegrationError::new(format!(
            "{field_name} must be an unsigned decimal string"
        )));
    }
    value.parse::<u64>().map_err(|error| {
        IntegrationError::new(format!(
            "{field_name} exceeds the u64 range: {error}"
        ))
    })
}

fn parse_positive_u64(value: &str, field_name: &str) -> Result<u64, IntegrationError> {
    let amount = parse_decimal_u64(value, field_name)?;
    if amount == 0 {
        return Err(IntegrationError::new(format!(
            "{field_name} must be greater than zero"
        )));
    }
    Ok(amount)
}

fn parse_pathway_id(value: &str) -> Result<[u8; 32], IntegrationError> {
    let hexadecimal = value.strip_prefix("0x").unwrap_or(value);
    if hexadecimal.len() != 64 {
        return Err(IntegrationError::new(
            "pathwayId must contain exactly 64 hexadecimal characters",
        ));
    }

    let mut result = [0u8; 32];
    let bytes = hexadecimal.as_bytes();
    for index in 0..32 {
        let high = hexadecimal_nibble(bytes[index * 2]).ok_or_else(|| {
            IntegrationError::new("pathwayId contains a non-hexadecimal character")
        })?;
        let low = hexadecimal_nibble(bytes[index * 2 + 1]).ok_or_else(|| {
            IntegrationError::new("pathwayId contains a non-hexadecimal character")
        })?;
        result[index] = (high << 4) | low;
    }
    Ok(result)
}

fn hexadecimal_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
