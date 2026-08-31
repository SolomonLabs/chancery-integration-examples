from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from .binary_codec import BinaryReader, StructValues, decode_base64, decode_struct, encode_struct
from .schema import CHANCERY_SCHEMA, SchemaRecord, account_schema


@dataclass(frozen=True)
class DecodedChanceryAccount:
    name: str
    values: dict[str, object]


def _discriminator(schema: SchemaRecord) -> bytes:
    value = schema.get("discriminator")
    if not isinstance(value, list):
        raise ValueError("Account discriminator must be an array")
    return bytes(cast(list[int], value))


def _find_account_schema(data: bytes) -> tuple[str, SchemaRecord]:
    accounts = cast(dict[str, object], CHANCERY_SCHEMA["accounts"])
    for account_name, schema_value in accounts.items():
        if isinstance(schema_value, dict):
            schema = cast(SchemaRecord, schema_value)
            if data.startswith(_discriminator(schema)):
                return account_name, schema
    raise ValueError("Unknown Chancery account discriminator")


def identify_chancery_account(data: bytes | bytearray | memoryview) -> str:
    return _find_account_schema(bytes(data))[0]


def decode_chancery_account(data: bytes | bytearray | memoryview) -> DecodedChanceryAccount:
    raw = bytes(data)
    account_name, schema = _find_account_schema(raw)
    size = schema.get("size")
    if not isinstance(size, int):
        raise ValueError("Account size must be an integer")
    if len(raw) != size:
        raise ValueError(f"{account_name} requires exactly {size} bytes; received {len(raw)}")
    wire_schema = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
    discriminator_length = cast(int, wire_schema["account_discriminator_bytes"])
    reader = BinaryReader(raw, discriminator_length)
    values = decode_struct(schema, reader, f"accounts.{account_name}")
    if reader.remaining != 0:
        raise ValueError(f"{account_name} has {reader.remaining} trailing bytes")
    return DecodedChanceryAccount(name=account_name, values=values)


def decode_chancery_account_base64(encoded: str) -> DecodedChanceryAccount:
    return decode_chancery_account(decode_base64(encoded))


def encode_chancery_account(account_name: str, values: StructValues) -> bytes:
    schema = account_schema(account_name)
    data = _discriminator(schema) + encode_struct(
        schema,
        values,
        f"accounts.{account_name}",
        default_missing_padding=True,
    )
    size = schema.get("size")
    if not isinstance(size, int):
        raise ValueError("Account size must be an integer")
    if len(data) != size:
        raise ValueError(f"{account_name} encoded to {len(data)} bytes; expected {size}")
    return data
