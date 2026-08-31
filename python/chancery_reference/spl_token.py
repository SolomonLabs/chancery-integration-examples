from __future__ import annotations

from dataclasses import dataclass

from .base58_codec import decode_public_key, encode_base58, normalize_public_key
from .program_address import ProgramAddressResult, find_program_address

SPL_TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
ASSOCIATED_TOKEN_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
TOKEN_MINT_BASE_SIZE = 82
TOKEN_ACCOUNT_BASE_SIZE = 165
TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165
TOKEN_2022_TLV_OFFSET = 166
TOKEN_2022_MINT_ACCOUNT_TYPE = 1
TRANSFER_FEE_CONFIG_EXTENSION_TYPE = 1
TRANSFER_HOOK_EXTENSION_TYPE = 14
CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION_TYPE = 16
TRANSFER_FEE_CONFIG_SIZE = 108
BASIS_POINT_DENOMINATOR = 10_000


@dataclass(frozen=True)
class Token2022Extension:
    extension_type: int
    byte_length: int
    value: bytes


@dataclass(frozen=True)
class Token2022TransferFee:
    epoch: int
    maximum_fee: int
    transfer_fee_basis_points: int


@dataclass(frozen=True)
class Token2022TransferFeeConfig:
    transfer_fee_config_authority: str | None
    withdraw_withheld_authority: str | None
    withheld_amount: int
    older_transfer_fee: Token2022TransferFee
    newer_transfer_fee: Token2022TransferFee


@dataclass(frozen=True)
class TokenTransferFeeCalculation:
    epoch: int
    amount: int
    transfer_fee_basis_points: int
    maximum_fee: int
    fee_amount: int
    received_amount: int


@dataclass(frozen=True)
class DecodedTokenMint:
    mint_authority: str | None
    supply: int
    decimals: int
    initialized: bool
    freeze_authority: str | None
    base_size: int
    total_size: int
    has_extensions: bool
    account_type: int | None
    extensions: tuple[Token2022Extension, ...]
    transfer_fee_config: Token2022TransferFeeConfig | None
    transfer_hook_program_address: str | None
    has_unmodeled_transfer_behavior: bool


@dataclass(frozen=True)
class DecodedTokenAccount:
    mint: str
    owner: str
    amount: int
    delegate: str | None
    state: int
    native_reserve: int | None
    delegated_amount: int
    close_authority: str | None
    base_size: int
    total_size: int
    has_extensions: bool


@dataclass(frozen=True)
class AssociatedTokenAddress:
    address: str
    bump: int
    owner: str
    mint: str
    token_program_address: str


@dataclass(frozen=True)
class _Token2022MintExtensionResult:
    account_type: int | None
    extensions: tuple[Token2022Extension, ...]
    transfer_fee_config: Token2022TransferFeeConfig | None
    transfer_hook_program_address: str | None
    has_unmodeled_transfer_behavior: bool


def is_supported_token_program(program_address: str | bytes | bytearray | memoryview) -> bool:
    normalized = normalize_public_key(program_address)
    return normalized in (SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS)


def assert_supported_token_program(program_address: str | bytes | bytearray | memoryview) -> str:
    normalized = normalize_public_key(program_address)
    if not is_supported_token_program(normalized):
        raise ValueError(f"Unsupported token program: {normalized}")
    return normalized


def derive_associated_token_address(
    owner: str | bytes | bytearray | memoryview,
    mint: str | bytes | bytearray | memoryview,
    token_program_address: str | bytes | bytearray | memoryview,
) -> AssociatedTokenAddress:
    normalized_owner = normalize_public_key(owner)
    normalized_mint = normalize_public_key(mint)
    normalized_token_program = assert_supported_token_program(token_program_address)
    result: ProgramAddressResult = find_program_address(
        [
            decode_public_key(normalized_owner),
            decode_public_key(normalized_token_program),
            decode_public_key(normalized_mint),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    )
    return AssociatedTokenAddress(
        address=result.address,
        bump=result.bump,
        owner=normalized_owner,
        mint=normalized_mint,
        token_program_address=normalized_token_program,
    )


def decode_token_mint(data: bytes | bytearray | memoryview) -> DecodedTokenMint:
    raw = bytes(data)
    if len(raw) < TOKEN_MINT_BASE_SIZE:
        raise ValueError(f"Token mint requires at least {TOKEN_MINT_BASE_SIZE} bytes; received {len(raw)}")
    initialized_byte = raw[45]
    if initialized_byte not in (0, 1):
        raise ValueError(f"Token mint initialized flag is invalid: {initialized_byte}")
    extension_result = _decode_token_2022_mint_extensions(raw)
    return DecodedTokenMint(
        mint_authority=_decode_coption_public_key(raw, 0, "mint authority"),
        supply=_read_unsigned(raw, 36, 8, "mint supply"),
        decimals=raw[44],
        initialized=initialized_byte == 1,
        freeze_authority=_decode_coption_public_key(raw, 46, "freeze authority"),
        base_size=TOKEN_MINT_BASE_SIZE,
        total_size=len(raw),
        has_extensions=bool(extension_result.extensions),
        account_type=extension_result.account_type,
        extensions=extension_result.extensions,
        transfer_fee_config=extension_result.transfer_fee_config,
        transfer_hook_program_address=extension_result.transfer_hook_program_address,
        has_unmodeled_transfer_behavior=extension_result.has_unmodeled_transfer_behavior,
    )


def select_active_transfer_fee(
    config: Token2022TransferFeeConfig,
    current_epoch: int,
) -> Token2022TransferFee:
    if current_epoch < 0:
        raise ValueError("Current epoch must be non-negative")
    if current_epoch < config.newer_transfer_fee.epoch:
        return config.older_transfer_fee
    return config.newer_transfer_fee


def calculate_token_transfer_fee(
    amount: int,
    config: Token2022TransferFeeConfig | None,
    current_epoch: int,
) -> TokenTransferFeeCalculation:
    if amount < 0:
        raise ValueError("Transfer amount must be non-negative")
    if current_epoch < 0:
        raise ValueError("Current epoch must be non-negative")
    if config is None:
        return TokenTransferFeeCalculation(
            epoch=current_epoch,
            amount=amount,
            transfer_fee_basis_points=0,
            maximum_fee=0,
            fee_amount=0,
            received_amount=amount,
        )
    active_fee = select_active_transfer_fee(config, current_epoch)
    if amount == 0 or active_fee.transfer_fee_basis_points == 0:
        uncapped_fee = 0
    else:
        numerator = amount * active_fee.transfer_fee_basis_points
        uncapped_fee = (numerator + BASIS_POINT_DENOMINATOR - 1) // BASIS_POINT_DENOMINATOR
    fee_amount = min(uncapped_fee, active_fee.maximum_fee)
    if fee_amount > amount:
        raise ValueError("Calculated transfer fee exceeds transfer amount")
    return TokenTransferFeeCalculation(
        epoch=current_epoch,
        amount=amount,
        transfer_fee_basis_points=active_fee.transfer_fee_basis_points,
        maximum_fee=active_fee.maximum_fee,
        fee_amount=fee_amount,
        received_amount=amount - fee_amount,
    )


def decode_token_account(data: bytes | bytearray | memoryview) -> DecodedTokenAccount:
    raw = bytes(data)
    if len(raw) < TOKEN_ACCOUNT_BASE_SIZE:
        raise ValueError(f"Token account requires at least {TOKEN_ACCOUNT_BASE_SIZE} bytes; received {len(raw)}")
    state = raw[108]
    if state > 2:
        raise ValueError(f"Token account state is invalid: {state}")
    return DecodedTokenAccount(
        mint=encode_base58(raw[0:32]),
        owner=encode_base58(raw[32:64]),
        amount=_read_unsigned(raw, 64, 8, "token account amount"),
        delegate=_decode_coption_public_key(raw, 72, "delegate"),
        state=state,
        native_reserve=_decode_coption_unsigned(raw, 109, "native reserve"),
        delegated_amount=_read_unsigned(raw, 121, 8, "delegated amount"),
        close_authority=_decode_coption_public_key(raw, 129, "close authority"),
        base_size=TOKEN_ACCOUNT_BASE_SIZE,
        total_size=len(raw),
        has_extensions=len(raw) > TOKEN_ACCOUNT_BASE_SIZE,
    )


def assert_token_account_binding(
    token_account: DecodedTokenAccount,
    expected_mint: str | bytes | bytearray | memoryview,
    expected_owner: str | bytes | bytearray | memoryview,
    label: str,
) -> None:
    normalized_mint = normalize_public_key(expected_mint)
    normalized_owner = normalize_public_key(expected_owner)
    if token_account.mint != normalized_mint:
        raise ValueError(f"{label} mint {token_account.mint} does not match {normalized_mint}")
    if token_account.owner != normalized_owner:
        raise ValueError(f"{label} owner {token_account.owner} does not match {normalized_owner}")
    if token_account.state != 1:
        raise ValueError(f"{label} is not initialized")


def _decode_token_2022_mint_extensions(data: bytes) -> _Token2022MintExtensionResult:
    if len(data) == TOKEN_MINT_BASE_SIZE:
        return _Token2022MintExtensionResult(
            account_type=None,
            extensions=(),
            transfer_fee_config=None,
            transfer_hook_program_address=None,
            has_unmodeled_transfer_behavior=False,
        )
    if len(data) <= TOKEN_2022_ACCOUNT_TYPE_OFFSET:
        raise ValueError("Token-2022 mint extension region is truncated")
    account_type = data[TOKEN_2022_ACCOUNT_TYPE_OFFSET]
    if account_type != TOKEN_2022_MINT_ACCOUNT_TYPE:
        raise ValueError(f"Token-2022 mint account type is invalid: {account_type}")
    extensions: list[Token2022Extension] = []
    transfer_fee_config: Token2022TransferFeeConfig | None = None
    transfer_hook_program_address: str | None = None
    has_unmodeled_transfer_behavior = False
    cursor = TOKEN_2022_TLV_OFFSET
    while cursor + 4 <= len(data):
        extension_type = _read_unsigned(data, cursor, 2, "extension type")
        byte_length = _read_unsigned(data, cursor + 2, 2, "extension length")
        if extension_type == 0:
            break
        value_offset = cursor + 4
        value = _slice_exact(data, value_offset, byte_length, f"extension {extension_type}")
        extensions.append(
            Token2022Extension(
                extension_type=extension_type,
                byte_length=byte_length,
                value=value,
            )
        )
        if extension_type == TRANSFER_FEE_CONFIG_EXTENSION_TYPE:
            if transfer_fee_config is not None:
                raise ValueError("Token-2022 mint has duplicate TransferFeeConfig extensions")
            transfer_fee_config = _decode_transfer_fee_config(value)
        elif extension_type == TRANSFER_HOOK_EXTENSION_TYPE:
            if len(value) != 64:
                raise ValueError(f"TransferHook extension requires 64 bytes; received {len(value)}")
            transfer_hook_program_address = _decode_optional_nonzero_public_key(
                value,
                32,
                "transfer hook program",
            )
            if transfer_hook_program_address is not None:
                has_unmodeled_transfer_behavior = True
        elif extension_type == CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION_TYPE:
            has_unmodeled_transfer_behavior = True
        cursor = value_offset + byte_length
    if cursor < len(data) and len(data) - cursor < 4 and any(data[cursor:]):
        raise ValueError("Token-2022 mint TLV has nonzero trailing bytes")
    return _Token2022MintExtensionResult(
        account_type=account_type,
        extensions=tuple(extensions),
        transfer_fee_config=transfer_fee_config,
        transfer_hook_program_address=transfer_hook_program_address,
        has_unmodeled_transfer_behavior=has_unmodeled_transfer_behavior,
    )


def _decode_transfer_fee_config(value: bytes) -> Token2022TransferFeeConfig:
    if len(value) != TRANSFER_FEE_CONFIG_SIZE:
        raise ValueError(f"TransferFeeConfig requires {TRANSFER_FEE_CONFIG_SIZE} bytes; received {len(value)}")
    return Token2022TransferFeeConfig(
        transfer_fee_config_authority=_decode_optional_nonzero_public_key(
            value,
            0,
            "transfer fee config authority",
        ),
        withdraw_withheld_authority=_decode_optional_nonzero_public_key(
            value,
            32,
            "withdraw withheld authority",
        ),
        withheld_amount=_read_unsigned(value, 64, 8, "withheld amount"),
        older_transfer_fee=_decode_transfer_fee(value, 72, "older transfer fee"),
        newer_transfer_fee=_decode_transfer_fee(value, 90, "newer transfer fee"),
    )


def _decode_transfer_fee(value: bytes, offset: int, label: str) -> Token2022TransferFee:
    transfer_fee_basis_points = _read_unsigned(value, offset + 16, 2, f"{label} basis points")
    if transfer_fee_basis_points > 10_000:
        raise ValueError(f"{label} basis points exceed 10000: {transfer_fee_basis_points}")
    return Token2022TransferFee(
        epoch=_read_unsigned(value, offset, 8, f"{label} epoch"),
        maximum_fee=_read_unsigned(value, offset + 8, 8, f"{label} maximum fee"),
        transfer_fee_basis_points=transfer_fee_basis_points,
    )


def _decode_optional_nonzero_public_key(data: bytes, offset: int, label: str) -> str | None:
    value = _slice_exact(data, offset, 32, label)
    return None if not any(value) else encode_base58(value)


def _decode_coption_public_key(data: bytes, offset: int, label: str) -> str | None:
    tag = _read_unsigned(data, offset, 4, f"{label} option tag")
    if tag == 0:
        return None
    if tag != 1:
        raise ValueError(f"{label} option tag is invalid: {tag}")
    return encode_base58(_slice_exact(data, offset + 4, 32, label))


def _decode_coption_unsigned(data: bytes, offset: int, label: str) -> int | None:
    tag = _read_unsigned(data, offset, 4, f"{label} option tag")
    if tag == 0:
        return None
    if tag != 1:
        raise ValueError(f"{label} option tag is invalid: {tag}")
    return _read_unsigned(data, offset + 4, 8, label)


def _read_unsigned(data: bytes, offset: int, byte_length: int, label: str) -> int:
    return int.from_bytes(_slice_exact(data, offset, byte_length, label), "little", signed=False)


def _slice_exact(data: bytes, offset: int, byte_length: int, label: str) -> bytes:
    if offset < 0 or offset + byte_length > len(data):
        raise ValueError(f"{label} requires bytes {offset}..{offset + byte_length - 1}")
    return data[offset:offset + byte_length]
