from __future__ import annotations

import json
from dataclasses import dataclass, fields, is_dataclass
from typing import Callable, Iterable

from .account import decode_chancery_account
from .base58_codec import encode_base58, normalize_public_key
from .chancery_protocol import (
    PATHWAY_KIND_VALUE,
    ROLE_CAN_EXECUTE_SETTLEMENT,
    ROLE_CAN_USE_TRILATERAL_PATHWAY,
    SCOPE_ASSET,
    SCOPE_COUNTERPARTY,
    SCOPE_EXECUTOR,
    SCOPE_PATHWAY,
    SETTLEMENT_ACTION_VALUE,
    SETTLEMENT_MODE_VALUE,
    STATUS_PATHWAY_PAUSE,
    WINDOW_DAILY,
    WINDOW_HOURLY,
    WINDOW_MONTHLY,
    WINDOW_WEEKLY,
    FeeQuote,
    LimitObservation,
    NamedProgramAddress,
    PermissionObservation,
    SettlementPolicyObservation,
    bytes32_from_input,
    bytes32_hex,
    compute_fee_quote,
    compute_settlement_gross_output,
    derive_asset_config_address,
    derive_asset_pause_state_address,
    derive_evidence_policy_address,
    derive_fee_policy_address,
    derive_limit_policy_address,
    derive_pathway_policy_address,
    derive_permission_record_address,
    derive_settlement_intent_address,
    derive_settlement_policy_address,
    derive_singleton_address,
    derive_usage_window_address,
    dimension_scope_hash,
    is_zero_bytes32,
    known_pda_address,
    observe_limit_policy,
    observe_settlement_policy,
    pathway_is_active,
    permission_observation,
    policy_scope_hash,
    require_bytes,
    require_int_array_field,
    require_int_field,
    require_public_key_field,
    required_principal_role,
    settlement_instruction_name,
)
from .discovery import ChanceryStateDiscovery, discover_chancery_state
from .event import ChanceryEventOccurrence
from .instruction import ChanceryInstruction, build_chancery_instruction
from .rpc import (
    ChanceryRpc,
    RpcAccountInfo,
    RpcCommitment,
    RpcSignatureStatus,
    RpcSimulationResult,
)
from .schema import CHANCERY_PROGRAM_ADDRESS, ZERO_ADDRESS, account_schema
from .solana_transaction import (
    AddressLookupTable,
    SignedSolanaTransaction,
    SolanaInstruction,
    SolanaInstructionAccountMeta,
    SolanaKeypair,
    compile_unversioned_message,
    compile_version_zero_message,
    parse_address_lookup_table_account,
    sign_solana_transaction,
)
from .spl_token import (
    DecodedTokenAccount,
    DecodedTokenMint,
    TokenTransferFeeCalculation,
    assert_supported_token_program,
    calculate_token_transfer_fee,
    assert_token_account_binding,
    decode_token_account,
    decode_token_mint,
    derive_associated_token_address,
)

SettlementAction = str
SettlementMode = str
LimitLabel = str

SETTLEMENT_MODULE_ID = 4
MODULE_STATUS_ACTIVE = 2
ASSET_MODE_ACTIVE = 0
ASSET_MODE_WIND_DOWN = 1
COLLATERAL_TRANSFER_HOOK_EXTENSION = 1 << 0
ISSUED_TOKEN_READY_FOR_SETTLEMENT = 1 << 63
SETTLEMENT_EVIDENCE_SUPPORTED_FIELD_MASK = (1 << 19) - 1
OBSERVATION_VALIDITY_SLOTS = 64


@dataclass(frozen=True)
class SettlementOperationRequest:
    action: SettlementAction
    mode: SettlementMode
    asset_mint: str
    principal: str
    amount: int | None = None
    minimum_output: int | None = None
    pathway_id: str | bytes | None = None
    intent_id: str | bytes | None = None
    executor: str | None = None
    principal_b: str | None = None
    source_token_account: str | None = None
    destination_token_account: str | None = None
    fee_recipient_token_account: str | None = None
    rent_refund_recipient: str | None = None
    now_unix_timestamp: int | None = None


@dataclass(frozen=True)
class NormalizedSettlementOperationRequest:
    action: SettlementAction
    mode: SettlementMode
    asset_mint: str
    principal: str
    amount: int | None
    minimum_output: int | None
    pathway_id: bytes | None
    intent_id: bytes | None
    executor: str | None
    principal_b: str | None
    source_token_account: str | None
    destination_token_account: str | None
    fee_recipient_token_account: str | None
    rent_refund_recipient: str | None
    now_unix_timestamp: int


@dataclass(frozen=True)
class ChanceryStateSnapshot:
    address: str
    expected_name: str
    exists: bool
    owner: str | None
    lamports: int | None
    data_length: int
    values: dict[str, object] | None


@dataclass(frozen=True)
class TokenMintSnapshot:
    address: str
    token_program_address: str
    exists: bool
    values: DecodedTokenMint | None


@dataclass(frozen=True)
class TokenAccountSnapshot:
    address: str
    token_program_address: str
    selection: str
    exists: bool
    values: DecodedTokenAccount | None


@dataclass(frozen=True)
class PathwayCandidate:
    address: str
    pathway_id: str
    asset_mint: str
    issued_token_mint: str
    pathway_kind: int
    designated_executor: str
    active: bool
    matches_requested_asset: bool
    matches_issued_token: bool
    matches_mode: bool
    matches_requested_pathway_id: bool
    canonical_pda: bool


@dataclass(frozen=True)
class ResolvedPermission:
    label: str
    address: str
    required_role: int
    snapshot: ChanceryStateSnapshot
    observation: PermissionObservation | None


@dataclass(frozen=True)
class ResolvedLimitDimension:
    label: LimitLabel
    policy: ChanceryStateSnapshot | None
    scope_hash: bytes | None
    windows: dict[str, ChanceryStateSnapshot | None]
    observation: LimitObservation | None
    validation_issues: tuple[str, ...]


@dataclass(frozen=True)
class SettlementAmountResolution:
    input_amount: int
    gross_output: int
    minimum_output: int
    limit_notional: int
    source_balance: int | None
    reserve_balance: int | None


@dataclass(frozen=True)
class SettlementEffectiveQuote:
    action: SettlementAction
    current_epoch: int
    configured_rate_e9: int
    configured_gross_output_from_requested_input: int
    rate_input_amount: int
    gross_output: int
    input_asset_transfer: TokenTransferFeeCalculation
    chancery_fee_amount: int
    chancery_fee_basis_points: int | None
    output_before_principal_transfer: int
    principal_asset_transfer: TokenTransferFeeCalculation
    principal_received_amount: int
    routed_fee_transfer: TokenTransferFeeCalculation | None
    fee_recipient_received_amount: int
    all_in_output_reduction: int
    all_in_fee_basis_points: int | None
    effective_output_rate_e9: int | None
    requires_simulation_for_exact_amount: bool
    observations: tuple[str, ...]


@dataclass(frozen=True)
class SettlementEffectiveQuoteResolution:
    gross_output: int
    fee_quote: FeeQuote
    effective_quote: SettlementEffectiveQuote


@dataclass(frozen=True)
class SettlementPauseObservation:
    current_slot: int
    global_paused: bool
    asset_paused: bool
    pathway_paused: bool


@dataclass(frozen=True)
class ChanceryObservationContext:
    context_slot: int
    block_unix_timestamp: int
    epoch: int
    commitment: RpcCommitment
    expires_after_slot: int
    timestamp_source: str


@dataclass(frozen=True)
class SettlementInspection:
    request: NormalizedSettlementOperationRequest
    observation: ChanceryObservationContext
    instruction_name: str
    pathway_candidates: tuple[PathwayCandidate, ...]
    pathway: ChanceryStateSnapshot
    intent: ChanceryStateSnapshot | None
    core_accounts: dict[str, ChanceryStateSnapshot]
    policies: dict[str, ChanceryStateSnapshot | None]
    permissions: tuple[ResolvedPermission, ...]
    limits: tuple[ResolvedLimitDimension, ...]
    pdas: tuple[NamedProgramAddress, ...]
    token_mints: dict[str, TokenMintSnapshot]
    token_accounts: dict[str, TokenAccountSnapshot]
    reserve_destinations: tuple[ChanceryStateSnapshot, ...]
    fee_quote: FeeQuote
    effective_quote: SettlementEffectiveQuote
    settlement_policy_observation: SettlementPolicyObservation | None
    amounts: SettlementAmountResolution
    pauses: SettlementPauseObservation
    instruction_arguments: dict[str, object]
    instruction_accounts: dict[str, str]
    blocking_issues: tuple[str, ...]
    ready: bool


@dataclass(frozen=True)
class SettlementTransactionRequest:
    fee_payer: str
    keypairs: tuple[SolanaKeypair, ...]
    address_lookup_table_addresses: tuple[str, ...] = ()
    commitment: RpcCommitment | None = None


@dataclass(frozen=True)
class PreparedSettlementTransaction:
    inspection: SettlementInspection
    instruction: ChanceryInstruction
    transaction: SignedSolanaTransaction
    recent_blockhash: str
    last_valid_block_height: int
    lookup_tables: tuple[AddressLookupTable, ...]


@dataclass(frozen=True)
class SimulatedSettlementTransaction:
    prepared: PreparedSettlementTransaction
    simulation: RpcSimulationResult


@dataclass(frozen=True)
class SubmittedSettlementTransaction:
    prepared: PreparedSettlementTransaction
    simulation: RpcSimulationResult
    signature: str
    status: RpcSignatureStatus
    transaction: object | None
    events: object


@dataclass(frozen=True)
class _PolicyResolution:
    snapshot: ChanceryStateSnapshot | None
    pda: NamedProgramAddress | None


@dataclass(frozen=True)
class _OperationIdentity:
    principal_a: str
    principal_b: str
    executor: str
    intent_id: bytes | None
    pathway_id_constraint: bytes | None
    input_amount: int
    intent_minimum_output: int | None
    intent: ChanceryStateSnapshot | None
    settlement_policy: _PolicyResolution
    rent_refund_recipient: str


class ChanceryClient:
    def __init__(
        self,
        rpc_endpoint_or_client: str | ChanceryRpc,
        commitment: RpcCommitment = "confirmed",
    ) -> None:
        self._rpc = ChanceryRpc(rpc_endpoint_or_client) if isinstance(rpc_endpoint_or_client, str) else rpc_endpoint_or_client
        self._commitment = commitment

    def discover(self) -> ChanceryStateDiscovery:
        return discover_chancery_state(self._rpc, self._commitment)

    def decode_transaction_evidence(
        self,
        signature: str,
    ) -> tuple[ChanceryEventOccurrence, ...] | None:
        return self._rpc.get_chancery_events(signature, self._commitment)

    def inspect(self, request_input: SettlementOperationRequest) -> SettlementInspection:
        initial_context_slot = self._rpc.get_slot(self._commitment)
        self._rpc.set_minimum_context_slot(initial_context_slot)
        clock = self._rpc.get_clock(self._commitment)
        self._rpc.set_minimum_context_slot(clock.slot)
        current_slot = clock.slot
        current_epoch = clock.epoch
        block_unix_timestamp = (
            request_input.now_unix_timestamp
            if request_input.now_unix_timestamp is not None
            else clock.unix_timestamp
        )
        request = _normalize_request(request_input, block_unix_timestamp)
        observation = ChanceryObservationContext(
            context_slot=current_slot,
            block_unix_timestamp=block_unix_timestamp,
            epoch=current_epoch,
            commitment=self._commitment,
            expires_after_slot=current_slot + OBSERVATION_VALIDITY_SLOTS,
            timestamp_source=(
                "request_override"
                if request_input.now_unix_timestamp is not None
                else "clock_sysvar"
            ),
        )
        blocking_issues: list[str] = []
        pdas: list[NamedProgramAddress] = []

        core_accounts: dict[str, ChanceryStateSnapshot] = {}
        module_activation_state_address = known_pda_address("module_activation_state")
        chancery_config_address = known_pda_address("chancery_config")
        pause_state_address = known_pda_address("pause_state")
        issued_token_control_address = known_pda_address("issued_token_control")
        asset_config_pda = derive_asset_config_address(request.asset_mint)
        asset_pause_state_pda = derive_asset_pause_state_address(request.asset_mint)
        mint_authority_pda = derive_singleton_address("mint_authority_pda", "mint-authority")
        reserve_authority_pda = derive_singleton_address("reserve_authority_pda", "reserve-authority")
        pdas.extend((asset_config_pda, asset_pause_state_pda, mint_authority_pda, reserve_authority_pda))

        core_accounts["module_activation_state"] = self._load_chancery_state(
            module_activation_state_address, "ModuleActivationState", False
        )
        core_accounts["chancery_config"] = self._load_chancery_state(
            chancery_config_address, "ChanceryConfig", False
        )
        core_accounts["pause_state"] = self._load_chancery_state(pause_state_address, "PauseState", False)
        core_accounts["asset_config"] = self._load_chancery_state(asset_config_pda.address, "AssetConfig", False)
        core_accounts["asset_pause_state"] = self._load_chancery_state(
            asset_pause_state_pda.address, "AssetPauseState", True
        )
        core_accounts["issued_token_control"] = self._load_chancery_state(
            issued_token_control_address, "IssuedTokenControl", False
        )

        config_values = _require_snapshot_values(core_accounts["chancery_config"])
        asset_values = _require_snapshot_values(core_accounts["asset_config"])
        issued_control_values = _require_snapshot_values(core_accounts["issued_token_control"])
        issued_token_mint = require_public_key_field(config_values, "issued_token_mint")
        issued_token_program = assert_supported_token_program(
            require_public_key_field(config_values, "issued_token_program")
        )
        asset_token_program = assert_supported_token_program(
            require_public_key_field(asset_values, "asset_token_program")
        )

        asset_mint_snapshot = self._load_token_mint(request.asset_mint, asset_token_program)
        issued_token_mint_snapshot = self._load_token_mint(issued_token_mint, issued_token_program)
        if not asset_mint_snapshot.exists or asset_mint_snapshot.values is None:
            blocking_issues.append(f"Asset mint {request.asset_mint} does not exist")
        elif not asset_mint_snapshot.values.initialized:
            blocking_issues.append(f"Asset mint {request.asset_mint} is not initialized")
        if not issued_token_mint_snapshot.exists or issued_token_mint_snapshot.values is None:
            blocking_issues.append(f"Issued-token mint {issued_token_mint} does not exist")
        elif not issued_token_mint_snapshot.values.initialized:
            blocking_issues.append(f"Issued-token mint {issued_token_mint} is not initialized")

        if require_public_key_field(asset_values, "asset_mint") != request.asset_mint:
            blocking_issues.append("AssetConfig asset mint does not match the requested asset mint")
        if require_public_key_field(issued_control_values, "issued_token_mint") != issued_token_mint:
            blocking_issues.append("IssuedTokenControl does not bind the ChanceryConfig issued token mint")
        if require_public_key_field(issued_control_values, "issued_token_program") != issued_token_program:
            blocking_issues.append("IssuedTokenControl does not bind the ChanceryConfig issued token program")
        if require_public_key_field(config_values, "mint_authority_pda") != mint_authority_pda.address:
            blocking_issues.append("ChanceryConfig mint authority does not match the canonical mint-authority PDA")

        operation_identity = self._resolve_operation_identity(request, pdas)
        pathway_candidates = self._discover_pathways(
            request, operation_identity.pathway_id_constraint, issued_token_mint
        )
        selected_candidate = _select_pathway_candidate(pathway_candidates)
        pathway = self._load_chancery_state(selected_candidate.address, "PathwayPolicy", False)
        pathway_values = _require_snapshot_values(pathway)
        pdas.append(derive_pathway_policy_address(require_bytes(pathway_values.get("pathway_id"), "pathway_id", 32)))

        if not pathway_is_active(pathway_values):
            blocking_issues.append("Selected pathway is not active")
        if require_int_field(pathway_values, "source_account_policy") != 0:
            blocking_issues.append("Selected pathway has a nonzero source-account policy unsupported by the settlement runtime")
        if require_int_field(pathway_values, "destination_account_policy") != 0:
            blocking_issues.append("Selected pathway has a nonzero destination-account policy unsupported by the settlement runtime")
        designated_executor = require_public_key_field(pathway_values, "designated_executor")
        if request.mode != "direct" and designated_executor != ZERO_ADDRESS and designated_executor != operation_identity.executor:
            blocking_issues.append("Selected pathway designates a different executor")

        _validate_intent_against_pathway(
            request, operation_identity, pathway_values, issued_token_mint, blocking_issues
        )

        fee_policy = self._resolve_policy_from_identifier(
            pathway_values.get("fee_policy_id"), "FeePolicy", derive_fee_policy_address, pdas
        )
        pathway_limit_policy = self._resolve_policy_from_identifier(
            pathway_values.get("limit_policy_id"), "LimitPolicy", derive_limit_policy_address, pdas
        )
        evidence_policy = self._resolve_policy_from_identifier(
            pathway_values.get("evidence_policy_id"), "EvidencePolicy", derive_evidence_policy_address, pdas
        )
        _validate_core_settlement_gates(
            request.action,
            current_slot,
            _require_snapshot_values(core_accounts["module_activation_state"]),
            asset_values,
            issued_control_values,
            pathway_values,
            None if evidence_policy.snapshot is None else evidence_policy.snapshot.values,
            blocking_issues,
        )
        asset_limit_identifier = (
            pathway_values.get("asset_mint_limit_policy_id")
            if request.action == "mint"
            else pathway_values.get("asset_redeem_limit_policy_id")
        )
        asset_limit_policy = self._resolve_policy_from_identifier(
            asset_limit_identifier, "LimitPolicy", derive_limit_policy_address, pdas
        )
        counterparty_limit_policy = self._resolve_policy_from_identifier(
            pathway_values.get("counterparty_limit_policy_id"), "LimitPolicy", derive_limit_policy_address, pdas
        )
        executor_limit_policy = (
            _PolicyResolution(None, None)
            if request.mode == "direct"
            else self._resolve_policy_from_identifier(
                pathway_values.get("executor_limit_policy_id"), "LimitPolicy", derive_limit_policy_address, pdas
            )
        )

        quote_resolution = compute_settlement_effective_quote(
            request.action,
            operation_identity.input_amount,
            asset_values,
            asset_mint_snapshot.values,
            None if fee_policy.snapshot is None else fee_policy.snapshot.values,
            request.now_unix_timestamp,
            current_epoch,
        )
        gross_output = quote_resolution.gross_output
        fee_quote = quote_resolution.fee_quote
        effective_quote = quote_resolution.effective_quote
        minimum_output = (
            request.minimum_output
            if request.minimum_output is not None
            else operation_identity.intent_minimum_output
            if operation_identity.intent_minimum_output is not None
            else effective_quote.principal_received_amount
        )
        limit_notional = operation_identity.input_amount if request.action == "mint" else gross_output
        settlement_policy_snapshot = operation_identity.settlement_policy.snapshot
        settlement_policy_pda = operation_identity.settlement_policy.pda
        settlement_policy_observation: SettlementPolicyObservation | None = None
        if (
            settlement_policy_snapshot is not None
            and settlement_policy_snapshot.values is not None
            and settlement_policy_pda is not None
        ):
            settlement_policy_observation = observe_settlement_policy(
                settlement_policy_snapshot.values,
                request.mode,
                request.asset_mint,
                operation_identity.principal_a,
                operation_identity.principal_b,
                operation_identity.executor,
                operation_identity.input_amount,
                request.now_unix_timestamp,
                settlement_policy_pda.address,
                settlement_policy_pda.bump,
            )
            blocking_issues.extend(settlement_policy_observation.observations)

        _validate_amount(
            request.action,
            operation_identity.input_amount,
            minimum_output,
            asset_values,
            effective_quote.principal_received_amount,
            blocking_issues,
        )
        blocking_issues.extend(fee_quote.observations)

        permissions = self._resolve_permissions(request, operation_identity, pathway.address, pdas)
        for permission in permissions:
            if permission.observation is None or not permission.observation.usable:
                blocking_issues.append(f"{permission.label} is not usable")

        limits: list[ResolvedLimitDimension] = []
        limits.append(
            self._resolve_pathway_limit_dimension(
                pathway_limit_policy,
                request.action,
                limit_notional,
                request.now_unix_timestamp,
                pdas,
            )
        )
        limits.append(
            self._resolve_daily_limit_dimension(
                "asset",
                asset_limit_policy,
                SCOPE_ASSET,
                request.asset_mint,
                limit_notional,
                request.action,
                request.now_unix_timestamp,
                pdas,
                False,
            )
        )
        if request.mode == "trilateral":
            limits.append(
                self._resolve_daily_limit_dimension(
                    "counterparty_a",
                    counterparty_limit_policy,
                    SCOPE_COUNTERPARTY,
                    operation_identity.principal_a,
                    limit_notional,
                    request.action,
                    request.now_unix_timestamp,
                    pdas,
                    False,
                )
            )
            limits.append(
                self._resolve_daily_limit_dimension(
                    "counterparty_b",
                    counterparty_limit_policy,
                    SCOPE_COUNTERPARTY,
                    operation_identity.principal_b,
                    limit_notional,
                    request.action,
                    request.now_unix_timestamp,
                    pdas,
                    False,
                )
            )
        else:
            limits.append(
                self._resolve_daily_limit_dimension(
                    "counterparty",
                    counterparty_limit_policy,
                    SCOPE_COUNTERPARTY,
                    operation_identity.principal_a,
                    limit_notional,
                    request.action,
                    request.now_unix_timestamp,
                    pdas,
                    request.mode == "delegated",
                )
            )
        if request.mode != "direct":
            limits.append(
                self._resolve_daily_limit_dimension(
                    "executor",
                    executor_limit_policy,
                    SCOPE_EXECUTOR,
                    operation_identity.executor,
                    limit_notional,
                    request.action,
                    request.now_unix_timestamp,
                    pdas,
                    False,
                )
            )
        _validate_limits(limits, blocking_issues)

        reserve_associated = derive_associated_token_address(
            reserve_authority_pda.address, request.asset_mint, asset_token_program
        )
        pdas.append(
            NamedProgramAddress(
                name="reserve_asset_token_account",
                address=reserve_associated.address,
                bump=reserve_associated.bump,
                seeds=(reserve_authority_pda.address, asset_token_program, request.asset_mint),
            )
        )

        source_mint = request.asset_mint if request.action == "mint" else issued_token_mint
        source_program = asset_token_program if request.action == "mint" else issued_token_program
        destination_mint = issued_token_mint if request.action == "mint" else request.asset_mint
        destination_program = issued_token_program if request.action == "mint" else asset_token_program
        destination_owner = operation_identity.principal_b if request.mode == "trilateral" else operation_identity.principal_a

        source_token_account = self._resolve_token_account(
            "source token account",
            operation_identity.principal_a,
            source_mint,
            source_program,
            request.source_token_account,
            True,
        )
        destination_token_account = self._resolve_token_account(
            "destination token account",
            destination_owner,
            destination_mint,
            destination_program,
            request.destination_token_account,
            True,
        )
        reserve_token_account = self._load_token_account_at_address(
            reserve_associated.address,
            reserve_authority_pda.address,
            request.asset_mint,
            asset_token_program,
            "associated_token_account",
            True,
        )

        fee_recipient_token_account = TokenAccountSnapshot(
            address=ZERO_ADDRESS,
            token_program_address=destination_program,
            selection="derived_missing",
            exists=False,
            values=None,
        )
        if fee_quote.routed:
            fee_recipient_token_account = self._resolve_token_account(
                "fee recipient token account",
                fee_quote.fee_recipient_owner,
                destination_mint,
                destination_program,
                request.fee_recipient_token_account,
                True,
            )

        required_reserve_balance = (
            effective_quote.output_before_principal_transfer
            + (fee_quote.net_fee if fee_quote.routed else 0)
            if request.action == "redeem"
            else 0
        )
        _validate_token_accounts(
            request,
            operation_identity.input_amount,
            required_reserve_balance,
            source_token_account,
            destination_token_account,
            reserve_token_account,
            fee_recipient_token_account,
            fee_quote.routed,
            blocking_issues,
        )

        reserve_destinations = self._discover_reserve_destinations(request.asset_mint)
        pauses = _observe_pauses(
            request.action,
            current_slot,
            core_accounts["pause_state"],
            core_accounts["asset_pause_state"],
            pathway,
        )
        if pauses.global_paused:
            blocking_issues.append(f"Global {request.action} pause is active")
        if pauses.asset_paused:
            blocking_issues.append(f"Asset {request.action} pause is active")
        if pauses.pathway_paused:
            blocking_issues.append("Pathway pause is active")

        policies: dict[str, ChanceryStateSnapshot | None] = {
            "fee_policy": fee_policy.snapshot,
            "pathway_limit_policy": pathway_limit_policy.snapshot,
            "evidence_policy": evidence_policy.snapshot,
            "settlement_policy": operation_identity.settlement_policy.snapshot,
            "asset_limit_policy": asset_limit_policy.snapshot,
            "counterparty_limit_policy": counterparty_limit_policy.snapshot,
            "executor_limit_policy": executor_limit_policy.snapshot,
        }
        token_accounts = {
            "source": source_token_account,
            "reserve": reserve_token_account,
            "destination": destination_token_account,
            "fee_recipient": fee_recipient_token_account,
        }
        token_mints = {"asset": asset_mint_snapshot, "issued_token": issued_token_mint_snapshot}

        instruction_arguments = _build_instruction_arguments(
            request, operation_identity, pathway_values, minimum_output
        )
        instruction_accounts = _build_instruction_accounts(
            request,
            operation_identity,
            core_accounts,
            pathway,
            permissions,
            policies,
            limits,
            token_accounts,
            request.asset_mint,
            issued_token_mint,
            asset_token_program,
            issued_token_program,
            mint_authority_pda.address,
            reserve_authority_pda.address,
        )

        unique_blocking_issues = tuple(dict.fromkeys(blocking_issues))
        return SettlementInspection(
            request=request,
            observation=observation,
            instruction_name=settlement_instruction_name(request.action, request.mode),
            pathway_candidates=pathway_candidates,
            pathway=pathway,
            intent=operation_identity.intent,
            core_accounts=core_accounts,
            policies=policies,
            permissions=permissions,
            limits=tuple(limits),
            pdas=tuple(pdas),
            token_mints=token_mints,
            token_accounts=token_accounts,
            reserve_destinations=reserve_destinations,
            fee_quote=fee_quote,
            effective_quote=effective_quote,
            settlement_policy_observation=settlement_policy_observation,
            amounts=SettlementAmountResolution(
                input_amount=operation_identity.input_amount,
                gross_output=gross_output,
                minimum_output=minimum_output,
                limit_notional=limit_notional,
                source_balance=None if source_token_account.values is None else source_token_account.values.amount,
                reserve_balance=None if reserve_token_account.values is None else reserve_token_account.values.amount,
            ),
            pauses=pauses,
            instruction_arguments=instruction_arguments,
            instruction_accounts=instruction_accounts,
            blocking_issues=unique_blocking_issues,
            ready=len(unique_blocking_issues) == 0,
        )

    def build_instruction(self, inspection: SettlementInspection) -> ChanceryInstruction:
        _assert_inspection_ready(inspection)
        return build_chancery_instruction(
            inspection.instruction_name,
            inspection.instruction_arguments,
            inspection.instruction_accounts,
            True,
        )

    def prepare_transaction(
        self,
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ) -> PreparedSettlementTransaction:
        commitment = request.commitment or self._commitment
        current_slot = self._rpc.get_slot(commitment)
        if current_slot > inspection.observation.expires_after_slot:
            raise ValueError(
                f"Inspection expired at slot "
                f"{inspection.observation.expires_after_slot}; current slot is {current_slot}"
            )
        instruction = self.build_instruction(inspection)
        fee_payer = normalize_public_key(request.fee_payer)
        latest_blockhash = self._rpc.get_latest_blockhash(commitment)
        solana_instruction = SolanaInstruction(
            program_address=instruction.program_address,
            accounts=tuple(
                SolanaInstructionAccountMeta(
                    address=account.address,
                    is_signer=account.is_signer,
                    is_writable=account.is_writable,
                    name=account.name,
                )
                for account in instruction.accounts
            ),
            data=instruction.data,
        )
        lookup_tables = self._load_address_lookup_tables(request.address_lookup_table_addresses)
        if len(lookup_tables) == 0:
            message = compile_unversioned_message((solana_instruction,), fee_payer, latest_blockhash.blockhash)
        else:
            message = compile_version_zero_message(
                (solana_instruction,), fee_payer, latest_blockhash.blockhash, lookup_tables
            )
        transaction = sign_solana_transaction(message, request.keypairs)
        return PreparedSettlementTransaction(
            inspection=inspection,
            instruction=instruction,
            transaction=transaction,
            recent_blockhash=latest_blockhash.blockhash,
            last_valid_block_height=latest_blockhash.last_valid_block_height,
            lookup_tables=lookup_tables,
        )

    def simulate_transaction(
        self,
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ) -> SimulatedSettlementTransaction:
        prepared = self.prepare_transaction(inspection, request)
        simulation = self._rpc.simulate_transaction(
            prepared.transaction.bytes, request.commitment or self._commitment, True
        )
        return SimulatedSettlementTransaction(prepared=prepared, simulation=simulation)

    def submit_transaction(
        self,
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ) -> SubmittedSettlementTransaction:
        simulated = self.simulate_transaction(inspection, request)
        if simulated.simulation.error is not None:
            raise RuntimeError(
                "Chancery transaction simulation failed: "
                + json.dumps(simulated.simulation.error, separators=(",", ":"))
            )
        commitment = request.commitment or self._commitment
        signature = self._rpc.send_transaction(simulated.prepared.transaction.bytes, commitment, False, 5)
        status = self._confirm_transaction(
            signature, simulated.prepared.last_valid_block_height, commitment
        )
        transaction = self._rpc.get_transaction(signature, commitment)
        events = self._rpc.get_chancery_events(signature, commitment)
        return SubmittedSettlementTransaction(
            prepared=simulated.prepared,
            simulation=simulated.simulation,
            signature=signature,
            status=status,
            transaction=transaction,
            events=events,
        )

    @staticmethod
    def stringify(value: object, spacing: int = 2) -> str:
        return json.dumps(_json_value(value), indent=spacing, sort_keys=True)

    def _resolve_operation_identity(
        self,
        request: NormalizedSettlementOperationRequest,
        pdas: list[NamedProgramAddress],
    ) -> _OperationIdentity:
        if request.mode == "direct":
            if request.amount is None or request.amount <= 0:
                raise ValueError("Direct settlement requires a positive amount")
            return _OperationIdentity(
                principal_a=request.principal,
                principal_b=request.principal,
                executor=request.principal,
                intent_id=None,
                pathway_id_constraint=request.pathway_id,
                input_amount=request.amount,
                intent_minimum_output=None,
                intent=None,
                settlement_policy=_PolicyResolution(None, None),
                rent_refund_recipient=request.rent_refund_recipient or request.principal,
            )
        if request.intent_id is None:
            raise ValueError(f"{request.mode} settlement requires an intent id")
        intent_pda = derive_settlement_intent_address(request.intent_id)
        pdas.append(intent_pda)
        intent = self._load_chancery_state(intent_pda.address, "SettlementIntent", False)
        intent_values = _require_snapshot_values(intent)
        principal_a = require_public_key_field(intent_values, "principal_a")
        principal_b = require_public_key_field(intent_values, "principal_b")
        executor = require_public_key_field(intent_values, "executor")
        if principal_a != request.principal:
            raise ValueError(f"Settlement intent principal A is {principal_a}, not {request.principal}")
        if request.principal_b is not None and request.principal_b != principal_b:
            raise ValueError(f"Settlement intent principal B is {principal_b}, not {request.principal_b}")
        if request.executor is not None and request.executor != executor:
            raise ValueError(f"Settlement intent executor is {executor}, not {request.executor}")
        input_amount = require_int_field(
            intent_values, "asset_amount" if request.action == "mint" else "issued_token_amount"
        )
        if request.amount is not None and request.amount != input_amount:
            raise ValueError(
                f"Requested amount {request.amount} does not match settlement intent amount {input_amount}"
            )
        intent_minimum_output = require_int_field(
            intent_values,
            "minimum_issued_token_amount" if request.action == "mint" else "minimum_asset_amount",
        )
        pathway_id_constraint = require_bytes(intent_values.get("pathway_id"), "intent pathway id", 32)
        if request.pathway_id is not None and bytes32_hex(
            request.pathway_id, "requested pathway id"
        ) != bytes32_hex(pathway_id_constraint, "intent pathway id"):
            raise ValueError("Requested pathway id does not match settlement intent pathway id")
        settlement_policy = self._resolve_policy_from_identifier(
            intent_values.get("policy_id"), "SettlementPolicy", derive_settlement_policy_address, pdas
        )
        return _OperationIdentity(
            principal_a=principal_a,
            principal_b=principal_b,
            executor=executor,
            intent_id=request.intent_id,
            pathway_id_constraint=pathway_id_constraint,
            input_amount=input_amount,
            intent_minimum_output=intent_minimum_output,
            intent=intent,
            settlement_policy=settlement_policy,
            rent_refund_recipient=request.rent_refund_recipient
            or require_public_key_field(intent_values, "rent_refund_recipient"),
        )

    def _discover_pathways(
        self,
        request: NormalizedSettlementOperationRequest,
        pathway_id_constraint: bytes | None,
        issued_token_mint: str,
    ) -> tuple[PathwayCandidate, ...]:
        schema = account_schema("PathwayPolicy")
        size = schema.get("size")
        discriminator = schema.get("discriminator")
        if not isinstance(size, int) or not isinstance(discriminator, list):
            raise ValueError("PathwayPolicy schema is invalid")
        program_accounts = self._rpc.get_program_accounts(
            CHANCERY_PROGRAM_ADDRESS,
            [
                {"dataSize": size},
                {"memcmp": {"offset": 0, "bytes": encode_base58(bytes(discriminator))}},
            ],
            self._commitment,
        )
        candidates: list[PathwayCandidate] = []
        for program_account in program_accounts:
            if program_account.account.owner != CHANCERY_PROGRAM_ADDRESS:
                continue
            decoded = decode_chancery_account(program_account.account.data)
            if decoded.name != "PathwayPolicy":
                continue
            values = decoded.values
            pathway_id = require_bytes(values.get("pathway_id"), "pathway id", 32)
            derived = derive_pathway_policy_address(pathway_id)
            asset_mint = require_public_key_field(values, "asset_mint")
            decoded_issued_token_mint = require_public_key_field(values, "issued_token_mint")
            pathway_kind = require_int_field(values, "pathway_kind")
            candidates.append(
                PathwayCandidate(
                    address=program_account.address,
                    pathway_id=bytes32_hex(pathway_id, "pathway id"),
                    asset_mint=asset_mint,
                    issued_token_mint=decoded_issued_token_mint,
                    pathway_kind=pathway_kind,
                    designated_executor=require_public_key_field(values, "designated_executor"),
                    active=pathway_is_active(values),
                    matches_requested_asset=asset_mint == request.asset_mint,
                    matches_issued_token=decoded_issued_token_mint == issued_token_mint,
                    matches_mode=pathway_kind == PATHWAY_KIND_VALUE[request.mode],
                    matches_requested_pathway_id=pathway_id_constraint is None
                    or bytes32_hex(pathway_id, "pathway id")
                    == bytes32_hex(pathway_id_constraint, "requested pathway id"),
                    canonical_pda=derived.address == program_account.address,
                )
            )
        return tuple(candidates)

    def _resolve_policy_from_identifier(
        self,
        identifier_value: object,
        expected_name: str,
        derive: Callable[[str | bytes], NamedProgramAddress],
        pdas: list[NamedProgramAddress],
    ) -> _PolicyResolution:
        if is_zero_bytes32(identifier_value, f"{expected_name} id"):
            return _PolicyResolution(None, None)
        identifier = require_bytes(identifier_value, f"{expected_name} id", 32)
        pda = derive(identifier)
        pdas.append(pda)
        snapshot = self._load_chancery_state(pda.address, expected_name, False)
        return _PolicyResolution(snapshot, pda)

    def _resolve_permissions(
        self,
        request: NormalizedSettlementOperationRequest,
        identity: _OperationIdentity,
        pathway_policy_address: str,
        pdas: list[NamedProgramAddress],
    ) -> tuple[ResolvedPermission, ...]:
        definitions: list[tuple[str, str, int]] = [
            (
                "principal A permission" if request.mode == "trilateral" else "principal permission",
                identity.principal_a,
                required_principal_role(request.action, request.mode),
            )
        ]
        if request.mode == "trilateral":
            definitions.append(
                ("principal B permission", identity.principal_b, ROLE_CAN_USE_TRILATERAL_PATHWAY)
            )
        if request.mode != "direct":
            definitions.append(("executor permission", identity.executor, ROLE_CAN_EXECUTE_SETTLEMENT))

        resolved: list[ResolvedPermission] = []
        for label, subject, required_role in definitions:
            pda = derive_permission_record_address(
                subject, SCOPE_PATHWAY, pathway_policy_address
            )
            pdas.append(
                NamedProgramAddress(
                    name=label.replace(" ", "_"),
                    address=pda.address,
                    bump=pda.bump,
                    seeds=pda.seeds,
                )
            )
            snapshot = self._load_chancery_state(pda.address, "PermissionRecord", True)
            observation = (
                None
                if snapshot.values is None
                else permission_observation(
                    snapshot.values,
                    required_role,
                    subject,
                    SCOPE_PATHWAY,
                    pathway_policy_address,
                    request.now_unix_timestamp,
                )
            )
            resolved.append(
                ResolvedPermission(
                    label=label,
                    address=pda.address,
                    required_role=required_role,
                    snapshot=snapshot,
                    observation=observation,
                )
            )
        return tuple(resolved)

    def _resolve_pathway_limit_dimension(
        self,
        policy: _PolicyResolution,
        action: SettlementAction,
        proposed_amount: int,
        now_unix_timestamp: int,
        pdas: list[NamedProgramAddress],
    ) -> ResolvedLimitDimension:
        if policy.snapshot is None or policy.snapshot.values is None:
            return _empty_limit_dimension("pathway")
        policy_values = policy.snapshot.values
        scope_hash = policy_scope_hash(policy_values)
        windows = self._load_limit_windows(policy_values, scope_hash, pdas)
        return ResolvedLimitDimension(
            label="pathway",
            policy=policy.snapshot,
            scope_hash=scope_hash,
            windows=windows,
            observation=observe_limit_policy(
                policy_values,
                action,
                proposed_amount,
                _snapshot_values_by_window(windows),
                now_unix_timestamp,
            ),
            validation_issues=(),
        )

    def _resolve_daily_limit_dimension(
        self,
        label: LimitLabel,
        policy: _PolicyResolution,
        scope_kind: int,
        concrete_scope_key: str,
        proposed_amount: int,
        action: SettlementAction,
        now_unix_timestamp: int,
        pdas: list[NamedProgramAddress],
        require_daily_maximum: bool,
    ) -> ResolvedLimitDimension:
        if policy.snapshot is None or policy.snapshot.values is None:
            return _empty_limit_dimension(label)
        policy_values = policy.snapshot.values
        scope_hash = dimension_scope_hash(scope_kind, concrete_scope_key)
        daily_pda = derive_usage_window_address(scope_hash, WINDOW_DAILY)
        pdas.append(
            NamedProgramAddress(
                name=f"{label}_daily_usage_window",
                address=daily_pda.address,
                bump=daily_pda.bump,
                seeds=daily_pda.seeds,
            )
        )
        daily_snapshot = self._load_chancery_state(daily_pda.address, "UsageWindow", True)
        windows = {"hourly": None, "daily": daily_snapshot, "weekly": None, "monthly": None}
        expected_policy_scope_key = concrete_scope_key if scope_kind == SCOPE_ASSET else ZERO_ADDRESS
        return ResolvedLimitDimension(
            label=label,
            policy=policy.snapshot,
            scope_hash=scope_hash,
            windows=windows,
            observation=observe_limit_policy(
                policy_values,
                action,
                proposed_amount,
                _snapshot_values_by_window(windows),
                now_unix_timestamp,
            ),
            validation_issues=_dimension_policy_validation_issues(
                policy_values,
                scope_kind,
                expected_policy_scope_key,
                require_daily_maximum,
            ),
        )

    def _load_limit_windows(
        self,
        policy_values: dict[str, object],
        scope_hash: bytes,
        pdas: list[NamedProgramAddress],
    ) -> dict[str, ChanceryStateSnapshot | None]:
        definitions = (
            (
                "hourly",
                WINDOW_HOURLY,
                require_int_field(policy_values, "per_hour_maximum") != 0
                or require_int_field(policy_values, "maximum_actions_per_hour") != 0,
            ),
            (
                "daily",
                WINDOW_DAILY,
                require_int_field(policy_values, "per_day_maximum") != 0
                or require_int_field(policy_values, "maximum_actions_per_day") != 0,
            ),
            (
                "weekly",
                WINDOW_WEEKLY,
                require_int_field(policy_values, "per_seven_day_maximum") != 0,
            ),
            (
                "monthly",
                WINDOW_MONTHLY,
                require_int_field(policy_values, "per_thirty_day_maximum") != 0,
            ),
        )
        windows: dict[str, ChanceryStateSnapshot | None] = {}
        for name, kind, enforced in definitions:
            if not enforced:
                windows[name] = None
                continue
            pda = derive_usage_window_address(scope_hash, kind)
            pdas.append(
                NamedProgramAddress(
                    name=f"{name}_usage_window",
                    address=pda.address,
                    bump=pda.bump,
                    seeds=pda.seeds,
                )
            )
            windows[name] = self._load_chancery_state(pda.address, "UsageWindow", True)
        return windows

    def _resolve_token_account(
        self,
        label: str,
        owner: str,
        mint: str,
        token_program_address: str,
        override_address: str | None,
        allow_missing: bool,
    ) -> TokenAccountSnapshot:
        if override_address is not None:
            return self._load_token_account_at_address(
                override_address,
                owner,
                mint,
                token_program_address,
                "override",
                allow_missing,
            )
        associated = derive_associated_token_address(owner, mint, token_program_address)
        associated_snapshot = self._load_token_account_at_address(
            associated.address,
            owner,
            mint,
            token_program_address,
            "associated_token_account",
            True,
        )
        if associated_snapshot.exists:
            return associated_snapshot
        owner_accounts = self._rpc.get_token_accounts_by_owner(
            owner, mint, self._commitment
        )
        matches: list[TokenAccountSnapshot] = []
        for owner_account in owner_accounts:
            if owner_account.account.owner != token_program_address:
                continue
            try:
                values = decode_token_account(owner_account.account.data)
                assert_token_account_binding(values, mint, owner, label)
                matches.append(
                    TokenAccountSnapshot(
                        address=owner_account.address,
                        token_program_address=token_program_address,
                        selection="unique_owner_account",
                        exists=True,
                        values=values,
                    )
                )
            except ValueError:
                continue
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f"{label} is ambiguous; supply an explicit token account address")
        if not allow_missing:
            raise ValueError(f"{label} does not exist at {associated.address}")
        return TokenAccountSnapshot(
            address=associated.address,
            token_program_address=token_program_address,
            selection="derived_missing",
            exists=False,
            values=None,
        )

    def _load_token_account_at_address(
        self,
        address_input: str,
        expected_owner: str,
        expected_mint: str,
        token_program_address: str,
        selection: str,
        allow_missing: bool,
    ) -> TokenAccountSnapshot:
        address = normalize_public_key(address_input)
        account = self._rpc.get_account_info(address, self._commitment)
        if account is None:
            if not allow_missing:
                raise ValueError(f"Token account {address} does not exist")
            return TokenAccountSnapshot(
                address=address,
                token_program_address=token_program_address,
                selection="derived_missing",
                exists=False,
                values=None,
            )
        if account.owner != token_program_address:
            raise ValueError(
                f"Token account {address} is owned by {account.owner}, not {token_program_address}"
            )
        values = decode_token_account(account.data)
        assert_token_account_binding(
            values, expected_mint, expected_owner, f"token account {address}"
        )
        return TokenAccountSnapshot(
            address=address,
            token_program_address=token_program_address,
            selection=selection,
            exists=True,
            values=values,
        )

    def _load_token_mint(self, address_input: str, token_program_address: str) -> TokenMintSnapshot:
        address = normalize_public_key(address_input)
        account = self._rpc.get_account_info(address, self._commitment)
        if account is None:
            return TokenMintSnapshot(address, token_program_address, False, None)
        if account.owner != token_program_address:
            raise ValueError(f"Token mint {address} is owned by {account.owner}, not {token_program_address}")
        return TokenMintSnapshot(address, token_program_address, True, decode_token_mint(account.data))

    def _discover_reserve_destinations(self, asset_mint: str) -> tuple[ChanceryStateSnapshot, ...]:
        schema = account_schema("ReserveDestination")
        size = schema.get("size")
        discriminator = schema.get("discriminator")
        if not isinstance(size, int) or not isinstance(discriminator, list):
            raise ValueError("ReserveDestination schema is invalid")
        program_accounts = self._rpc.get_program_accounts(
            CHANCERY_PROGRAM_ADDRESS,
            [
                {"dataSize": size},
                {"memcmp": {"offset": 0, "bytes": encode_base58(bytes(discriminator))}},
            ],
            self._commitment,
        )
        snapshots: list[ChanceryStateSnapshot] = []
        for account in program_accounts:
            if account.account.owner != CHANCERY_PROGRAM_ADDRESS:
                continue
            decoded = decode_chancery_account(account.account.data)
            if decoded.name != "ReserveDestination":
                continue
            if require_public_key_field(decoded.values, "asset_mint") != asset_mint:
                continue
            snapshots.append(
                _snapshot_from_decoded(
                    account.address, account.account, "ReserveDestination", decoded.values
                )
            )
        return tuple(snapshots)

    def _load_chancery_state(
        self,
        address_input: str,
        expected_name: str,
        allow_missing: bool,
    ) -> ChanceryStateSnapshot:
        address = normalize_public_key(address_input)
        account = self._rpc.get_account_info(address, self._commitment)
        if account is None:
            if not allow_missing:
                raise ValueError(f"{expected_name} account {address} does not exist")
            return ChanceryStateSnapshot(address, expected_name, False, None, None, 0, None)
        if account.owner != CHANCERY_PROGRAM_ADDRESS:
            if allow_missing and len(account.data) == 0:
                return ChanceryStateSnapshot(
                    address, expected_name, False, account.owner, account.lamports, 0, None
                )
            raise ValueError(f"{expected_name} account {address} is owned by {account.owner}")
        decoded = decode_chancery_account(account.data)
        if decoded.name != expected_name:
            raise ValueError(f"{address} contains {decoded.name}, expected {expected_name}")
        return _snapshot_from_decoded(address, account, expected_name, decoded.values)

    def _load_address_lookup_tables(
        self, addresses: Iterable[str]
    ) -> tuple[AddressLookupTable, ...]:
        tables: list[AddressLookupTable] = []
        for address_input in addresses:
            address = normalize_public_key(address_input)
            account = self._rpc.get_account_info(address, self._commitment)
            if account is None:
                raise ValueError(f"Address lookup table {address} does not exist")
            tables.append(parse_address_lookup_table_account(address, account.data))
        return tuple(tables)

    def _confirm_transaction(
        self,
        signature: str,
        last_valid_block_height: int,
        commitment: RpcCommitment,
    ) -> RpcSignatureStatus:
        for _ in range(120):
            status = self._rpc.get_signature_status(signature)
            if status is not None:
                if status.error is not None:
                    raise RuntimeError(
                        f"Transaction {signature} failed: "
                        + json.dumps(status.error, separators=(",", ":"))
                    )
                if _commitment_satisfied(status.confirmation_status, commitment):
                    return status
            block_height = self._rpc.get_block_height(commitment)
            if block_height > last_valid_block_height:
                raise RuntimeError(
                    f"Transaction {signature} expired before reaching {commitment}"
                )
            time.sleep(0.5)
        raise RuntimeError(
            f"Transaction {signature} did not reach {commitment} within the confirmation poll limit"
        )


def compute_settlement_effective_quote(
    action: SettlementAction,
    requested_input_amount: int,
    asset_values: dict[str, object],
    asset_mint_values: DecodedTokenMint | None,
    fee_policy_values: dict[str, object] | None,
    now_unix_timestamp: int,
    current_epoch: int,
) -> SettlementEffectiveQuoteResolution:
    if requested_input_amount < 0:
        raise ValueError("Requested input amount must be non-negative")
    configured_rate_e9 = require_int_field(
        asset_values,
        "deposit_rate_e9" if action == "mint" else "redeem_rate_e9",
    )
    configured_gross_output_from_requested_input = compute_settlement_gross_output(
        action,
        requested_input_amount,
        asset_values,
    )
    asset_transfer_fee_config = (
        None if asset_mint_values is None else asset_mint_values.transfer_fee_config
    )
    input_asset_transfer = (
        calculate_token_transfer_fee(
            requested_input_amount,
            asset_transfer_fee_config,
            current_epoch,
        )
        if action == "mint"
        else calculate_token_transfer_fee(0, None, current_epoch)
    )
    rate_input_amount = (
        input_asset_transfer.received_amount if action == "mint" else requested_input_amount
    )
    gross_output = compute_settlement_gross_output(action, rate_input_amount, asset_values)
    gross_input_for_fee = rate_input_amount if action == "mint" else requested_input_amount
    fee_quote = compute_fee_quote(
        action,
        gross_input_for_fee,
        gross_output,
        fee_policy_values,
        now_unix_timestamp,
    )
    principal_asset_transfer = (
        calculate_token_transfer_fee(
            fee_quote.net_output,
            asset_transfer_fee_config,
            current_epoch,
        )
        if action == "redeem"
        else calculate_token_transfer_fee(fee_quote.net_output, None, current_epoch)
    )
    routed_fee_transfer = (
        calculate_token_transfer_fee(
            fee_quote.net_fee,
            asset_transfer_fee_config if action == "redeem" else None,
            current_epoch,
        )
        if fee_quote.routed
        else None
    )
    principal_received_amount = principal_asset_transfer.received_amount
    all_in_output_reduction = max(
        configured_gross_output_from_requested_input - principal_received_amount,
        0,
    )
    observations: list[str] = []
    if asset_mint_values is None:
        observations.append(
            "Asset mint state is unavailable; transfer-fee effects cannot be calculated locally"
        )
    if asset_mint_values is not None and asset_mint_values.has_unmodeled_transfer_behavior:
        observations.append(
            "The asset mint has transfer behavior that requires transaction simulation for an exact received amount"
        )
    effective_quote = SettlementEffectiveQuote(
        action=action,
        current_epoch=current_epoch,
        configured_rate_e9=configured_rate_e9,
        configured_gross_output_from_requested_input=configured_gross_output_from_requested_input,
        rate_input_amount=rate_input_amount,
        gross_output=gross_output,
        input_asset_transfer=input_asset_transfer,
        chancery_fee_amount=fee_quote.net_fee,
        chancery_fee_basis_points=(
            None if gross_output == 0 else fee_quote.net_fee * 10_000 // gross_output
        ),
        output_before_principal_transfer=fee_quote.net_output,
        principal_asset_transfer=principal_asset_transfer,
        principal_received_amount=principal_received_amount,
        routed_fee_transfer=routed_fee_transfer,
        fee_recipient_received_amount=(
            0 if routed_fee_transfer is None else routed_fee_transfer.received_amount
        ),
        all_in_output_reduction=all_in_output_reduction,
        all_in_fee_basis_points=(
            None
            if configured_gross_output_from_requested_input == 0
            else all_in_output_reduction * 10_000
            // configured_gross_output_from_requested_input
        ),
        effective_output_rate_e9=(
            None
            if requested_input_amount == 0
            else principal_received_amount * 1_000_000_000 // requested_input_amount
        ),
        requires_simulation_for_exact_amount=(
            asset_mint_values is None
            or asset_mint_values.has_unmodeled_transfer_behavior
        ),
        observations=tuple(observations),
    )
    return SettlementEffectiveQuoteResolution(
        gross_output=gross_output,
        fee_quote=fee_quote,
        effective_quote=effective_quote,
    )

def _normalize_request(
    request: SettlementOperationRequest,
    observed_unix_timestamp: int,
) -> NormalizedSettlementOperationRequest:
    if request.action not in ("mint", "redeem"):
        raise ValueError(f"Unsupported settlement action: {request.action}")
    if request.mode not in ("direct", "delegated", "trilateral"):
        raise ValueError(f"Unsupported settlement mode: {request.mode}")
    if request.amount is not None and request.amount < 0:
        raise ValueError("Settlement amount cannot be negative")
    if request.minimum_output is not None and request.minimum_output < 0:
        raise ValueError("Minimum output cannot be negative")
    return NormalizedSettlementOperationRequest(
        action=request.action,
        mode=request.mode,
        asset_mint=normalize_public_key(request.asset_mint),
        principal=normalize_public_key(request.principal),
        amount=request.amount,
        minimum_output=request.minimum_output,
        pathway_id=None
        if request.pathway_id is None
        else bytes32_from_input(request.pathway_id, "pathway id"),
        intent_id=None
        if request.intent_id is None
        else bytes32_from_input(request.intent_id, "intent id"),
        executor=None if request.executor is None else normalize_public_key(request.executor),
        principal_b=None
        if request.principal_b is None
        else normalize_public_key(request.principal_b),
        source_token_account=None
        if request.source_token_account is None
        else normalize_public_key(request.source_token_account),
        destination_token_account=None
        if request.destination_token_account is None
        else normalize_public_key(request.destination_token_account),
        fee_recipient_token_account=None
        if request.fee_recipient_token_account is None
        else normalize_public_key(request.fee_recipient_token_account),
        rent_refund_recipient=None
        if request.rent_refund_recipient is None
        else normalize_public_key(request.rent_refund_recipient),
        now_unix_timestamp=(
            observed_unix_timestamp
            if request.now_unix_timestamp is None
            else request.now_unix_timestamp
        ),
    )


def _select_pathway_candidate(candidates: tuple[PathwayCandidate, ...]) -> PathwayCandidate:
    matches = tuple(
        candidate
        for candidate in candidates
        if candidate.matches_requested_asset
        and candidate.matches_issued_token
        and candidate.matches_mode
        and candidate.matches_requested_pathway_id
        and candidate.canonical_pda
    )
    if len(matches) == 0:
        raise ValueError(
            "No canonical Chancery pathway matches the requested asset, issued token, mode, and pathway id"
        )
    if len(matches) > 1:
        raise ValueError("Multiple Chancery pathways match; supply an explicit pathway id")
    return matches[0]


def _validate_intent_against_pathway(
    request: NormalizedSettlementOperationRequest,
    identity: _OperationIdentity,
    pathway_values: dict[str, object],
    issued_token_mint: str,
    issues: list[str],
) -> None:
    if identity.intent is None or identity.intent.values is None:
        return
    intent = identity.intent.values
    if require_int_field(intent, "settlement_mode") != SETTLEMENT_MODE_VALUE[request.mode]:
        issues.append("Settlement intent mode does not match the requested mode")
    if require_int_field(intent, "settlement_action") != SETTLEMENT_ACTION_VALUE[request.action]:
        issues.append("Settlement intent action does not match the requested action")
    if require_public_key_field(intent, "asset_mint") != request.asset_mint:
        issues.append("Settlement intent asset mint does not match the requested asset mint")
    if require_public_key_field(intent, "issued_token_mint") != issued_token_mint:
        issues.append("Settlement intent issued token mint does not match ChanceryConfig")
    if bytes32_hex(intent.get("pathway_id"), "intent pathway id") != bytes32_hex(
        pathway_values.get("pathway_id"), "pathway id"
    ):
        issues.append("Settlement intent pathway id does not match the selected pathway")
    status = require_int_field(intent, "status")
    if status != 0:
        issues.append(f"Settlement intent status is {status}, not pending")
    valid_after = require_int_field(intent, "valid_after_unix_timestamp")
    expires_at = require_int_field(intent, "expires_at_unix_timestamp")
    if valid_after != 0 and request.now_unix_timestamp < valid_after:
        issues.append("Settlement intent is not yet valid")
    if expires_at != 0 and request.now_unix_timestamp >= expires_at:
        issues.append("Settlement intent has expired")


def _validate_amount(
    action: SettlementAction,
    input_amount: int,
    minimum_output: int,
    asset_values: dict[str, object],
    principal_received_amount: int,
    issues: list[str],
) -> None:
    minimum_input = require_int_field(
        asset_values,
        "minimum_deposit_amount" if action == "mint" else "minimum_redeem_amount",
    )
    maximum_input = require_int_field(asset_values, "maximum_single_settlement_amount")
    if input_amount < minimum_input:
        issues.append(f"Input amount {input_amount} is below minimum {minimum_input}")
    if maximum_input != 0 and input_amount > maximum_input:
        issues.append(f"Input amount {input_amount} exceeds maximum {maximum_input}")
    if minimum_output > principal_received_amount:
        issues.append(
            f"Minimum output {minimum_output} exceeds predicted principal receipt {principal_received_amount}"
        )


def _validate_core_settlement_gates(
    action: SettlementAction,
    current_slot: int,
    module_activation_values: dict[str, object],
    asset_values: dict[str, object],
    issued_token_control_values: dict[str, object],
    pathway_values: dict[str, object],
    evidence_policy_values: dict[str, object] | None,
    issues: list[str],
) -> None:
    module_statuses = require_bytes(
        module_activation_values.get("module_statuses"),
        "module_statuses",
        32,
    )
    if module_statuses[SETTLEMENT_MODULE_ID] != MODULE_STATUS_ACTIVE:
        issues.append("Settlement module is not active")

    asset_mode = require_int_field(asset_values, "mode")
    if action == "mint" and asset_mode != ASSET_MODE_ACTIVE:
        issues.append("Asset mode forbids mint settlement")
    if action == "redeem" and asset_mode not in (ASSET_MODE_ACTIVE, ASSET_MODE_WIND_DOWN):
        issues.append("Asset mode forbids redeem settlement")

    _validate_extension_freshness(
        "Asset",
        require_int_field(asset_values, "extension_observed_at_slot"),
        require_int_field(asset_values, "max_extension_observation_age_slots"),
        current_slot,
        issues,
    )
    observed_collateral = require_int_array_field(asset_values, "observed_extension_mask", 2)
    approved_collateral = require_int_array_field(asset_values, "approved_extension_mask", 2)
    asset_forbidden = require_int_array_field(asset_values, "forbidden_extension_mask", 2)
    pathway_collateral_forbidden = require_int_array_field(
        pathway_values,
        "forbidden_collateral_extension_mask",
        2,
    )
    for index in range(2):
        observed = observed_collateral[index]
        protocol_forbidden = COLLATERAL_TRANSFER_HOOK_EXTENSION if index == 0 else 0
        effective_forbidden = asset_forbidden[index] | protocol_forbidden
        if observed & ~approved_collateral[index]:
            issues.append("Asset extension observation contains an extension not approved by AssetConfig")
            break
        if observed & effective_forbidden:
            issues.append("Asset extension observation contains a forbidden extension")
            break
        if observed & pathway_collateral_forbidden[index]:
            issues.append("Asset extension observation is forbidden by the selected pathway")
            break

    control_flags = require_int_field(issued_token_control_values, "control_flags")
    if control_flags & ISSUED_TOKEN_READY_FOR_SETTLEMENT == 0:
        issues.append("Issued token deployment is not ready for settlement")
    _validate_extension_freshness(
        "Issued token",
        require_int_field(issued_token_control_values, "extension_observed_at_slot"),
        require_int_field(issued_token_control_values, "max_extension_observation_age_slots"),
        current_slot,
        issues,
    )
    active_issued_extensions = require_int_array_field(
        issued_token_control_values,
        "active_mint_extension_mask",
        2,
    )
    pathway_issued_forbidden = require_int_array_field(
        pathway_values,
        "forbidden_issued_token_extension_mask",
        2,
    )
    for index in range(2):
        if active_issued_extensions[index] & pathway_issued_forbidden[index]:
            issues.append("Issued-token extension observation is forbidden by the selected pathway")
            break

    evidence_policy_id = require_bytes(pathway_values.get("evidence_policy_id"), "evidence_policy_id", 32)
    has_evidence_policy = not is_zero_bytes32(evidence_policy_id, "evidence_policy_id")
    if has_evidence_policy and evidence_policy_values is None:
        issues.append("Selected pathway requires an evidence policy account")
    if not has_evidence_policy and evidence_policy_values is not None:
        issues.append("Evidence policy account is present but the selected pathway has no evidence policy binding")
    if evidence_policy_values is not None:
        required_field_mask = require_int_array_field(evidence_policy_values, "required_field_mask", 2)
        schema_hash = require_bytes(
            evidence_policy_values.get("counterparty_reporting_schema_hash"),
            "counterparty_reporting_schema_hash",
            32,
        )
        if required_field_mask[1] != 0 or required_field_mask[0] & ~SETTLEMENT_EVIDENCE_SUPPORTED_FIELD_MASK:
            issues.append("Evidence policy requires fields that settlement evidence cannot prove")
        if (
            require_int_field(evidence_policy_values, "allow_freeform_counterparty_fields") != 0
            or not is_zero_bytes32(schema_hash, "counterparty_reporting_schema_hash")
            or require_int_field(evidence_policy_values, "maximum_freeform_field_count") != 0
            or require_int_field(evidence_policy_values, "maximum_freeform_value_bytes") != 0
            or require_int_field(evidence_policy_values, "retention_flags") != 0
        ):
            issues.append("Evidence policy uses a configuration unsupported by settlement evidence")


def _validate_extension_freshness(
    label: str,
    observed_at_slot: int,
    maximum_age_slots: int,
    current_slot: int,
    issues: list[str],
) -> None:
    if observed_at_slot > current_slot:
        issues.append(f"{label} extension observation is future-dated")
        return
    if maximum_age_slots != 0 and current_slot - observed_at_slot > maximum_age_slots:
        issues.append(f"{label} extension observation is stale")


def _validate_limits(limits: Iterable[ResolvedLimitDimension], issues: list[str]) -> None:
    for limit in limits:
        for issue in limit.validation_issues:
            issues.append(f"{limit.label} {issue}")
        observation = limit.observation
        if observation is None:
            continue
        if not observation.per_transaction_allowed:
            issues.append(f"{limit.label} per-transaction limit is exceeded")
        for window in observation.windows:
            if window.clock_regression:
                issues.append(
                    f"{limit.label} {window.name} usage window starts after the canonical current period"
                )
            else:
                if not window.allowed:
                    issues.append(f"{limit.label} {window.name} volume limit is exceeded")
                if not window.action_allowed:
                    issues.append(f"{limit.label} {window.name} action-count limit is exceeded")
            enforced = window.maximum != 0 or window.maximum_action_count != 0
            snapshot = limit.windows.get(window.name)
            if enforced and (snapshot is None or not snapshot.exists):
                issues.append(f"{limit.label} {window.name} usage window does not exist")


def _dimension_policy_validation_issues(
    policy_values: dict[str, object],
    expected_scope_kind: int,
    expected_scope_key: str,
    require_daily_maximum: bool,
) -> tuple[str, ...]:
    issues: list[str] = []
    if require_int_field(policy_values, "scope_kind") != expected_scope_kind:
        issues.append(f"limit policy scope kind does not match {expected_scope_kind}")
    if require_public_key_field(policy_values, "scope_key") != expected_scope_key:
        issues.append(f"limit policy scope key does not match {expected_scope_key}")
    if (
        require_int_field(policy_values, "per_hour_maximum") != 0
        or require_int_field(policy_values, "per_seven_day_maximum") != 0
        or require_int_field(policy_values, "per_thirty_day_maximum") != 0
        or require_int_field(policy_values, "maximum_actions_per_hour") != 0
        or require_int_field(policy_values, "maximum_actions_per_day") != 0
    ):
        issues.append("dimension policy contains caps that settlement does not enforce")
    if require_daily_maximum and require_int_field(policy_values, "per_day_maximum") == 0:
        issues.append("delegated counterparty policy requires a daily maximum")
    return tuple(issues)


def _validate_token_accounts(
    request: NormalizedSettlementOperationRequest,
    input_amount: int,
    required_reserve_balance: int,
    source: TokenAccountSnapshot,
    destination: TokenAccountSnapshot,
    reserve: TokenAccountSnapshot,
    fee_recipient: TokenAccountSnapshot,
    fee_routed: bool,
    issues: list[str],
) -> None:
    if not source.exists or source.values is None:
        issues.append(f"Source token account {source.address} does not exist")
    elif source.values.amount < input_amount:
        issues.append(
            f"Source token balance {source.values.amount} is below input amount {input_amount}"
        )
    if not destination.exists:
        issues.append(f"Destination token account {destination.address} does not exist")
    if not reserve.exists or reserve.values is None:
        issues.append(f"Reserve token account {reserve.address} does not exist")
    elif request.action == "redeem" and reserve.values.amount < required_reserve_balance:
        issues.append(
            f"Reserve balance {reserve.values.amount} is below required reserve outflow "
            f"{required_reserve_balance}"
        )
    if fee_routed and not fee_recipient.exists:
        issues.append(f"Fee recipient token account {fee_recipient.address} does not exist")


def _observe_pauses(
    action: SettlementAction,
    current_slot: int,
    pause_state: ChanceryStateSnapshot,
    asset_pause_state: ChanceryStateSnapshot,
    pathway: ChanceryStateSnapshot,
) -> SettlementPauseObservation:
    action_bit = 1 if action == "mint" else 2
    global_values = _require_snapshot_values(pause_state)
    global_expiry = require_int_field(global_values, "expires_at_slot")
    global_active = global_expiry == 0 or current_slot < global_expiry
    global_paused = global_active and (
        require_int_field(global_values, "global_pause_bits") & action_bit
    ) != 0
    asset_paused = False
    if asset_pause_state.values is not None:
        asset_expiry = require_int_field(asset_pause_state.values, "expires_at_slot")
        asset_active = asset_expiry == 0 or current_slot < asset_expiry
        asset_paused = asset_active and (
            require_int_field(asset_pause_state.values, "asset_pause_bits") & action_bit
        ) != 0
    pathway_values = _require_snapshot_values(pathway)
    pathway_paused = (
        require_int_field(pathway_values, "status_flags") & STATUS_PATHWAY_PAUSE
    ) != 0
    return SettlementPauseObservation(
        current_slot=current_slot,
        global_paused=global_paused,
        asset_paused=asset_paused,
        pathway_paused=pathway_paused,
    )


def _snapshot_from_decoded(
    address: str,
    account: RpcAccountInfo,
    expected_name: str,
    values: dict[str, object],
) -> ChanceryStateSnapshot:
    return ChanceryStateSnapshot(
        address=address,
        expected_name=expected_name,
        exists=True,
        owner=account.owner,
        lamports=account.lamports,
        data_length=len(account.data),
        values=values,
    )


def _require_snapshot_values(snapshot: ChanceryStateSnapshot) -> dict[str, object]:
    if snapshot.values is None:
        raise ValueError(
            f"{snapshot.expected_name} account {snapshot.address} has no decoded values"
        )
    return snapshot.values


def _required_snapshot_address(
    snapshot: ChanceryStateSnapshot | None,
    label: str,
    allow_uninitialized_pda: bool = False,
) -> str:
    if snapshot is None:
        raise ValueError(f"{label} snapshot is missing")
    if not snapshot.exists and not allow_uninitialized_pda:
        raise ValueError(f"{label} account {snapshot.address} does not exist")
    return snapshot.address


def _required_token_address(snapshot: TokenAccountSnapshot | None, label: str) -> str:
    if snapshot is None or not snapshot.exists:
        raise ValueError(f"{label} token account is unavailable")
    return snapshot.address


def _empty_limit_dimension(label: LimitLabel) -> ResolvedLimitDimension:
    return ResolvedLimitDimension(
        label=label,
        policy=None,
        scope_hash=None,
        windows={"hourly": None, "daily": None, "weekly": None, "monthly": None},
        observation=None,
        validation_issues=(),
    )


def _snapshot_values_by_window(
    windows: dict[str, ChanceryStateSnapshot | None],
) -> dict[str, dict[str, object] | None]:
    return {
        name: None if snapshot is None else snapshot.values
        for name, snapshot in windows.items()
    }


def _limit_by_label(
    limits: Iterable[ResolvedLimitDimension], label: LimitLabel
) -> ResolvedLimitDimension | None:
    for limit in limits:
        if limit.label == label:
            return limit
    return None


def _window_address(limit: ResolvedLimitDimension | None, name: str) -> str | None:
    if limit is None:
        return None
    snapshot = limit.windows.get(name)
    return snapshot.address if snapshot is not None and snapshot.exists else None


def _build_instruction_arguments(
    request: NormalizedSettlementOperationRequest,
    identity: _OperationIdentity,
    pathway_values: dict[str, object],
    minimum_output: int,
) -> dict[str, object]:
    pathway_id = require_bytes(pathway_values.get("pathway_id"), "pathway id", 32)
    if request.mode == "direct":
        if request.action == "mint":
            return {
                "pathway_id": pathway_id,
                "asset_amount": identity.input_amount,
                "minimum_issued_token_amount": minimum_output,
            }
        return {
            "pathway_id": pathway_id,
            "issued_token_amount": identity.input_amount,
            "minimum_asset_amount": minimum_output,
        }
    if identity.intent_id is None:
        raise ValueError("Non-direct settlement has no intent id")
    return {"intent_id": identity.intent_id, "pathway_id": pathway_id}


def _build_instruction_accounts(
    request: NormalizedSettlementOperationRequest,
    operation_identity: _OperationIdentity,
    core_accounts: dict[str, ChanceryStateSnapshot],
    pathway: ChanceryStateSnapshot,
    permissions: tuple[ResolvedPermission, ...],
    policies: dict[str, ChanceryStateSnapshot | None],
    limits: Iterable[ResolvedLimitDimension],
    token_accounts: dict[str, TokenAccountSnapshot],
    asset_mint: str,
    issued_token_mint: str,
    asset_token_program: str,
    issued_token_program: str,
    mint_authority_address: str,
    reserve_authority_address: str,
) -> dict[str, str]:
    if len(permissions) == 0:
        raise ValueError("Principal permission resolution is missing")
    direct_permission = permissions[0]
    limit_values = tuple(limits)
    pathway_limit = _limit_by_label(limit_values, "pathway")
    asset_limit = _limit_by_label(limit_values, "asset")
    counterparty_limit = (
        None if request.mode == "trilateral" else _limit_by_label(limit_values, "counterparty")
    )
    executor_limit = (
        None if request.mode == "direct" else _limit_by_label(limit_values, "executor")
    )
    core: dict[str, str | None] = {
        "asset_config": _required_snapshot_address(core_accounts.get("asset_config"), "asset_config"),
        "pathway_policy": pathway.address,
        "source_asset_token_account": _required_token_address(token_accounts.get("source"), "source")
        if request.action == "mint"
        else None,
        "source_issued_token_account": _required_token_address(token_accounts.get("source"), "source")
        if request.action == "redeem"
        else None,
        "reserve_asset_token_account": _required_token_address(token_accounts.get("reserve"), "reserve"),
        "destination_issued_token_account": _required_token_address(
            token_accounts.get("destination"), "destination"
        )
        if request.action == "mint"
        else None,
        "destination_asset_token_account": _required_token_address(
            token_accounts.get("destination"), "destination"
        )
        if request.action == "redeem"
        else None,
        "asset_mint": asset_mint,
        "issued_token_mint": issued_token_mint,
        "mint_authority_pda": mint_authority_address if request.action == "mint" else None,
        "reserve_authority_pda": reserve_authority_address if request.action == "redeem" else None,
        "asset_token_program": asset_token_program,
        "issued_token_program": issued_token_program,
        "asset_pause_state": _required_snapshot_address(
            core_accounts.get("asset_pause_state"), "asset_pause_state", True
        ),
        "fee_policy": None if policies.get("fee_policy") is None else policies["fee_policy"].address,
        "fee_recipient_token_account": token_accounts["fee_recipient"].address
        if token_accounts["fee_recipient"].exists
        else None,
        "limit_policy": None if pathway_limit is None or pathway_limit.policy is None else pathway_limit.policy.address,
        "hourly_usage_window": _window_address(pathway_limit, "hourly"),
        "daily_usage_window": _window_address(pathway_limit, "daily"),
        "weekly_usage_window": _window_address(pathway_limit, "weekly"),
        "monthly_usage_window": _window_address(pathway_limit, "monthly"),
        "evidence_policy": None
        if policies.get("evidence_policy") is None
        else policies["evidence_policy"].address,
        "asset_limit_policy": None if asset_limit is None or asset_limit.policy is None else asset_limit.policy.address,
        "asset_daily_usage_window": _window_address(asset_limit, "daily"),
        "counterparty_limit_policy": None
        if policies.get("counterparty_limit_policy") is None
        else policies["counterparty_limit_policy"].address,
        "counterparty_daily_usage_window": _window_address(counterparty_limit, "daily"),
        "executor_limit_policy": None
        if policies.get("executor_limit_policy") is None
        else policies["executor_limit_policy"].address,
        "executor_daily_usage_window": _window_address(executor_limit, "daily"),
    }

    if request.mode == "direct":
        core["permission_record"] = direct_permission.address
        core["principal"] = operation_identity.principal_a
    elif request.mode == "delegated":
        if len(permissions) < 2 or operation_identity.intent is None:
            raise ValueError("Delegated settlement permission or intent resolution is missing")
        core["intent"] = operation_identity.intent.address
        core["principal_permission_record"] = direct_permission.address
        core["executor_permission_record"] = permissions[1].address
        core["executor"] = operation_identity.executor
        core["principal"] = operation_identity.principal_a
        settlement_policy = policies.get("settlement_policy")
        core["settlement_policy"] = None if settlement_policy is None else settlement_policy.address
        core["rent_refund_recipient"] = operation_identity.rent_refund_recipient
    else:
        if len(permissions) < 3 or operation_identity.intent is None:
            raise ValueError("Trilateral settlement permission or intent resolution is missing")
        counterparty_a = _limit_by_label(limit_values, "counterparty_a")
        counterparty_b = _limit_by_label(limit_values, "counterparty_b")
        core["intent"] = operation_identity.intent.address
        core["principal_a_permission_record"] = direct_permission.address
        core["principal_b_permission_record"] = permissions[1].address
        core["executor_permission_record"] = permissions[2].address
        core["executor"] = operation_identity.executor
        core["principal_a"] = operation_identity.principal_a
        core["principal_b"] = operation_identity.principal_b
        settlement_policy = policies.get("settlement_policy")
        core["settlement_policy"] = None if settlement_policy is None else settlement_policy.address
        core["counterparty_a_daily_usage_window"] = _window_address(counterparty_a, "daily")
        core["counterparty_b_daily_usage_window"] = _window_address(counterparty_b, "daily")
        core["rent_refund_recipient"] = operation_identity.rent_refund_recipient
    return {name: value for name, value in core.items() if value is not None}


def _assert_inspection_ready(inspection: SettlementInspection) -> None:
    if not inspection.ready:
        issues = "\n".join(f"- {issue}" for issue in inspection.blocking_issues)
        raise ValueError(f"Settlement operation is not ready:\n{issues}")


def _commitment_satisfied(actual: RpcCommitment | None, required: RpcCommitment) -> bool:
    if actual is None:
        return False
    rank = {"processed": 0, "confirmed": 1, "finalized": 2}
    return rank[actual] >= rank[required]


def _json_value(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: _json_value(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, bytearray):
        return "0x" + bytes(value).hex()
    if isinstance(value, memoryview):
        return "0x" + bytes(value).hex()
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_value(item) for item in value]
    return value
