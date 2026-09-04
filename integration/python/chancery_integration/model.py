from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class AccountMetaSpec:
    name: str
    address: str
    is_signer: bool
    is_writable: bool


@dataclass(frozen=True, slots=True)
class InstructionSpec:
    program_id: str
    accounts: tuple[AccountMetaSpec, ...]
    data: bytes


@dataclass(frozen=True, slots=True)
class DirectSettlementPolicyAccountsInput:
    fee_policy: str | None
    fee_recipient_token_account: str | None
    limit_policy: str | None
    hourly_usage_window: str | None
    daily_usage_window: str | None
    weekly_usage_window: str | None
    monthly_usage_window: str | None
    evidence_policy: str | None
    asset_limit_policy: str | None
    asset_daily_usage_window: str | None
    counterparty_limit_policy: str | None
    counterparty_daily_usage_window: str | None


@dataclass(frozen=True, slots=True)
class MintDirectAccountsInput:
    module_activation_state: str
    chancery_config: str
    event_authority: str
    pause_state: str
    asset_config: str
    pathway_policy: str
    permission_record: str
    source_asset_token_account: str
    reserve_asset_token_account: str
    destination_issued_token_account: str
    asset_mint: str
    issued_token_mint: str
    mint_authority_pda: str
    asset_token_program: str
    issued_token_program: str
    principal: str
    asset_pause_state: str
    issued_token_control: str
    policy_accounts: DirectSettlementPolicyAccountsInput


@dataclass(frozen=True, slots=True)
class RedeemDirectAccountsInput:
    module_activation_state: str
    chancery_config: str
    event_authority: str
    pause_state: str
    asset_config: str
    pathway_policy: str
    permission_record: str
    source_issued_token_account: str
    reserve_asset_token_account: str
    destination_asset_token_account: str
    asset_mint: str
    issued_token_mint: str
    reserve_authority_pda: str
    asset_token_program: str
    issued_token_program: str
    principal: str
    asset_pause_state: str
    issued_token_control: str
    policy_accounts: DirectSettlementPolicyAccountsInput


@dataclass(frozen=True, slots=True)
class MintDirectOperationInput:
    pathway_id: str
    amount: str
    minimum_output: str
    accounts: MintDirectAccountsInput


@dataclass(frozen=True, slots=True)
class RedeemDirectOperationInput:
    pathway_id: str
    amount: str
    minimum_output: str
    accounts: RedeemDirectAccountsInput


MarketMakerSettlementAction = Literal["mint", "redeem"]


@dataclass(frozen=True, slots=True)
class PreparedMarketMakerSettlement:
    action: MarketMakerSettlementAction
    principal: str
    input_amount: str
    minimum_output: str
    instruction: InstructionSpec


@dataclass(frozen=True, slots=True)
class SettlementSimulationResult:
    accepted: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class SettlementConfirmationResult:
    confirmed: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class ExecutedMarketMakerSettlement:
    action: MarketMakerSettlementAction
    signature: str
