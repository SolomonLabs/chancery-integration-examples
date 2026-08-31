from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import cast

from .base58_codec import decode_base58, decode_public_key, encode_base58, normalize_public_key
from .program_address import find_program_address
from .schema import CHANCERY_PROGRAM_ADDRESS, CHANCERY_SCHEMA, ZERO_ADDRESS

SettlementAction = str
SettlementMode = str

SETTLEMENT_ACTION_VALUE = {"mint": 0, "redeem": 1}
SETTLEMENT_MODE_VALUE = {"direct": 0, "delegated": 1, "trilateral": 2}
PATHWAY_KIND_VALUE = {"direct": 0, "delegated": 1, "trilateral": 2}

ROLE_CAN_MINT_DIRECT = 1 << 0
ROLE_CAN_REDEEM_DIRECT = 1 << 1
ROLE_CAN_MINT_DELEGATED = 1 << 2
ROLE_CAN_REDEEM_DELEGATED = 1 << 3
ROLE_CAN_EXECUTE_SETTLEMENT = 1 << 4
ROLE_CAN_USE_TRILATERAL_PATHWAY = 1 << 5

SCOPE_GLOBAL = 0
SCOPE_ASSET = 1
SCOPE_PATHWAY = 2
SCOPE_DESTINATION = 3
SCOPE_EXECUTOR = 4
SCOPE_COUNTERPARTY = 12

WINDOW_HOURLY = 0
WINDOW_DAILY = 1
WINDOW_WEEKLY = 2
WINDOW_MONTHLY = 3

STATUS_INITIALIZED = 1 << 0
STATUS_PATHWAY_PAUSE = 1 << 3
STATUS_MINT_PAUSED = 1 << 4
STATUS_REDEEM_PAUSED = 1 << 5
PERMISSION_PAUSED = 1 << 0

FEE_IN_ASSET = 1 << 0
FEE_IN_ISSUED_TOKEN = 1 << 1
FEE_PERCENT_ON_INPUT = 1 << 2
FEE_REBATE_TO_PRINCIPAL = 1 << 3
FEE_ACTIVE = 1 << 4

FEE_RECIPIENT_NONE = 0
FEE_RECIPIENT_PROTOCOL_TREASURY = 1
FEE_RECIPIENT_OPERATOR_OWNED_WALLET = 2
FEE_RECIPIENT_PATHWAY_SPECIFIC = 3
FEE_RECIPIENT_RESERVE_RETENTION = 4

ROUNDING_FLOOR = 0
ROUNDING_CEILING = 1
ROUNDING_NEAREST = 2
RATE_PRECISION_E9 = 1_000_000_000


@dataclass(frozen=True)
class NamedProgramAddress:
    name: str
    address: str
    bump: int
    seeds: tuple[str, ...]


@dataclass(frozen=True)
class FeeQuote:
    gross_input: int
    gross_output: int
    denomination: str
    assessed_fee: int
    nominal_rebate: int
    effective_rebate: int
    net_fee: int
    net_output: int
    routed: bool
    fee_recipient_owner: str
    effective: bool
    observations: tuple[str, ...]


@dataclass(frozen=True)
class PermissionObservation:
    required_role: int
    held_roles: int
    has_required_role: bool
    subject_matches: bool
    scope_matches: bool
    role_schema_matches: bool
    paused: bool
    expired: bool
    usable: bool


@dataclass(frozen=True)
class SettlementPolicyObservation:
    identity_matches: bool
    bump_matches: bool
    policy_id_nonzero: bool
    policy_flags_valid: bool
    allowed_settlement_modes: int
    mode_mask_valid: bool
    mode_allowed: bool
    asset_allowed: bool
    principal_a_allowed: bool
    principal_b_allowed: bool
    executor_allowed: bool
    minimum_notional: int
    maximum_notional: int
    notional_allowed: bool
    valid_after_unix_timestamp: int
    expires_at_unix_timestamp: int
    timestamp_range_valid: bool
    temporally_effective: bool
    usable: bool
    observations: tuple[str, ...]


@dataclass(frozen=True)
class LimitWindowObservation:
    name: str
    window_kind: int
    maximum: int
    accumulator_field: str
    stored_window_start_unix_timestamp: int | None
    canonical_window_start_unix_timestamp: int
    rolled_before_check: bool
    clock_regression: bool
    current_amount: int
    proposed_amount: int
    projected_amount: int
    remaining_before: int | None
    remaining_after: int | None
    allowed: bool
    current_action_count: int
    projected_action_count: int
    maximum_action_count: int
    action_remaining_before: int | None
    action_remaining_after: int | None
    action_allowed: bool


@dataclass(frozen=True)
class LimitObservation:
    action: SettlementAction
    accumulator_field: str
    per_transaction_maximum: int
    proposed_amount: int
    per_transaction_remaining_before: int | None
    per_transaction_remaining_after: int | None
    per_transaction_allowed: bool
    windows: tuple[LimitWindowObservation, ...]

def required_principal_role(action: SettlementAction, mode: SettlementMode) -> int:
    if mode == "direct":
        return ROLE_CAN_MINT_DIRECT if action == "mint" else ROLE_CAN_REDEEM_DIRECT
    return ROLE_CAN_MINT_DELEGATED if action == "mint" else ROLE_CAN_REDEEM_DELEGATED


def settlement_instruction_name(action: SettlementAction, mode: SettlementMode) -> str:
    return f"{action}_{mode}"


def bytes32_from_input(value: str | bytes | bytearray | memoryview, label: str) -> bytes:
    if not isinstance(value, str):
        data = bytes(value)
    elif value.startswith("0x"):
        data = _decode_hex(value[2:], label)
    elif value.startswith("hex:"):
        data = _decode_hex(value[4:], label)
    elif value.startswith("base58:"):
        data = decode_base58(value[7:])
    elif value.startswith("utf8:"):
        text = value[5:].encode("utf-8")
        if len(text) > 32:
            raise ValueError(f"{label} UTF-8 value exceeds 32 bytes")
        data = text.ljust(32, b"\x00")
    elif len(value) == 64 and all(character in "0123456789abcdefABCDEF" for character in value):
        data = _decode_hex(value, label)
    else:
        data = decode_base58(value)
    if len(data) != 32:
        raise ValueError(f"{label} must resolve to exactly 32 bytes")
    return data


def bytes32_hex(value: object, label: str) -> str:
    return "0x" + require_bytes(value, label, 32).hex()


def is_zero_bytes32(value: object, label: str) -> bool:
    return require_bytes(value, label, 32) == bytes(32)


def derive_named_program_address(name: str, seeds: list[bytes]) -> NamedProgramAddress:
    result = find_program_address(seeds, CHANCERY_PROGRAM_ADDRESS)
    return NamedProgramAddress(
        name=name,
        address=result.address,
        bump=result.bump,
        seeds=tuple("0x" + seed.hex() for seed in seeds),
    )


def derive_asset_config_address(asset_mint: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("asset_config", [b"asset-config", decode_public_key(asset_mint)])


def derive_asset_pause_state_address(asset_mint: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("asset_pause_state", [b"asset-pause", decode_public_key(asset_mint)])


def derive_pathway_policy_address(pathway_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("pathway_policy", [b"pathway-policy", bytes32_from_input(pathway_id, "pathway id")])


def derive_permission_record_address(subject: str | bytes, scope_kind: int, scope_key: str | bytes) -> NamedProgramAddress:
    _assert_byte(scope_kind, "permission scope kind")
    return derive_named_program_address(
        "permission_record",
        [b"permission", decode_public_key(subject), bytes([scope_kind]), decode_public_key(scope_key)],
    )


def derive_fee_policy_address(fee_policy_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("fee_policy", [b"fee-policy", bytes32_from_input(fee_policy_id, "fee policy id")])


def derive_limit_policy_address(limit_policy_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("limit_policy", [b"limit-policy", bytes32_from_input(limit_policy_id, "limit policy id")])


def derive_evidence_policy_address(evidence_policy_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("evidence_policy", [b"evidence-policy", bytes32_from_input(evidence_policy_id, "evidence policy id")])


def derive_settlement_policy_address(policy_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("settlement_policy", [b"settlement-policy", bytes32_from_input(policy_id, "settlement policy id")])


def derive_settlement_intent_address(intent_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address("settlement_intent", [b"settlement-intent", bytes32_from_input(intent_id, "intent id")])


def derive_usage_window_address(scope_hash: bytes, window_kind: int) -> NamedProgramAddress:
    if len(scope_hash) != 32:
        raise ValueError("Usage-window scope hash must contain 32 bytes")
    _assert_byte(window_kind, "window kind")
    return derive_named_program_address("usage_window", [b"usage-window", scope_hash, bytes([window_kind])])


def derive_authority_transfer_address(role_kind: int) -> NamedProgramAddress:
    _assert_byte(role_kind, "authority role kind")
    return derive_named_program_address("authority_transfer", [b"authority-transfer", bytes([role_kind])])


def derive_basic_freeze_record_address(issued_token_account: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address(
        "basic_freeze_record",
        [b"basic-freeze-record", decode_public_key(issued_token_account)],
    )


def derive_cross_chain_signer_set_address(signer_set_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address(
        "cross_chain_signer_set",
        [b"cross-chain-signer-set", bytes32_from_input(signer_set_id, "signer set id")],
    )


def derive_outbound_reclaim_record_address(
    remote_chain_kind: int,
    remote_domain_id: int,
    source_nonce: int,
) -> NamedProgramAddress:
    _assert_byte(remote_chain_kind, "remote chain kind")
    return derive_named_program_address(
        "outbound_reclaim_record",
        [
            b"outbound-reclaim",
            bytes([remote_chain_kind]),
            _unsigned_64_big_endian(remote_domain_id, "remote domain id"),
            _unsigned_64_big_endian(source_nonce, "source nonce"),
        ],
    )


def derive_pending_config_change_address(change_id: str | bytes) -> NamedProgramAddress:
    return derive_named_program_address(
        "pending_config_change",
        [b"pending-config-change", bytes32_from_input(change_id, "change id")],
    )


def derive_remote_domain_policy_address(
    remote_chain_kind: int,
    remote_domain_id: int,
) -> NamedProgramAddress:
    _assert_byte(remote_chain_kind, "remote chain kind")
    return derive_named_program_address(
        "remote_domain_policy",
        [
            b"remote-domain-policy",
            bytes([remote_chain_kind]),
            _unsigned_64_big_endian(remote_domain_id, "remote domain id"),
        ],
    )


def derive_remote_nonce_address(
    remote_chain_kind: int,
    remote_domain_id: int,
    scope_key: str | bytes,
) -> NamedProgramAddress:
    _assert_byte(remote_chain_kind, "remote chain kind")
    return derive_named_program_address(
        "remote_nonce",
        [
            b"remote-nonce",
            bytes([remote_chain_kind]),
            _unsigned_64_big_endian(remote_domain_id, "remote domain id"),
            bytes32_from_input(scope_key, "remote nonce scope key"),
        ],
    )


def derive_reserve_destination_address(
    asset_mint: str | bytes,
    destination_token_account: str | bytes,
) -> NamedProgramAddress:
    return derive_named_program_address(
        "reserve_destination",
        [
            b"reserve-destination",
            decode_public_key(asset_mint),
            decode_public_key(destination_token_account),
        ],
    )


def derive_singleton_address(name: str, seed_text: str) -> NamedProgramAddress:
    return derive_named_program_address(name, [seed_text.encode("utf-8")])


def dimension_scope_hash(scope_kind: int, party_key: str | bytes) -> bytes:
    _assert_byte(scope_kind, "dimension scope kind")
    return sha256(bytes([scope_kind]) + decode_public_key(party_key)).digest()


def policy_scope_hash(values: dict[str, object]) -> bytes:
    return dimension_scope_hash(require_int_field(values, "scope_kind"), require_public_key_field(values, "scope_key"))


def pathway_is_active(values: dict[str, object]) -> bool:
    status_flags = require_int_field(values, "status_flags")
    return status_flags & STATUS_INITIALIZED != 0 and status_flags & STATUS_PATHWAY_PAUSE == 0


def permission_observation(
    values: dict[str, object],
    required_role: int,
    expected_subject: str | bytes,
    expected_scope_kind: int,
    expected_scope_key: str | bytes,
    now_unix_timestamp: int,
) -> PermissionObservation:
    held_roles = words_to_unsigned128(require_int_array_field(values, "role_bits", 2))
    expiry = require_int_field(values, "expiry_unix_timestamp")
    flags = require_int_field(values, "permission_flags")
    subject_matches = require_public_key_field(values, "subject") == normalize_public_key(expected_subject)
    scope_matches = (
        require_int_field(values, "scope_kind") == expected_scope_kind
        and require_public_key_field(values, "scope_key") == normalize_public_key(expected_scope_key)
    )
    role_schema_matches = require_int_field(values, "role_schema_version") == 1
    paused = flags & PERMISSION_PAUSED != 0
    expired = expiry != 0 and now_unix_timestamp >= expiry
    has_required_role = held_roles & required_role == required_role
    return PermissionObservation(
        required_role=required_role,
        held_roles=held_roles,
        has_required_role=has_required_role,
        subject_matches=subject_matches,
        scope_matches=scope_matches,
        role_schema_matches=role_schema_matches,
        paused=paused,
        expired=expired,
        usable=has_required_role and subject_matches and scope_matches and role_schema_matches and not paused and not expired,
    )


def observe_settlement_policy(
    values: dict[str, object],
    mode: SettlementMode,
    asset_mint: str | bytes,
    principal_a: str | bytes,
    principal_b: str | bytes,
    executor: str | bytes,
    input_notional: int,
    now_unix_timestamp: int,
    expected_address: str | bytes,
    expected_bump: int,
) -> SettlementPolicyObservation:
    policy_id = require_bytes(values.get("policy_id"), "settlement policy id", 32)
    derived_address = derive_settlement_policy_address(policy_id)
    identity_matches = derived_address.address == normalize_public_key(expected_address)
    bump_matches = require_int_field(values, "bump") == expected_bump
    policy_id_nonzero = not is_zero_bytes32(policy_id, "settlement policy id")
    policy_flags_valid = require_int_field(values, "policy_flags") == 0
    allowed_settlement_modes = require_int_field(values, "allowed_settlement_modes")
    known_mode_mask = (1 << SETTLEMENT_MODE_VALUE["delegated"]) | (1 << SETTLEMENT_MODE_VALUE["trilateral"])
    mode_mask_valid = allowed_settlement_modes != 0 and allowed_settlement_modes & ~known_mode_mask == 0
    mode_allowed = mode != "direct" and allowed_settlement_modes & (1 << SETTLEMENT_MODE_VALUE[mode]) != 0
    normalized_asset_mint = normalize_public_key(asset_mint)
    normalized_principal_a = normalize_public_key(principal_a)
    normalized_principal_b = normalize_public_key(principal_b)
    normalized_executor = normalize_public_key(executor)
    allowed_asset_mint = require_public_key_field(values, "allowed_asset_mint")
    allowed_principal_a = require_public_key_field(values, "allowed_principal_a")
    allowed_principal_b = require_public_key_field(values, "allowed_principal_b")
    designated_executor = require_public_key_field(values, "designated_executor")
    asset_allowed = allowed_asset_mint == ZERO_ADDRESS or allowed_asset_mint == normalized_asset_mint
    principal_a_allowed = allowed_principal_a == ZERO_ADDRESS or allowed_principal_a == normalized_principal_a
    principal_b_allowed = allowed_principal_b == ZERO_ADDRESS or allowed_principal_b == normalized_principal_b
    executor_allowed = designated_executor == ZERO_ADDRESS or designated_executor == normalized_executor
    minimum_notional = require_int_field(values, "min_notional")
    maximum_notional = require_int_field(values, "max_notional")
    notional_range_valid = maximum_notional == 0 or minimum_notional <= maximum_notional
    notional_allowed = input_notional >= minimum_notional and (
        maximum_notional == 0 or input_notional <= maximum_notional
    )
    valid_after_unix_timestamp = require_int_field(values, "valid_after_unix_timestamp")
    expires_at_unix_timestamp = require_int_field(values, "expires_at_unix_timestamp")
    timestamp_range_valid = expires_at_unix_timestamp == 0 or valid_after_unix_timestamp < expires_at_unix_timestamp
    temporally_effective = (
        valid_after_unix_timestamp == 0 or now_unix_timestamp >= valid_after_unix_timestamp
    ) and (
        expires_at_unix_timestamp == 0 or now_unix_timestamp < expires_at_unix_timestamp
    )
    observations: list[str] = []
    if not identity_matches:
        observations.append("Settlement policy identity does not resolve to the supplied policy PDA")
    if not bump_matches:
        observations.append("Settlement policy stored bump does not match the canonical PDA bump")
    if not policy_id_nonzero:
        observations.append("Settlement policy id is zero")
    if not policy_flags_valid:
        observations.append("Settlement policy contains unsupported policy flags")
    if not mode_mask_valid:
        observations.append("Settlement policy mode mask is empty or contains unsupported settlement modes")
    if not mode_allowed:
        observations.append(f"Settlement policy does not permit {mode} settlement")
    if not asset_allowed:
        observations.append("Settlement policy does not permit the requested asset mint")
    if not principal_a_allowed:
        observations.append("Settlement policy does not permit principal A")
    if not principal_b_allowed:
        observations.append("Settlement policy does not permit principal B")
    if not executor_allowed:
        observations.append("Settlement policy does not permit the selected executor")
    if not notional_range_valid:
        observations.append("Settlement policy minimum notional exceeds its maximum notional")
    if not notional_allowed:
        observations.append("Settlement input notional is outside the settlement policy range")
    if not timestamp_range_valid:
        observations.append("Settlement policy activation timestamp is not earlier than its expiry timestamp")
    if not temporally_effective:
        observations.append("Settlement policy is not effective at the supplied timestamp")
    usable = all(
        (
            identity_matches,
            bump_matches,
            policy_id_nonzero,
            policy_flags_valid,
            mode_mask_valid,
            mode_allowed,
            asset_allowed,
            principal_a_allowed,
            principal_b_allowed,
            executor_allowed,
            notional_range_valid,
            notional_allowed,
            timestamp_range_valid,
            temporally_effective,
        )
    )
    return SettlementPolicyObservation(
        identity_matches=identity_matches,
        bump_matches=bump_matches,
        policy_id_nonzero=policy_id_nonzero,
        policy_flags_valid=policy_flags_valid,
        allowed_settlement_modes=allowed_settlement_modes,
        mode_mask_valid=mode_mask_valid,
        mode_allowed=mode_allowed,
        asset_allowed=asset_allowed,
        principal_a_allowed=principal_a_allowed,
        principal_b_allowed=principal_b_allowed,
        executor_allowed=executor_allowed,
        minimum_notional=minimum_notional,
        maximum_notional=maximum_notional,
        notional_allowed=notional_allowed,
        valid_after_unix_timestamp=valid_after_unix_timestamp,
        expires_at_unix_timestamp=expires_at_unix_timestamp,
        timestamp_range_valid=timestamp_range_valid,
        temporally_effective=temporally_effective,
        usable=usable,
        observations=tuple(observations),
    )


def compute_settlement_gross_output(action: SettlementAction, input_amount: int, asset_config_values: dict[str, object]) -> int:
    if input_amount < 0:
        raise ValueError("Settlement input amount must be non-negative")
    rate_field = "deposit_rate_e9" if action == "mint" else "redeem_rate_e9"
    return input_amount * require_int_field(asset_config_values, rate_field) // RATE_PRECISION_E9


def compute_fee_quote(
    action: SettlementAction,
    gross_input: int,
    gross_output: int,
    fee_policy_values: dict[str, object] | None,
    now_unix_timestamp: int,
) -> FeeQuote:
    if fee_policy_values is None:
        return FeeQuote(
            gross_input=gross_input,
            gross_output=gross_output,
            denomination="issued_token" if action == "mint" else "asset",
            assessed_fee=0,
            nominal_rebate=0,
            effective_rebate=0,
            net_fee=0,
            net_output=gross_output,
            routed=False,
            fee_recipient_owner=ZERO_ADDRESS,
            effective=True,
            observations=(),
        )
    observations: list[str] = []
    flags = require_int_field(fee_policy_values, "fee_policy_flags")
    in_asset = flags & FEE_IN_ASSET != 0
    in_issued = flags & FEE_IN_ISSUED_TOKEN != 0
    denomination = "invalid" if in_asset == in_issued else "asset" if in_asset else "issued_token"
    expected = "issued_token" if action == "mint" else "asset"
    if denomination != expected:
        observations.append(f"Fee denomination {denomination} does not match {action} output denomination {expected}")
    if flags & FEE_PERCENT_ON_INPUT:
        observations.append("Percent-on-input is not supported by the settlement runtime")
    effective_from = require_int_field(fee_policy_values, "effective_from_unix_timestamp")
    effective_until = require_int_field(fee_policy_values, "effective_until_unix_timestamp")
    effective = (
        flags & FEE_ACTIVE != 0
        and (effective_from == 0 or now_unix_timestamp >= effective_from)
        and (effective_until == 0 or now_unix_timestamp < effective_until)
    )
    if not effective:
        observations.append("Fee policy is not effective at the supplied timestamp")
    flat_fee_field = "flat_fee_in_issued_token" if action == "mint" else "flat_fee_in_asset"
    flat_fee = require_int_field(fee_policy_values, flat_fee_field)
    percent_bps = require_int_field(fee_policy_values, "percent_fee_bps")
    raw_fee = flat_fee if flat_fee else _rounded_basis_points(
        gross_output,
        percent_bps,
        require_int_field(fee_policy_values, "rounding_mode"),
    ) if percent_bps else 0
    fee_cap = require_int_field(fee_policy_values, "fee_cap_amount")
    minimum_fee = require_int_field(fee_policy_values, "minimum_fee_amount")
    capped_fee = min(raw_fee, fee_cap) if fee_cap else raw_fee
    assessed_fee = max(capped_fee, minimum_fee)
    flat_rebate = require_int_field(fee_policy_values, "rebate_flat_amount")
    rebate_bps = require_int_field(fee_policy_values, "rebate_bps")
    raw_rebate = flat_rebate if flat_rebate else assessed_fee * rebate_bps // 10_000 if rebate_bps else 0
    rebate_cap = require_int_field(fee_policy_values, "rebate_cap_amount")
    nominal_rebate = min(raw_rebate, rebate_cap) if rebate_cap else raw_rebate
    floor_zero = require_int_field(fee_policy_values, "net_fee_floor_zero") != 0
    if not floor_zero and nominal_rebate > assessed_fee:
        observations.append("Configured rebate exceeds assessed fee while zero-flooring is disabled")
    effective_rebate = min(nominal_rebate, assessed_fee) if floor_zero else nominal_rebate
    net_fee = max(0, assessed_fee - effective_rebate)
    net_output = max(0, gross_output - net_fee)
    if net_output == 0:
        observations.append("Net settlement output is zero")
    recipient_policy = require_int_field(fee_policy_values, "fee_recipient_policy")
    routed = net_fee > 0 and recipient_policy not in (
        FEE_RECIPIENT_NONE,
        FEE_RECIPIENT_RESERVE_RETENTION,
    )
    return FeeQuote(
        gross_input=gross_input,
        gross_output=gross_output,
        denomination=denomination,
        assessed_fee=assessed_fee,
        nominal_rebate=nominal_rebate,
        effective_rebate=effective_rebate,
        net_fee=net_fee,
        net_output=net_output,
        routed=routed,
        fee_recipient_owner=require_public_key_field(fee_policy_values, "fee_recipient_key"),
        effective=effective,
        observations=tuple(observations),
    )


def observe_limit_policy(
    policy_values: dict[str, object],
    action: SettlementAction,
    proposed_amount: int,
    windows: dict[str, dict[str, object] | None],
    now_unix_timestamp: int,
) -> LimitObservation:
    if action not in ("mint", "redeem"):
        raise ValueError(f"Unsupported settlement action: {action}")
    if proposed_amount < 0:
        raise ValueError("Proposed limit amount must be non-negative")
    accumulator_field = "gross_in" if action == "mint" else "gross_output_amount"
    per_transaction_maximum = require_int_field(policy_values, "per_transaction_maximum")
    per_transaction_remaining_before = None if per_transaction_maximum == 0 else per_transaction_maximum
    per_transaction_remaining_after = (
        None
        if per_transaction_maximum == 0
        else max(per_transaction_maximum - proposed_amount, 0)
    )
    definitions = (
        ("hourly", WINDOW_HOURLY, "per_hour_maximum", "maximum_actions_per_hour"),
        ("daily", WINDOW_DAILY, "per_day_maximum", "maximum_actions_per_day"),
        ("weekly", WINDOW_WEEKLY, "per_seven_day_maximum", ""),
        ("monthly", WINDOW_MONTHLY, "per_thirty_day_maximum", ""),
    )
    observations: list[LimitWindowObservation] = []
    for name, window_kind, maximum_field, action_field in definitions:
        maximum = require_int_field(policy_values, maximum_field)
        maximum_actions = 0 if not action_field else require_int_field(policy_values, action_field)
        window_values = windows.get(name)
        canonical_start = canonical_window_start(window_kind, now_unix_timestamp)
        stored_start = (
            None
            if window_values is None
            else require_int_field(window_values, "window_start_unix_timestamp")
        )
        clock_regression = stored_start is not None and stored_start > canonical_start
        use_stored_counters = stored_start is not None and stored_start == canonical_start
        current_amount = (
            words_to_unsigned128(require_int_array_field(window_values, accumulator_field, 2))
            if use_stored_counters and window_values is not None
            else 0
        )
        current_action_count = (
            require_int_field(window_values, "action_count")
            if use_stored_counters and window_values is not None
            else 0
        )
        projected_amount = current_amount + proposed_amount
        projected_action_count = current_action_count + 1
        remaining_before = None if maximum == 0 else max(maximum - current_amount, 0)
        remaining_after = None if maximum == 0 else max(maximum - projected_amount, 0)
        action_remaining_before = (
            None if maximum_actions == 0 else max(maximum_actions - current_action_count, 0)
        )
        action_remaining_after = (
            None if maximum_actions == 0 else max(maximum_actions - projected_action_count, 0)
        )
        observations.append(
            LimitWindowObservation(
                name=name,
                window_kind=window_kind,
                maximum=maximum,
                accumulator_field=accumulator_field,
                stored_window_start_unix_timestamp=stored_start,
                canonical_window_start_unix_timestamp=canonical_start,
                rolled_before_check=stored_start is not None and stored_start < canonical_start,
                clock_regression=clock_regression,
                current_amount=current_amount,
                proposed_amount=proposed_amount,
                projected_amount=projected_amount,
                remaining_before=remaining_before,
                remaining_after=remaining_after,
                allowed=(not clock_regression and (maximum == 0 or projected_amount <= maximum)),
                current_action_count=current_action_count,
                projected_action_count=projected_action_count,
                maximum_action_count=maximum_actions,
                action_remaining_before=action_remaining_before,
                action_remaining_after=action_remaining_after,
                action_allowed=(
                    not clock_regression
                    and (maximum_actions == 0 or projected_action_count <= maximum_actions)
                ),
            )
        )
    return LimitObservation(
        action=action,
        accumulator_field=accumulator_field,
        per_transaction_maximum=per_transaction_maximum,
        proposed_amount=proposed_amount,
        per_transaction_remaining_before=per_transaction_remaining_before,
        per_transaction_remaining_after=per_transaction_remaining_after,
        per_transaction_allowed=(
            per_transaction_maximum == 0 or proposed_amount <= per_transaction_maximum
        ),
        windows=tuple(observations),
    )


def canonical_window_start(window_kind: int, unix_timestamp: int) -> int:
    if window_kind == WINDOW_HOURLY:
        period_seconds = 3_600
    elif window_kind == WINDOW_DAILY:
        period_seconds = 86_400
    elif window_kind == WINDOW_WEEKLY:
        period_seconds = 604_800
    elif window_kind == WINDOW_MONTHLY:
        period_seconds = 2_592_000
    else:
        raise ValueError(f"Unknown usage-window kind: {window_kind}")
    return unix_timestamp // period_seconds * period_seconds

def require_bytes(value: object, label: str, expected_length: int | None = None) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise ValueError(f"{label} must be bytes")
    data = bytes(value)
    if expected_length is not None and len(data) != expected_length:
        raise ValueError(f"{label} must contain {expected_length} bytes")
    return data


def require_int_field(values: dict[str, object], field_name: str) -> int:
    value = values.get(field_name)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer")
    return value


def require_public_key_field(values: dict[str, object], field_name: str) -> str:
    value = values.get(field_name)
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a public key string")
    return normalize_public_key(value)


def require_int_array_field(values: dict[str, object], field_name: str, expected_length: int) -> tuple[int, ...]:
    value = values.get(field_name)
    if not isinstance(value, list) or len(value) != expected_length:
        raise ValueError(f"{field_name} must contain {expected_length} integers")
    result: list[int] = []
    for index, item in enumerate(value):
        if isinstance(item, bool) or not isinstance(item, int):
            raise ValueError(f"{field_name}[{index}] must be an integer")
        result.append(item)
    return tuple(result)


def words_to_unsigned128(words: tuple[int, ...]) -> int:
    if len(words) != 2:
        raise ValueError("Unsigned 128-bit word array must contain two words")
    return words[0] | words[1] << 64


def known_pda_address(name: str) -> str:
    known_pdas = CHANCERY_SCHEMA.get("known_pdas")
    if not isinstance(known_pdas, dict):
        raise ValueError("Chancery schema known_pdas must be an object")
    value = known_pdas.get(name)
    if not isinstance(value, dict):
        raise ValueError(f"Unknown Chancery singleton PDA: {name}")
    address = value.get("address")
    if not isinstance(address, str):
        raise ValueError(f"Chancery singleton PDA {name} has no address")
    return normalize_public_key(address)


def public_key_from_bytes32(value: object, label: str) -> str:
    return encode_base58(require_bytes(value, label, 32))


def _decode_hex(hexadecimal: str, label: str) -> bytes:
    try:
        return bytes.fromhex(hexadecimal)
    except ValueError as error:
        raise ValueError(f"{label} hexadecimal encoding is invalid") from error


def _assert_byte(value: int, label: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 255:
        raise ValueError(f"{label} must be an unsigned byte")


def _unsigned_64_big_endian(value: int, label: str) -> bytes:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 0xFFFF_FFFF_FFFF_FFFF:
        raise ValueError(f"{label} must be an unsigned 64-bit integer")
    return value.to_bytes(8, "big")


def _rounded_basis_points(amount: int, basis_points: int, rounding_mode: int) -> int:
    product = amount * basis_points
    quotient, remainder = divmod(product, 10_000)
    if rounding_mode == ROUNDING_FLOOR:
        return quotient
    if rounding_mode == ROUNDING_CEILING:
        return quotient + (1 if remainder else 0)
    if rounding_mode == ROUNDING_NEAREST:
        return quotient + (1 if remainder >= 5_000 else 0)
    raise ValueError(f"Unsupported fee rounding mode: {rounding_mode}")
