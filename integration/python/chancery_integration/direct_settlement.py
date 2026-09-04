from __future__ import annotations

import re
import struct

from .base58_codec import assert_public_key
from .model import (
    AccountMetaSpec,
    DirectSettlementPolicyAccountsInput,
    InstructionSpec,
    MintDirectOperationInput,
    RedeemDirectOperationInput,
)


CHANCERY_PROGRAM_ID = "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz"
DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111"
MAXIMUM_U64 = 18_446_744_073_709_551_615

_MINT_DIRECT_DISCRIMINATOR = bytes((4, 1))
_REDEEM_DIRECT_DISCRIMINATOR = bytes((4, 2))
_PATHWAY_PATTERN = re.compile(r"[0-9a-fA-F]{64}\Z")
_UNSIGNED_DECIMAL_PATTERN = re.compile(r"[0-9]+\Z")


def _required_account(
    name: str,
    address: str,
    *,
    is_signer: bool,
    is_writable: bool,
) -> AccountMetaSpec:
    assert_public_key(
        address,
        f"accounts.{name}",
        allow_default_public_key=False,
    )
    return AccountMetaSpec(
        name=name,
        address=address,
        is_signer=is_signer,
        is_writable=is_writable,
    )


def _optional_account(
    name: str,
    address: str | None,
    *,
    is_writable: bool,
) -> AccountMetaSpec:
    if address is None:
        return AccountMetaSpec(
            name=name,
            address=DEFAULT_PUBLIC_KEY,
            is_signer=False,
            is_writable=is_writable,
        )
    assert_public_key(
        address,
        f"accounts.policyAccounts.{name}",
        allow_default_public_key=False,
    )
    return AccountMetaSpec(
        name=name,
        address=address,
        is_signer=False,
        is_writable=is_writable,
    )


def _policy_account_metas(
    accounts: DirectSettlementPolicyAccountsInput,
) -> tuple[AccountMetaSpec, ...]:
    return (
        _optional_account("feePolicy", accounts.fee_policy, is_writable=False),
        _optional_account(
            "feeRecipientTokenAccount",
            accounts.fee_recipient_token_account,
            is_writable=True,
        ),
        _optional_account("limitPolicy", accounts.limit_policy, is_writable=False),
        _optional_account(
            "hourlyUsageWindow",
            accounts.hourly_usage_window,
            is_writable=True,
        ),
        _optional_account(
            "dailyUsageWindow",
            accounts.daily_usage_window,
            is_writable=True,
        ),
        _optional_account(
            "weeklyUsageWindow",
            accounts.weekly_usage_window,
            is_writable=True,
        ),
        _optional_account(
            "monthlyUsageWindow",
            accounts.monthly_usage_window,
            is_writable=True,
        ),
        _optional_account(
            "evidencePolicy",
            accounts.evidence_policy,
            is_writable=False,
        ),
        _optional_account(
            "assetLimitPolicy",
            accounts.asset_limit_policy,
            is_writable=False,
        ),
        _optional_account(
            "assetDailyUsageWindow",
            accounts.asset_daily_usage_window,
            is_writable=True,
        ),
        _optional_account(
            "counterpartyLimitPolicy",
            accounts.counterparty_limit_policy,
            is_writable=False,
        ),
        _optional_account(
            "counterpartyDailyUsageWindow",
            accounts.counterparty_daily_usage_window,
            is_writable=True,
        ),
    )


def parse_pathway_id(pathway_id: str) -> bytes:
    normalized = pathway_id[2:] if pathway_id.startswith("0x") else pathway_id
    if _PATHWAY_PATTERN.fullmatch(normalized) is None:
        raise ValueError("pathway_id must contain exactly 64 hexadecimal characters")
    return bytes.fromhex(normalized)


def parse_unsigned_u64(value: str, field_name: str, *, allow_zero: bool) -> int:
    if _UNSIGNED_DECIMAL_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{field_name} must be an unsigned decimal string")
    parsed = int(value, 10)
    if (not allow_zero and parsed == 0) or parsed > MAXIMUM_U64:
        range_start = 0 if allow_zero else 1
        raise ValueError(
            f"{field_name} must be between {range_start} and {MAXIMUM_U64}"
        )
    return parsed


def _encode_direct_settlement_data(
    discriminator: bytes,
    pathway_id: str,
    amount: str,
    minimum_output: str,
) -> bytes:
    return b"".join(
        (
            discriminator,
            parse_pathway_id(pathway_id),
            struct.pack("<Q", parse_unsigned_u64(amount, "amount", allow_zero=False)),
            struct.pack(
                "<Q",
                parse_unsigned_u64(
                    minimum_output,
                    "minimum_output",
                    allow_zero=True,
                ),
            ),
        )
    )


def build_mint_direct_instruction(
    operation: MintDirectOperationInput,
) -> InstructionSpec:
    accounts = operation.accounts
    account_metas = (
        _required_account(
            "moduleActivationState",
            accounts.module_activation_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "chanceryConfig",
            accounts.chancery_config,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "eventAuthority",
            accounts.event_authority,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "pauseState",
            accounts.pause_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "assetConfig",
            accounts.asset_config,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "pathwayPolicy",
            accounts.pathway_policy,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "permissionRecord",
            accounts.permission_record,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "sourceAssetTokenAccount",
            accounts.source_asset_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "reserveAssetTokenAccount",
            accounts.reserve_asset_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "destinationIssuedTokenAccount",
            accounts.destination_issued_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "assetMint",
            accounts.asset_mint,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenMint",
            accounts.issued_token_mint,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "mintAuthorityPda",
            accounts.mint_authority_pda,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "assetTokenProgram",
            accounts.asset_token_program,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenProgram",
            accounts.issued_token_program,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "principal",
            accounts.principal,
            is_signer=True,
            is_writable=False,
        ),
        _required_account(
            "assetPauseState",
            accounts.asset_pause_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenControl",
            accounts.issued_token_control,
            is_signer=False,
            is_writable=False,
        ),
        *_policy_account_metas(accounts.policy_accounts),
        AccountMetaSpec(
            name="eventProgram",
            address=CHANCERY_PROGRAM_ID,
            is_signer=False,
            is_writable=False,
        ),
    )
    if len(account_metas) != 31:
        raise AssertionError(
            f"mint_direct must contain 31 account positions, received {len(account_metas)}"
        )
    return InstructionSpec(
        program_id=CHANCERY_PROGRAM_ID,
        accounts=account_metas,
        data=_encode_direct_settlement_data(
            _MINT_DIRECT_DISCRIMINATOR,
            operation.pathway_id,
            operation.amount,
            operation.minimum_output,
        ),
    )


def build_redeem_direct_instruction(
    operation: RedeemDirectOperationInput,
) -> InstructionSpec:
    accounts = operation.accounts
    account_metas = (
        _required_account(
            "moduleActivationState",
            accounts.module_activation_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "chanceryConfig",
            accounts.chancery_config,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "eventAuthority",
            accounts.event_authority,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "pauseState",
            accounts.pause_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "assetConfig",
            accounts.asset_config,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "pathwayPolicy",
            accounts.pathway_policy,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "permissionRecord",
            accounts.permission_record,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "sourceIssuedTokenAccount",
            accounts.source_issued_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "reserveAssetTokenAccount",
            accounts.reserve_asset_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "destinationAssetTokenAccount",
            accounts.destination_asset_token_account,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "assetMint",
            accounts.asset_mint,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenMint",
            accounts.issued_token_mint,
            is_signer=False,
            is_writable=True,
        ),
        _required_account(
            "reserveAuthorityPda",
            accounts.reserve_authority_pda,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "assetTokenProgram",
            accounts.asset_token_program,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenProgram",
            accounts.issued_token_program,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "principal",
            accounts.principal,
            is_signer=True,
            is_writable=False,
        ),
        _required_account(
            "assetPauseState",
            accounts.asset_pause_state,
            is_signer=False,
            is_writable=False,
        ),
        _required_account(
            "issuedTokenControl",
            accounts.issued_token_control,
            is_signer=False,
            is_writable=False,
        ),
        *_policy_account_metas(accounts.policy_accounts),
        AccountMetaSpec(
            name="eventProgram",
            address=CHANCERY_PROGRAM_ID,
            is_signer=False,
            is_writable=False,
        ),
    )
    if len(account_metas) != 31:
        raise AssertionError(
            f"redeem_direct must contain 31 account positions, received {len(account_metas)}"
        )
    return InstructionSpec(
        program_id=CHANCERY_PROGRAM_ID,
        accounts=account_metas,
        data=_encode_direct_settlement_data(
            _REDEEM_DIRECT_DISCRIMINATOR,
            operation.pathway_id,
            operation.amount,
            operation.minimum_output,
        ),
    )
