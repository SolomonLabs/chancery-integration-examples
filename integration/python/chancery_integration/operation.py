from __future__ import annotations

import json
from pathlib import Path

from .model import (
    DirectSettlementPolicyAccountsInput,
    MintDirectAccountsInput,
    MintDirectOperationInput,
    RedeemDirectAccountsInput,
    RedeemDirectOperationInput,
)


_ROOT_FIELDS = frozenset(("pathwayId", "amount", "minimumOutput", "accounts"))
_POLICY_FIELDS = frozenset(
    (
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
    )
)
_MINT_ACCOUNT_FIELDS = frozenset(
    (
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
        "policyAccounts",
    )
)
_REDEEM_ACCOUNT_FIELDS = frozenset(
    (
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
        "policyAccounts",
    )
)


def _load_operation_document(file_path: str | Path) -> dict[str, object]:
    parsed: object = json.loads(Path(file_path).read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Operation document must be a JSON object")
    if not all(isinstance(field, str) for field in parsed):
        raise ValueError("Operation document fields must be strings")
    return parsed


def _reject_unknown_fields(
    document: dict[str, object],
    allowed_fields: frozenset[str],
    location: str,
) -> None:
    unknown_fields = document.keys() - allowed_fields
    if unknown_fields:
        field = sorted(unknown_fields)[0]
        raise ValueError(f"Unknown field {location}.{field}")


def _read_required_string(
    document: dict[str, object],
    field: str,
    location: str,
) -> str:
    if field not in document:
        raise ValueError(f"Missing field {location}.{field}")
    value = document[field]
    if not isinstance(value, str):
        raise ValueError(f"{location}.{field} must be a string")
    return value


def _read_optional_account(
    document: dict[str, object],
    field: str,
) -> str | None:
    if field not in document:
        raise ValueError(f"Missing field accounts.policyAccounts.{field}")
    value = document[field]
    if value is not None and not isinstance(value, str):
        raise ValueError(
            f"accounts.policyAccounts.{field} must be a string or null"
        )
    return value


def _read_accounts_document(root: dict[str, object]) -> dict[str, object]:
    if "accounts" not in root:
        raise ValueError("Missing field operation.accounts")
    value = root["accounts"]
    if not isinstance(value, dict):
        raise ValueError("operation.accounts must be a JSON object")
    if not all(isinstance(field, str) for field in value):
        raise ValueError("operation.accounts fields must be strings")
    return value


def _read_policy_accounts(
    accounts: dict[str, object],
) -> DirectSettlementPolicyAccountsInput:
    if "policyAccounts" not in accounts:
        raise ValueError("Missing field accounts.policyAccounts")
    value = accounts["policyAccounts"]
    if not isinstance(value, dict):
        raise ValueError("accounts.policyAccounts must be a JSON object")
    if not all(isinstance(field, str) for field in value):
        raise ValueError("accounts.policyAccounts fields must be strings")
    _reject_unknown_fields(value, _POLICY_FIELDS, "accounts.policyAccounts")
    return DirectSettlementPolicyAccountsInput(
        fee_policy=_read_optional_account(value, "feePolicy"),
        fee_recipient_token_account=_read_optional_account(
            value,
            "feeRecipientTokenAccount",
        ),
        limit_policy=_read_optional_account(value, "limitPolicy"),
        hourly_usage_window=_read_optional_account(value, "hourlyUsageWindow"),
        daily_usage_window=_read_optional_account(value, "dailyUsageWindow"),
        weekly_usage_window=_read_optional_account(value, "weeklyUsageWindow"),
        monthly_usage_window=_read_optional_account(value, "monthlyUsageWindow"),
        evidence_policy=_read_optional_account(value, "evidencePolicy"),
        asset_limit_policy=_read_optional_account(value, "assetLimitPolicy"),
        asset_daily_usage_window=_read_optional_account(
            value,
            "assetDailyUsageWindow",
        ),
        counterparty_limit_policy=_read_optional_account(
            value,
            "counterpartyLimitPolicy",
        ),
        counterparty_daily_usage_window=_read_optional_account(
            value,
            "counterpartyDailyUsageWindow",
        ),
    )


def load_mint_direct_operation(file_path: str | Path) -> MintDirectOperationInput:
    root = _load_operation_document(file_path)
    _reject_unknown_fields(root, _ROOT_FIELDS, "operation")
    accounts = _read_accounts_document(root)
    _reject_unknown_fields(accounts, _MINT_ACCOUNT_FIELDS, "accounts")

    return MintDirectOperationInput(
        pathway_id=_read_required_string(root, "pathwayId", "operation"),
        amount=_read_required_string(root, "amount", "operation"),
        minimum_output=_read_required_string(root, "minimumOutput", "operation"),
        accounts=MintDirectAccountsInput(
            module_activation_state=_read_required_string(
                accounts,
                "moduleActivationState",
                "accounts",
            ),
            chancery_config=_read_required_string(
                accounts,
                "chanceryConfig",
                "accounts",
            ),
            event_authority=_read_required_string(
                accounts,
                "eventAuthority",
                "accounts",
            ),
            pause_state=_read_required_string(accounts, "pauseState", "accounts"),
            asset_config=_read_required_string(accounts, "assetConfig", "accounts"),
            pathway_policy=_read_required_string(
                accounts,
                "pathwayPolicy",
                "accounts",
            ),
            permission_record=_read_required_string(
                accounts,
                "permissionRecord",
                "accounts",
            ),
            source_asset_token_account=_read_required_string(
                accounts,
                "sourceAssetTokenAccount",
                "accounts",
            ),
            reserve_asset_token_account=_read_required_string(
                accounts,
                "reserveAssetTokenAccount",
                "accounts",
            ),
            destination_issued_token_account=_read_required_string(
                accounts,
                "destinationIssuedTokenAccount",
                "accounts",
            ),
            asset_mint=_read_required_string(accounts, "assetMint", "accounts"),
            issued_token_mint=_read_required_string(
                accounts,
                "issuedTokenMint",
                "accounts",
            ),
            mint_authority_pda=_read_required_string(
                accounts,
                "mintAuthorityPda",
                "accounts",
            ),
            asset_token_program=_read_required_string(
                accounts,
                "assetTokenProgram",
                "accounts",
            ),
            issued_token_program=_read_required_string(
                accounts,
                "issuedTokenProgram",
                "accounts",
            ),
            principal=_read_required_string(accounts, "principal", "accounts"),
            asset_pause_state=_read_required_string(
                accounts,
                "assetPauseState",
                "accounts",
            ),
            issued_token_control=_read_required_string(
                accounts,
                "issuedTokenControl",
                "accounts",
            ),
            policy_accounts=_read_policy_accounts(accounts),
        ),
    )


def load_redeem_direct_operation(
    file_path: str | Path,
) -> RedeemDirectOperationInput:
    root = _load_operation_document(file_path)
    _reject_unknown_fields(root, _ROOT_FIELDS, "operation")
    accounts = _read_accounts_document(root)
    _reject_unknown_fields(accounts, _REDEEM_ACCOUNT_FIELDS, "accounts")

    return RedeemDirectOperationInput(
        pathway_id=_read_required_string(root, "pathwayId", "operation"),
        amount=_read_required_string(root, "amount", "operation"),
        minimum_output=_read_required_string(root, "minimumOutput", "operation"),
        accounts=RedeemDirectAccountsInput(
            module_activation_state=_read_required_string(
                accounts,
                "moduleActivationState",
                "accounts",
            ),
            chancery_config=_read_required_string(
                accounts,
                "chanceryConfig",
                "accounts",
            ),
            event_authority=_read_required_string(
                accounts,
                "eventAuthority",
                "accounts",
            ),
            pause_state=_read_required_string(accounts, "pauseState", "accounts"),
            asset_config=_read_required_string(accounts, "assetConfig", "accounts"),
            pathway_policy=_read_required_string(
                accounts,
                "pathwayPolicy",
                "accounts",
            ),
            permission_record=_read_required_string(
                accounts,
                "permissionRecord",
                "accounts",
            ),
            source_issued_token_account=_read_required_string(
                accounts,
                "sourceIssuedTokenAccount",
                "accounts",
            ),
            reserve_asset_token_account=_read_required_string(
                accounts,
                "reserveAssetTokenAccount",
                "accounts",
            ),
            destination_asset_token_account=_read_required_string(
                accounts,
                "destinationAssetTokenAccount",
                "accounts",
            ),
            asset_mint=_read_required_string(accounts, "assetMint", "accounts"),
            issued_token_mint=_read_required_string(
                accounts,
                "issuedTokenMint",
                "accounts",
            ),
            reserve_authority_pda=_read_required_string(
                accounts,
                "reserveAuthorityPda",
                "accounts",
            ),
            asset_token_program=_read_required_string(
                accounts,
                "assetTokenProgram",
                "accounts",
            ),
            issued_token_program=_read_required_string(
                accounts,
                "issuedTokenProgram",
                "accounts",
            ),
            principal=_read_required_string(accounts, "principal", "accounts"),
            asset_pause_state=_read_required_string(
                accounts,
                "assetPauseState",
                "accounts",
            ),
            issued_token_control=_read_required_string(
                accounts,
                "issuedTokenControl",
                "accounts",
            ),
            policy_accounts=_read_policy_accounts(accounts),
        ),
    )
