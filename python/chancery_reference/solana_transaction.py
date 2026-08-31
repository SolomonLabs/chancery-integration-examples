from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .base58_codec import decode_public_key, encode_base58, normalize_public_key

MAX_TRANSACTION_BYTES = 1232
_LOOKUP_TABLE_META_BYTES = 56
_ED25519_FIELD = 2**255 - 19
_ED25519_ORDER = 2**252 + 27742317777372353535851937790883648493
_ED25519_D = (-121665 * pow(121666, _ED25519_FIELD - 2, _ED25519_FIELD)) % _ED25519_FIELD
_ED25519_IDENTITY = (0, 1, 1, 0)


@dataclass(frozen=True)
class SolanaInstructionAccountMeta:
    address: str
    is_signer: bool
    is_writable: bool
    name: str | None = None


@dataclass(frozen=True)
class SolanaInstruction:
    program_address: str
    accounts: tuple[SolanaInstructionAccountMeta, ...]
    data: bytes


@dataclass(frozen=True)
class SolanaKeypair:
    public_key: str
    secret_key_seed: bytes


@dataclass(frozen=True)
class AddressLookupTable:
    address: str
    addresses: tuple[str, ...]


@dataclass(frozen=True)
class CompiledAddressTableLookup:
    table_address: str
    writable_indexes: tuple[int, ...]
    readonly_indexes: tuple[int, ...]


@dataclass(frozen=True)
class CompiledSolanaMessage:
    version: str | int
    bytes: bytes
    account_keys: tuple[str, ...]
    signer_addresses: tuple[str, ...]
    number_of_required_signatures: int
    number_of_readonly_signed_accounts: int
    number_of_readonly_unsigned_accounts: int
    address_table_lookups: tuple[CompiledAddressTableLookup, ...]


@dataclass(frozen=True)
class SignedSolanaTransaction:
    bytes: bytes
    message: CompiledSolanaMessage
    signatures: dict[str, bytes]
    primary_signature: str


@dataclass
class _AggregatedAccountMeta:
    address: str
    first_seen_index: int
    is_signer: bool
    is_writable: bool
    is_program: bool


@dataclass(frozen=True)
class _LookupPlacement:
    table_index: int
    address_index: int
    is_writable: bool


def encode_short_vector_length(value: int) -> bytes:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Short-vector length must be an unsigned integer")
    encoded = bytearray()
    remaining = value
    while True:
        byte_value = remaining & 0x7F
        remaining //= 128
        if remaining > 0:
            byte_value |= 0x80
        encoded.append(byte_value)
        if remaining == 0:
            return bytes(encoded)


def compile_unversioned_message(
    instructions: Iterable[SolanaInstruction],
    fee_payer: str | bytes,
    recent_blockhash: str | bytes,
) -> CompiledSolanaMessage:
    instruction_values = tuple(instructions)
    aggregated = _aggregate_account_metas(instruction_values, fee_payer)
    ordered = _order_static_account_metas(aggregated)
    return _compile_message_bytes(
        "unversioned",
        instruction_values,
        ordered,
        (),
        (),
        {},
        (),
        recent_blockhash,
    )


def compile_version_zero_message(
    instructions: Iterable[SolanaInstruction],
    fee_payer: str | bytes,
    recent_blockhash: str | bytes,
    lookup_tables: Iterable[AddressLookupTable],
) -> CompiledSolanaMessage:
    instruction_values = tuple(instructions)
    lookup_table_values = tuple(lookup_tables)
    if len(lookup_table_values) == 0:
        raise ValueError("Version-zero compilation requires at least one address lookup table")
    aggregated = _aggregate_account_metas(instruction_values, fee_payer)
    (
        static_metas,
        writable_loaded_addresses,
        readonly_loaded_addresses,
        placements,
        lookups,
    ) = _place_accounts_in_lookup_tables(aggregated, lookup_table_values)
    return _compile_message_bytes(
        0,
        instruction_values,
        _order_static_account_metas(static_metas),
        writable_loaded_addresses,
        readonly_loaded_addresses,
        placements,
        lookups,
        recent_blockhash,
    )


def create_unsigned_transaction(message: CompiledSolanaMessage) -> bytes:
    signatures = tuple(bytes(64) for _ in range(message.number_of_required_signatures))
    return _serialize_transaction(message.bytes, signatures)


def sign_solana_transaction(
    message: CompiledSolanaMessage,
    keypairs: Iterable[SolanaKeypair],
) -> SignedSolanaTransaction:
    keypair_by_public_key: dict[str, SolanaKeypair] = {}
    for keypair in keypairs:
        keypair_by_public_key[normalize_public_key(keypair.public_key)] = keypair

    signatures: list[bytes] = []
    signature_record: dict[str, bytes] = {}
    for signer_address in message.signer_addresses:
        keypair = keypair_by_public_key.get(signer_address)
        if keypair is None:
            raise ValueError(f"Missing keypair for required signer {signer_address}")
        signature = sign_message_with_keypair(message.bytes, keypair)
        signatures.append(signature)
        signature_record[signer_address] = signature

    serialized = _serialize_transaction(message.bytes, signatures)
    if len(serialized) > MAX_TRANSACTION_BYTES:
        raise ValueError(
            f"Serialized transaction is {len(serialized)} bytes; Solana packet limit is "
            f"{MAX_TRANSACTION_BYTES}. Compile a version-zero message with an address lookup table."
        )
    if len(signatures) == 0:
        raise ValueError("Transaction has no required signatures")
    return SignedSolanaTransaction(
        bytes=serialized,
        message=message,
        signatures=signature_record,
        primary_signature=encode_base58(signatures[0]),
    )


def load_solana_keypair_file(file_path: str | Path) -> SolanaKeypair:
    parsed: object = json.loads(Path(file_path).read_text(encoding="utf-8"))
    if not isinstance(parsed, list):
        raise ValueError(f"Keypair file {file_path} must contain a JSON byte array")
    key_bytes = bytearray()
    for index, value in enumerate(parsed):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 255:
            raise ValueError(f"Keypair file {file_path} contains an invalid byte at index {index}")
        key_bytes.append(value)
    return keypair_from_secret_key_bytes(key_bytes)


def keypair_from_secret_key_bytes(secret_key_bytes: bytes | bytearray | memoryview) -> SolanaKeypair:
    raw = bytes(secret_key_bytes)
    if len(raw) not in (32, 64):
        raise ValueError("Solana secret key must contain 32 seed bytes or 64 keypair bytes")
    seed = raw[:32]
    public_key_bytes = public_key_bytes_from_seed(seed)
    if len(raw) == 64 and raw[32:] != public_key_bytes:
        raise ValueError("Solana keypair public-key suffix does not match its secret seed")
    return SolanaKeypair(public_key=encode_base58(public_key_bytes), secret_key_seed=seed)


def public_key_bytes_from_seed(seed: bytes | bytearray | memoryview) -> bytes:
    seed_bytes = bytes(seed)
    if len(seed_bytes) != 32:
        raise ValueError("Ed25519 seed must contain 32 bytes")
    digest = hashlib.sha512(seed_bytes).digest()
    scalar_bytes = bytearray(digest[:32])
    scalar_bytes[0] &= 248
    scalar_bytes[31] &= 63
    scalar_bytes[31] |= 64
    scalar = int.from_bytes(scalar_bytes, "little")
    return _encode_edwards_point(_scalar_multiply(_ed25519_base_point(), scalar))


def sign_message_with_keypair(message: bytes | bytearray | memoryview, keypair: SolanaKeypair) -> bytes:
    seed = bytes(keypair.secret_key_seed)
    if len(seed) != 32:
        raise ValueError("Ed25519 seed must contain 32 bytes")
    actual_public_key = public_key_bytes_from_seed(seed)
    if encode_base58(actual_public_key) != normalize_public_key(keypair.public_key):
        raise ValueError(f"Secret seed does not match public key {keypair.public_key}")

    digest = hashlib.sha512(seed).digest()
    scalar_bytes = bytearray(digest[:32])
    scalar_bytes[0] &= 248
    scalar_bytes[31] &= 63
    scalar_bytes[31] |= 64
    secret_scalar = int.from_bytes(scalar_bytes, "little")
    prefix = digest[32:]
    message_bytes = bytes(message)
    nonce = int.from_bytes(hashlib.sha512(prefix + message_bytes).digest(), "little") % _ED25519_ORDER
    encoded_nonce_point = _encode_edwards_point(_scalar_multiply(_ed25519_base_point(), nonce))
    challenge = int.from_bytes(
        hashlib.sha512(encoded_nonce_point + actual_public_key + message_bytes).digest(),
        "little",
    ) % _ED25519_ORDER
    response = (nonce + challenge * secret_scalar) % _ED25519_ORDER
    return encoded_nonce_point + response.to_bytes(32, "little")


def parse_address_lookup_table_account(
    table_address: str | bytes,
    account_data: bytes | bytearray | memoryview,
) -> AddressLookupTable:
    raw = bytes(account_data)
    if len(raw) < _LOOKUP_TABLE_META_BYTES or (len(raw) - _LOOKUP_TABLE_META_BYTES) % 32 != 0:
        raise ValueError("Address lookup table account has an invalid byte length")
    if int.from_bytes(raw[:4], "little") != 1:
        raise ValueError("Address lookup table account is not initialized")
    addresses = tuple(
        encode_base58(raw[offset : offset + 32])
        for offset in range(_LOOKUP_TABLE_META_BYTES, len(raw), 32)
    )
    return AddressLookupTable(address=normalize_public_key(table_address), addresses=addresses)


def _aggregate_account_metas(
    instructions: tuple[SolanaInstruction, ...],
    fee_payer_input: str | bytes,
) -> tuple[_AggregatedAccountMeta, ...]:
    fee_payer = normalize_public_key(fee_payer_input)
    metas: dict[str, _AggregatedAccountMeta] = {
        fee_payer: _AggregatedAccountMeta(fee_payer, 0, True, True, False)
    }
    first_seen_index = 1
    for instruction in instructions:
        for account in instruction.accounts:
            _merge_account_meta(
                metas,
                normalize_public_key(account.address),
                account.is_signer,
                account.is_writable,
                False,
                first_seen_index,
            )
            first_seen_index += 1
        _merge_account_meta(
            metas,
            normalize_public_key(instruction.program_address),
            False,
            False,
            True,
            first_seen_index,
        )
        first_seen_index += 1
    return tuple(metas.values())


def _merge_account_meta(
    metas: dict[str, _AggregatedAccountMeta],
    address: str,
    is_signer: bool,
    is_writable: bool,
    is_program: bool,
    first_seen_index: int,
) -> None:
    existing = metas.get(address)
    if existing is None:
        metas[address] = _AggregatedAccountMeta(
            address=address,
            first_seen_index=first_seen_index,
            is_signer=is_signer,
            is_writable=is_writable,
            is_program=is_program,
        )
        return
    existing.is_signer = existing.is_signer or is_signer
    existing.is_writable = existing.is_writable or is_writable
    existing.is_program = existing.is_program or is_program


def _order_static_account_metas(
    metas: Iterable[_AggregatedAccountMeta],
) -> tuple[_AggregatedAccountMeta, ...]:
    return tuple(sorted(metas, key=lambda value: (_account_order_group(value), value.first_seen_index)))


def _account_order_group(meta: _AggregatedAccountMeta) -> int:
    if meta.is_signer and meta.is_writable:
        return 0
    if meta.is_signer:
        return 1
    if meta.is_writable:
        return 2
    return 3


def _place_accounts_in_lookup_tables(
    metas: tuple[_AggregatedAccountMeta, ...],
    lookup_tables: tuple[AddressLookupTable, ...],
) -> tuple[
    tuple[_AggregatedAccountMeta, ...],
    tuple[str, ...],
    tuple[str, ...],
    dict[str, _LookupPlacement],
    tuple[CompiledAddressTableLookup, ...],
]:
    table_address_indexes: list[dict[str, int]] = []
    for table in lookup_tables:
        if len(table.addresses) > 256:
            raise ValueError(f"Address lookup table {table.address} has more than 256 addresses")
        address_indexes: dict[str, int] = {}
        for address_index, address in enumerate(table.addresses):
            normalized = normalize_public_key(address)
            if normalized not in address_indexes:
                address_indexes[normalized] = address_index
        table_address_indexes.append(address_indexes)

    static_metas: list[_AggregatedAccountMeta] = []
    placements: dict[str, _LookupPlacement] = {}
    writable_indexes_by_table: list[list[int]] = [[] for _ in lookup_tables]
    readonly_indexes_by_table: list[list[int]] = [[] for _ in lookup_tables]

    for meta_index, meta in enumerate(metas):
        if meta.is_signer or meta.is_program or meta_index == 0:
            static_metas.append(meta)
            continue
        placement: _LookupPlacement | None = None
        for table_index, address_indexes in enumerate(table_address_indexes):
            address_index = address_indexes.get(meta.address)
            if address_index is not None:
                placement = _LookupPlacement(table_index, address_index, meta.is_writable)
                break
        if placement is None:
            static_metas.append(meta)
            continue
        placements[meta.address] = placement
        destination = (
            writable_indexes_by_table[placement.table_index]
            if placement.is_writable
            else readonly_indexes_by_table[placement.table_index]
        )
        destination.append(placement.address_index)

    writable_loaded_addresses: list[str] = []
    readonly_loaded_addresses: list[str] = []
    lookups: list[CompiledAddressTableLookup] = []
    for table_index, table in enumerate(lookup_tables):
        writable_indexes = writable_indexes_by_table[table_index]
        readonly_indexes = readonly_indexes_by_table[table_index]
        if len(writable_indexes) == 0 and len(readonly_indexes) == 0:
            continue
        writable_loaded_addresses.extend(normalize_public_key(table.addresses[index]) for index in writable_indexes)
        readonly_loaded_addresses.extend(normalize_public_key(table.addresses[index]) for index in readonly_indexes)
        lookups.append(
            CompiledAddressTableLookup(
                table_address=normalize_public_key(table.address),
                writable_indexes=tuple(writable_indexes),
                readonly_indexes=tuple(readonly_indexes),
            )
        )

    return (
        tuple(static_metas),
        tuple(writable_loaded_addresses),
        tuple(readonly_loaded_addresses),
        placements,
        tuple(lookups),
    )


def _compile_message_bytes(
    version: str | int,
    instructions: tuple[SolanaInstruction, ...],
    static_metas: tuple[_AggregatedAccountMeta, ...],
    writable_loaded_addresses: tuple[str, ...],
    readonly_loaded_addresses: tuple[str, ...],
    placements: dict[str, _LookupPlacement],
    lookups: tuple[CompiledAddressTableLookup, ...],
    recent_blockhash: str | bytes,
) -> CompiledSolanaMessage:
    if len(static_metas) > 256:
        raise ValueError("Compiled message has more than 256 static account keys")
    required_signatures = sum(1 for meta in static_metas if meta.is_signer)
    readonly_signed = sum(1 for meta in static_metas if meta.is_signer and not meta.is_writable)
    readonly_unsigned = sum(1 for meta in static_metas if not meta.is_signer and not meta.is_writable)
    if required_signatures > 255 or readonly_signed > 255 or readonly_unsigned > 255:
        raise ValueError("Compiled message header count exceeds one byte")

    static_account_keys = tuple(meta.address for meta in static_metas)
    account_index_by_address = {address: index for index, address in enumerate(static_account_keys)}
    next_loaded_index = len(static_account_keys)
    for address in writable_loaded_addresses:
        account_index_by_address[address] = next_loaded_index
        next_loaded_index += 1
    for address in readonly_loaded_addresses:
        account_index_by_address[address] = next_loaded_index
        next_loaded_index += 1
    if next_loaded_index > 256:
        raise ValueError("Compiled message has more than 256 total account keys")

    message_parts: list[bytes] = []
    if version == 0:
        message_parts.append(b"\x80")
    message_parts.append(bytes((required_signatures, readonly_signed, readonly_unsigned)))
    message_parts.append(encode_short_vector_length(len(static_account_keys)))
    message_parts.extend(decode_public_key(address) for address in static_account_keys)
    message_parts.append(decode_public_key(recent_blockhash))
    message_parts.append(encode_short_vector_length(len(instructions)))

    for instruction in instructions:
        program_address = normalize_public_key(instruction.program_address)
        program_index = account_index_by_address.get(program_address)
        if program_index is None or program_index > 255:
            raise ValueError(
                f"Instruction program address is absent from the static account list: {program_address}"
            )
        message_parts.append(bytes((program_index,)))
        message_parts.append(encode_short_vector_length(len(instruction.accounts)))
        account_indexes = bytearray()
        for account in instruction.accounts:
            address = normalize_public_key(account.address)
            compiled_index = account_index_by_address.get(address)
            if compiled_index is None or compiled_index > 255:
                placement = placements.get(address)
                placement_text = "" if placement is None else f" via table {placement.table_index}"
                raise ValueError(f"Instruction account is absent from compiled keys: {address}{placement_text}")
            account_indexes.append(compiled_index)
        message_parts.append(bytes(account_indexes))
        message_parts.append(encode_short_vector_length(len(instruction.data)))
        message_parts.append(bytes(instruction.data))

    if version == 0:
        message_parts.append(encode_short_vector_length(len(lookups)))
        for lookup in lookups:
            message_parts.append(decode_public_key(lookup.table_address))
            message_parts.append(encode_short_vector_length(len(lookup.writable_indexes)))
            message_parts.append(bytes(lookup.writable_indexes))
            message_parts.append(encode_short_vector_length(len(lookup.readonly_indexes)))
            message_parts.append(bytes(lookup.readonly_indexes))

    message_bytes = b"".join(message_parts)
    signer_addresses = tuple(meta.address for meta in static_metas[:required_signatures])
    return CompiledSolanaMessage(
        version=version,
        bytes=message_bytes,
        account_keys=static_account_keys + writable_loaded_addresses + readonly_loaded_addresses,
        signer_addresses=signer_addresses,
        number_of_required_signatures=required_signatures,
        number_of_readonly_signed_accounts=readonly_signed,
        number_of_readonly_unsigned_accounts=readonly_unsigned,
        address_table_lookups=lookups,
    )


def _serialize_transaction(message_bytes: bytes, signatures: Iterable[bytes]) -> bytes:
    signature_values = tuple(bytes(signature) for signature in signatures)
    for index, signature in enumerate(signature_values):
        if len(signature) != 64:
            raise ValueError(f"Transaction signature {index} must contain 64 bytes")
    return encode_short_vector_length(len(signature_values)) + b"".join(signature_values) + message_bytes


def _ed25519_base_point() -> tuple[int, int, int, int]:
    y = (4 * pow(5, _ED25519_FIELD - 2, _ED25519_FIELD)) % _ED25519_FIELD
    x = _recover_x(y, 0)
    return x, y, 1, (x * y) % _ED25519_FIELD


def _recover_x(y: int, sign: int) -> int:
    numerator = (y * y - 1) % _ED25519_FIELD
    denominator = (_ED25519_D * y * y + 1) % _ED25519_FIELD
    x_squared = (numerator * pow(denominator, _ED25519_FIELD - 2, _ED25519_FIELD)) % _ED25519_FIELD
    x = pow(x_squared, (_ED25519_FIELD + 3) // 8, _ED25519_FIELD)
    if (x * x - x_squared) % _ED25519_FIELD != 0:
        sqrt_minus_one = pow(2, (_ED25519_FIELD - 1) // 4, _ED25519_FIELD)
        x = (x * sqrt_minus_one) % _ED25519_FIELD
    if (x * x - x_squared) % _ED25519_FIELD != 0:
        raise ValueError("Unable to recover Ed25519 point")
    if (x & 1) != sign:
        x = (-x) % _ED25519_FIELD
    return x


def _add_edwards_points(
    left: tuple[int, int, int, int],
    right: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    x1, y1, z1, t1 = left
    x2, y2, z2, t2 = right
    a = ((y1 - x1) * (y2 - x2)) % _ED25519_FIELD
    b = ((y1 + x1) * (y2 + x2)) % _ED25519_FIELD
    c = (2 * _ED25519_D * t1 * t2) % _ED25519_FIELD
    d = (2 * z1 * z2) % _ED25519_FIELD
    e = (b - a) % _ED25519_FIELD
    f = (d - c) % _ED25519_FIELD
    g = (d + c) % _ED25519_FIELD
    h = (b + a) % _ED25519_FIELD
    return (
        (e * f) % _ED25519_FIELD,
        (g * h) % _ED25519_FIELD,
        (f * g) % _ED25519_FIELD,
        (e * h) % _ED25519_FIELD,
    )


def _double_edwards_point(point: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x, y, z, _ = point
    a = (x * x) % _ED25519_FIELD
    b = (y * y) % _ED25519_FIELD
    c = (2 * z * z) % _ED25519_FIELD
    d = (-a) % _ED25519_FIELD
    e = ((x + y) * (x + y) - a - b) % _ED25519_FIELD
    g = (d + b) % _ED25519_FIELD
    f = (g - c) % _ED25519_FIELD
    h = (d - b) % _ED25519_FIELD
    return (
        (e * f) % _ED25519_FIELD,
        (g * h) % _ED25519_FIELD,
        (f * g) % _ED25519_FIELD,
        (e * h) % _ED25519_FIELD,
    )


def _scalar_multiply(point: tuple[int, int, int, int], scalar: int) -> tuple[int, int, int, int]:
    result = _ED25519_IDENTITY
    current = point
    remaining = scalar
    while remaining > 0:
        if remaining & 1:
            result = _add_edwards_points(result, current)
        current = _double_edwards_point(current)
        remaining >>= 1
    return result


def _encode_edwards_point(point: tuple[int, int, int, int]) -> bytes:
    x, y, z, _ = point
    inverse_z = pow(z, _ED25519_FIELD - 2, _ED25519_FIELD)
    affine_x = (x * inverse_z) % _ED25519_FIELD
    affine_y = (y * inverse_z) % _ED25519_FIELD
    encoded = bytearray(affine_y.to_bytes(32, "little"))
    encoded[31] |= (affine_x & 1) << 7
    return bytes(encoded)
