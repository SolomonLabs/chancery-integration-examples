from __future__ import annotations

import base64
from collections.abc import Mapping, Sequence
from typing import cast

from .base58_codec import decode_base58, encode_base58
from .schema import SchemaRecord, TypeSchema, defined_type_schema

StructValues = Mapping[str, object]


def _integer_from_value(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be an integer")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value, 10)
    raise ValueError(f"{label} must be an integer or decimal integer string")


def _encode_unsigned_integer(value: object, byte_length: int, label: str) -> bytes:
    integer_value = _integer_from_value(value, label)
    maximum_value = 1 << (byte_length * 8)
    if integer_value < 0 or integer_value >= maximum_value:
        raise ValueError(f"{label} is outside the unsigned {byte_length * 8}-bit range")
    return integer_value.to_bytes(byte_length, "little", signed=False)


def _encode_signed_integer(value: object, byte_length: int, label: str) -> bytes:
    integer_value = _integer_from_value(value, label)
    minimum_value = -(1 << (byte_length * 8 - 1))
    maximum_value = (1 << (byte_length * 8 - 1)) - 1
    if integer_value < minimum_value or integer_value > maximum_value:
        raise ValueError(f"{label} is outside the signed {byte_length * 8}-bit range")
    return integer_value.to_bytes(byte_length, "little", signed=True)


def decode_base64(encoded: str) -> bytes:
    return base64.b64decode(encoded, validate=True)


def encode_base64(data: bytes | bytearray | memoryview) -> str:
    return base64.b64encode(bytes(data)).decode("ascii")


def bytes_from_value(value: object, label: str) -> bytes:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, Sequence) and not isinstance(value, str):
        byte_values = bytearray()
        for index, byte_value in enumerate(value):
            if isinstance(byte_value, bool) or not isinstance(byte_value, int) or byte_value < 0 or byte_value > 255:
                raise ValueError(f"{label}[{index}] must be an unsigned byte")
            byte_values.append(byte_value)
        return bytes(byte_values)
    if isinstance(value, str):
        if value.startswith("0x"):
            try:
                return bytes.fromhex(value[2:])
            except ValueError as error:
                raise ValueError(f"{label} contains invalid hexadecimal") from error
        if value.startswith("base64:"):
            return decode_base64(value[7:])
    raise ValueError(
        f"{label} must be bytes, an unsigned-byte sequence, 0x-prefixed hexadecimal, or base64-prefixed data"
    )


def _type_kind(type_schema: SchemaRecord) -> str:
    kind = type_schema.get("kind")
    if not isinstance(kind, str):
        raise ValueError("Type schema kind must be a string")
    return kind


def _type_item(type_schema: SchemaRecord) -> TypeSchema:
    item = type_schema.get("item")
    if not isinstance(item, (str, dict)):
        raise ValueError("Type schema item is missing")
    return cast(TypeSchema, item)


def _field_schemas(struct_schema: SchemaRecord) -> list[SchemaRecord]:
    fields_value = struct_schema.get("fields")
    if not isinstance(fields_value, list):
        raise ValueError("Struct schema fields must be an array")
    fields: list[SchemaRecord] = []
    for field_value in fields_value:
        if not isinstance(field_value, dict):
            raise ValueError("Struct field schema must be an object")
        fields.append(cast(SchemaRecord, field_value))
    return fields


def _encode_primitive(type_name: str, value: object, label: str) -> bytes:
    if type_name == "u8":
        return _encode_unsigned_integer(value, 1, label)
    if type_name == "u16":
        return _encode_unsigned_integer(value, 2, label)
    if type_name == "u32":
        return _encode_unsigned_integer(value, 4, label)
    if type_name == "u64":
        return _encode_unsigned_integer(value, 8, label)
    if type_name == "u128":
        return _encode_unsigned_integer(value, 16, label)
    if type_name == "i64":
        return _encode_signed_integer(value, 8, label)
    if type_name == "i128":
        return _encode_signed_integer(value, 16, label)
    if type_name == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"{label} must be a boolean")
        return b"\x01" if value else b"\x00"
    if type_name == "pubkey":
        public_key = decode_base58(value) if isinstance(value, str) else bytes_from_value(value, label)
        if len(public_key) != 32:
            raise ValueError(f"{label} public key must contain 32 bytes")
        return public_key
    raise ValueError(f"Unsupported primitive type: {type_name}")


def encode_type(type_schema: TypeSchema, value: object, label: str = "value") -> bytes:
    if isinstance(type_schema, str):
        return _encode_primitive(type_schema, value, label)

    kind = _type_kind(type_schema)
    if kind == "option":
        if value is None:
            return b"\x00"
        return b"\x01" + encode_type(_type_item(type_schema), value, label)
    if kind == "array":
        length_value = type_schema.get("length")
        if not isinstance(length_value, int):
            raise ValueError("Array type length must be an integer")
        item_schema = _type_item(type_schema)
        if item_schema == "u8":
            data = bytes_from_value(value, label)
            if len(data) != length_value:
                raise ValueError(f"{label} must contain exactly {length_value} bytes")
            return data
        if not isinstance(value, Sequence) or isinstance(value, str):
            raise ValueError(f"{label} must be an array")
        if len(value) != length_value:
            raise ValueError(f"{label} must contain exactly {length_value} items")
        return b"".join(
            encode_type(item_schema, item_value, f"{label}[{index}]")
            for index, item_value in enumerate(value)
        )
    if kind == "vector":
        item_schema = _type_item(type_schema)
        if item_schema == "u8":
            data = bytes_from_value(value, label)
            return _encode_unsigned_integer(len(data), 4, f"{label}.length") + data
        if not isinstance(value, Sequence) or isinstance(value, str):
            raise ValueError(f"{label} must be an array")
        return _encode_unsigned_integer(len(value), 4, f"{label}.length") + b"".join(
            encode_type(item_schema, item_value, f"{label}[{index}]")
            for index, item_value in enumerate(value)
        )
    if kind == "defined":
        type_name = type_schema.get("name")
        if not isinstance(type_name, str):
            raise ValueError("Defined type name must be a string")
        if not isinstance(value, Mapping):
            raise ValueError(f"{label} must be an object")
        return encode_struct(defined_type_schema(type_name), cast(StructValues, value), label)
    raise ValueError(f"Unsupported type schema kind: {kind}")


def zero_value_for_type(type_schema: TypeSchema) -> object:
    if isinstance(type_schema, str):
        if type_schema == "bool":
            return False
        if type_schema == "pubkey":
            return bytes(32)
        return 0
    kind = _type_kind(type_schema)
    if kind == "option":
        return None
    if kind == "vector":
        return b"" if _type_item(type_schema) == "u8" else []
    if kind == "array":
        length_value = type_schema.get("length")
        if not isinstance(length_value, int):
            raise ValueError("Array type length must be an integer")
        item_schema = _type_item(type_schema)
        if item_schema == "u8":
            return bytes(length_value)
        return [zero_value_for_type(item_schema) for _ in range(length_value)]
    if kind == "defined":
        type_name = type_schema.get("name")
        if not isinstance(type_name, str):
            raise ValueError("Defined type name must be a string")
        values: dict[str, object] = {}
        for field_schema in _field_schemas(defined_type_schema(type_name)):
            field_name = field_schema.get("name")
            field_type = field_schema.get("type")
            if not isinstance(field_name, str) or not isinstance(field_type, (str, dict)):
                raise ValueError("Defined type field schema is invalid")
            values[field_name] = zero_value_for_type(cast(TypeSchema, field_type))
        return values
    raise ValueError(f"Unsupported type schema kind: {kind}")


def encode_struct(
    struct_schema: SchemaRecord,
    values: StructValues,
    label: str = "struct",
    default_missing_padding: bool = False,
) -> bytes:
    encoded_fields: list[bytes] = []
    for field_schema in _field_schemas(struct_schema):
        field_name = field_schema.get("name")
        field_type = field_schema.get("type")
        if not isinstance(field_name, str) or not isinstance(field_type, (str, dict)):
            raise ValueError("Struct field schema is invalid")
        typed_field = cast(TypeSchema, field_type)
        field_value = values.get(field_name)
        if field_name not in values and default_missing_padding and (
            field_name.startswith("_pad") or field_name.startswith("_reserved")
        ):
            field_value = zero_value_for_type(typed_field)
        if field_name not in values and not (
            isinstance(typed_field, dict) and typed_field.get("kind") == "option"
        ) and field_value is None:
            raise ValueError(f"{label}.{field_name} is required")
        encoded_fields.append(encode_type(typed_field, field_value, f"{label}.{field_name}"))
    return b"".join(encoded_fields)


class BinaryReader:
    def __init__(self, data: bytes | bytearray | memoryview, offset: int = 0) -> None:
        self._data = bytes(data)
        if offset < 0 or offset > len(self._data):
            raise ValueError("BinaryReader offset is outside the input range")
        self._offset = offset

    @property
    def offset(self) -> int:
        return self._offset

    @property
    def remaining(self) -> int:
        return len(self._data) - self._offset

    def read_bytes(self, byte_length: int, label: str) -> bytes:
        if byte_length < 0 or self._offset + byte_length > len(self._data):
            raise ValueError(
                f"{label} requires {byte_length} bytes with only {self.remaining} remaining"
            )
        data = self._data[self._offset : self._offset + byte_length]
        self._offset += byte_length
        return data


def _decode_primitive(type_name: str, reader: BinaryReader, label: str) -> object:
    if type_name == "u8":
        return int.from_bytes(reader.read_bytes(1, label), "little", signed=False)
    if type_name == "u16":
        return int.from_bytes(reader.read_bytes(2, label), "little", signed=False)
    if type_name == "u32":
        return int.from_bytes(reader.read_bytes(4, label), "little", signed=False)
    if type_name == "u64":
        return int.from_bytes(reader.read_bytes(8, label), "little", signed=False)
    if type_name == "u128":
        return int.from_bytes(reader.read_bytes(16, label), "little", signed=False)
    if type_name == "i64":
        return int.from_bytes(reader.read_bytes(8, label), "little", signed=True)
    if type_name == "i128":
        return int.from_bytes(reader.read_bytes(16, label), "little", signed=True)
    if type_name == "bool":
        value = int.from_bytes(reader.read_bytes(1, label), "little", signed=False)
        if value not in (0, 1):
            raise ValueError(f"{label} contains an invalid boolean tag: {value}")
        return value == 1
    if type_name == "pubkey":
        return encode_base58(reader.read_bytes(32, label))
    raise ValueError(f"Unsupported primitive type: {type_name}")


def decode_type(type_schema: TypeSchema, reader: BinaryReader, label: str = "value") -> object:
    if isinstance(type_schema, str):
        return _decode_primitive(type_schema, reader, label)

    kind = _type_kind(type_schema)
    if kind == "option":
        tag = int.from_bytes(reader.read_bytes(1, f"{label}.tag"), "little")
        if tag == 0:
            return None
        if tag != 1:
            raise ValueError(f"{label} contains an invalid option tag: {tag}")
        return decode_type(_type_item(type_schema), reader, label)
    if kind == "array":
        length_value = type_schema.get("length")
        if not isinstance(length_value, int):
            raise ValueError("Array type length must be an integer")
        item_schema = _type_item(type_schema)
        if item_schema == "u8":
            return reader.read_bytes(length_value, label)
        return [
            decode_type(item_schema, reader, f"{label}[{index}]")
            for index in range(length_value)
        ]
    if kind == "vector":
        length_value = int.from_bytes(reader.read_bytes(4, f"{label}.length"), "little")
        item_schema = _type_item(type_schema)
        if item_schema == "u8":
            return reader.read_bytes(length_value, label)
        return [
            decode_type(item_schema, reader, f"{label}[{index}]")
            for index in range(length_value)
        ]
    if kind == "defined":
        type_name = type_schema.get("name")
        if not isinstance(type_name, str):
            raise ValueError("Defined type name must be a string")
        return decode_struct(defined_type_schema(type_name), reader, label)
    raise ValueError(f"Unsupported type schema kind: {kind}")


def decode_struct(
    struct_schema: SchemaRecord,
    reader: BinaryReader,
    label: str = "struct",
) -> dict[str, object]:
    values: dict[str, object] = {}
    for field_schema in _field_schemas(struct_schema):
        field_name = field_schema.get("name")
        field_type = field_schema.get("type")
        if not isinstance(field_name, str) or not isinstance(field_type, (str, dict)):
            raise ValueError("Struct field schema is invalid")
        values[field_name] = decode_type(
            cast(TypeSchema, field_type), reader, f"{label}.{field_name}"
        )
    return values


def field_schema_by_name(fields_value: object, field_name: str) -> SchemaRecord:
    if not isinstance(fields_value, list):
        raise ValueError("Fields schema must be an array")
    for field_value in fields_value:
        if isinstance(field_value, dict) and field_value.get("name") == field_name:
            return cast(SchemaRecord, field_value)
    raise ValueError(f"Unknown field: {field_name}")


def to_json_compatible(value: object) -> object:
    if isinstance(value, bytes):
        return f"0x{value.hex()}"
    if isinstance(value, dict):
        return {str(key): to_json_compatible(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_json_compatible(item) for item in value]
    if isinstance(value, tuple):
        return [to_json_compatible(item) for item in value]
    return value
