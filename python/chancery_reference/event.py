from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from .base58_codec import decode_base58, normalize_public_key
from .binary_codec import BinaryReader, StructValues, decode_struct, encode_struct
from .schema import (
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    SchemaRecord,
    event_schema,
)


@dataclass(frozen=True)
class DecodedChanceryEvent:
    name: str
    values: dict[str, object]
    data: bytes


@dataclass(frozen=True)
class ChanceryInnerInstruction:
    program_address: str
    account_addresses: tuple[str, ...]
    data: bytes
    parent_instruction_index: int
    inner_instruction_index: int
    stack_height: int | None


@dataclass(frozen=True)
class ChanceryEventOccurrence:
    event: DecodedChanceryEvent
    event_authority: str
    parent_instruction_index: int
    inner_instruction_index: int
    stack_height: int | None


def _discriminator(schema: SchemaRecord) -> bytes:
    value = schema.get("discriminator")
    if not isinstance(value, list):
        raise ValueError("Event discriminator must be an array")
    return bytes(cast(list[int], value))


def _event_prefix() -> bytes:
    wire_schema = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
    prefix_value = wire_schema.get("event_cpi_prefix")
    if not isinstance(prefix_value, list):
        raise ValueError("Event prefix must be an array")
    return bytes(cast(list[int], prefix_value))


def _event_payload_offset(data: bytes) -> int:
    prefix = _event_prefix()
    return len(prefix) if data.startswith(prefix) else 0


def _is_event_cpi_data(data: bytes) -> bool:
    prefix = _event_prefix()
    return len(data) >= len(prefix) and data.startswith(prefix)


def _find_event_schema(data: bytes, discriminator_offset: int) -> tuple[str, SchemaRecord]:
    events = cast(dict[str, object], CHANCERY_SCHEMA["events"])
    for event_name, schema_value in events.items():
        if isinstance(schema_value, dict):
            schema = cast(SchemaRecord, schema_value)
            discriminator = _discriminator(schema)
            if data[discriminator_offset : discriminator_offset + len(discriminator)] == discriminator:
                return event_name, schema
    raise ValueError("Unknown Chancery event discriminator")


def _record_from_unknown(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], value)


def _safe_unsigned_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be an unsigned integer")
    return value


def _rpc_public_key(value: object, label: str) -> str:
    if isinstance(value, str):
        return normalize_public_key(value)
    record = _record_from_unknown(value, label)
    public_key = record.get("pubkey")
    if not isinstance(public_key, str):
        raise ValueError(f"{label} must be a public-key string or object with a public-key field")
    return normalize_public_key(public_key)


def _append_rpc_public_keys(destination: list[str], source: object, label: str) -> None:
    if not isinstance(source, list):
        raise ValueError(f"{label} must be an array")
    for index, value in enumerate(source):
        destination.append(_rpc_public_key(value, f"{label}[{index}]"))


def _rpc_account_keys(
    result_record: dict[str, object],
    meta_record: dict[str, object],
) -> tuple[str, ...]:
    transaction = _record_from_unknown(result_record.get("transaction"), "transaction")
    message = _record_from_unknown(transaction.get("message"), "transaction.message")
    static_source = message.get("staticAccountKeys")
    if not isinstance(static_source, list):
        static_source = message.get("accountKeys")

    account_keys: list[str] = []
    _append_rpc_public_keys(account_keys, static_source, "transaction.message.accountKeys")

    loaded_value = meta_record.get("loadedAddresses")
    if loaded_value is not None:
        loaded_addresses = _record_from_unknown(loaded_value, "meta.loadedAddresses")
        writable = loaded_addresses.get("writable", [])
        readonly = loaded_addresses.get("readonly", [])
        _append_rpc_public_keys(account_keys, writable, "meta.loadedAddresses.writable")
        _append_rpc_public_keys(account_keys, readonly, "meta.loadedAddresses.readonly")
    return tuple(account_keys)


def _instruction_account_addresses(
    account_indexes_value: object,
    account_keys: tuple[str, ...],
    label: str,
) -> tuple[str, ...]:
    if not isinstance(account_indexes_value, list):
        raise ValueError(f"{label} must be an array")
    addresses: list[str] = []
    for index, value in enumerate(account_indexes_value):
        account_index = _safe_unsigned_integer(value, f"{label}[{index}]")
        if account_index >= len(account_keys):
            raise ValueError(f"{label}[{index}] references an unavailable account key")
        addresses.append(account_keys[account_index])
    return tuple(addresses)


def decode_chancery_event_data(data: bytes | bytearray | memoryview) -> DecodedChanceryEvent:
    raw = bytes(data)
    discriminator_offset = _event_payload_offset(raw)
    event_name, schema = _find_event_schema(raw, discriminator_offset)
    wire_schema = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
    discriminator_length = cast(int, wire_schema["event_discriminator_bytes"])
    reader = BinaryReader(raw, discriminator_offset + discriminator_length)
    values = decode_struct(schema, reader, f"events.{event_name}")
    if reader.remaining != 0:
        raise ValueError(f"{event_name} has {reader.remaining} trailing bytes")
    return DecodedChanceryEvent(name=event_name, values=values, data=raw)


def encode_chancery_event_data(
    event_name: str,
    values: StructValues,
    include_cpi_prefix: bool = True,
) -> bytes:
    schema = event_schema(event_name)
    prefix = _event_prefix() if include_cpi_prefix else b""
    return prefix + _discriminator(schema) + encode_struct(schema, values, f"events.{event_name}")


def decode_chancery_events_from_inner_instructions(
    inner_instructions: tuple[ChanceryInnerInstruction, ...] | list[ChanceryInnerInstruction],
) -> tuple[ChanceryEventOccurrence, ...]:
    known_pdas = cast(dict[str, object], CHANCERY_SCHEMA["known_pdas"])
    event_authority_value = known_pdas.get("event_authority")
    if not isinstance(event_authority_value, dict):
        raise ValueError("Chancery event-authority metadata is unavailable")
    canonical_event_authority = event_authority_value.get("address")
    if not isinstance(canonical_event_authority, str):
        raise ValueError("Chancery event-authority address is unavailable")

    events: list[ChanceryEventOccurrence] = []
    for inner_instruction in inner_instructions:
        if (
            normalize_public_key(inner_instruction.program_address) != CHANCERY_PROGRAM_ADDRESS
            or not _is_event_cpi_data(inner_instruction.data)
            or len(inner_instruction.account_addresses) == 0
            or normalize_public_key(inner_instruction.account_addresses[0]) != canonical_event_authority
        ):
            continue
        try:
            decoded = decode_chancery_event_data(inner_instruction.data)
        except ValueError as error:
            if str(error) != "Unknown Chancery event discriminator":
                raise
            continue
        events.append(
            ChanceryEventOccurrence(
                event=decoded,
                event_authority=canonical_event_authority,
                parent_instruction_index=inner_instruction.parent_instruction_index,
                inner_instruction_index=inner_instruction.inner_instruction_index,
                stack_height=inner_instruction.stack_height,
            )
        )
    return tuple(events)


def extract_chancery_inner_instructions_from_rpc_transaction(
    result: object,
) -> tuple[ChanceryInnerInstruction, ...]:
    result_record = _record_from_unknown(result, "getTransaction result")
    meta_record = _record_from_unknown(result_record.get("meta"), "getTransaction result.meta")
    if meta_record.get("err") is not None:
        raise ValueError("Cannot extract canonical Chancery events from a failed transaction")

    inner_groups_value = meta_record.get("innerInstructions")
    if inner_groups_value is None:
        return ()
    if not isinstance(inner_groups_value, list):
        raise ValueError("getTransaction result.meta.innerInstructions must be an array or null")

    account_keys = _rpc_account_keys(result_record, meta_record)
    inner_instructions: list[ChanceryInnerInstruction] = []
    for group_index, group_value in enumerate(inner_groups_value):
        group = _record_from_unknown(group_value, f"meta.innerInstructions[{group_index}]")
        parent_instruction_index = _safe_unsigned_integer(
            group.get("index"),
            f"meta.innerInstructions[{group_index}].index",
        )
        instructions_value = group.get("instructions")
        if not isinstance(instructions_value, list):
            raise ValueError(f"meta.innerInstructions[{group_index}].instructions must be an array")

        for instruction_index, instruction_value in enumerate(instructions_value):
            instruction = _record_from_unknown(
                instruction_value,
                f"meta.innerInstructions[{group_index}].instructions[{instruction_index}]",
            )
            program_id_index = _safe_unsigned_integer(
                instruction.get("programIdIndex"),
                f"meta.innerInstructions[{group_index}].instructions[{instruction_index}].programIdIndex",
            )
            if program_id_index >= len(account_keys):
                raise ValueError("Inner instruction programIdIndex references an unavailable account key")
            program_address = account_keys[program_id_index]
            if program_address != CHANCERY_PROGRAM_ADDRESS:
                continue

            encoded_data = instruction.get("data")
            if not isinstance(encoded_data, str):
                raise ValueError("Chancery inner instruction data must be a base58 string")
            stack_height_value = instruction.get("stackHeight")
            stack_height = (
                None
                if stack_height_value is None
                else _safe_unsigned_integer(
                    stack_height_value,
                    f"meta.innerInstructions[{group_index}].instructions[{instruction_index}].stackHeight",
                )
            )
            inner_instructions.append(
                ChanceryInnerInstruction(
                    program_address=program_address,
                    account_addresses=_instruction_account_addresses(
                        instruction.get("accounts"),
                        account_keys,
                        f"meta.innerInstructions[{group_index}].instructions[{instruction_index}].accounts",
                    ),
                    data=decode_base58(encoded_data),
                    parent_instruction_index=parent_instruction_index,
                    inner_instruction_index=instruction_index,
                    stack_height=stack_height,
                )
            )
    return tuple(inner_instructions)


def decode_chancery_events_from_rpc_transaction(
    result: object,
) -> tuple[ChanceryEventOccurrence, ...]:
    return decode_chancery_events_from_inner_instructions(
        extract_chancery_inner_instructions_from_rpc_transaction(result)
    )
