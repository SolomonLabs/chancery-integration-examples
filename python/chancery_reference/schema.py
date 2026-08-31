from __future__ import annotations

import json
from pathlib import Path
from typing import cast

SchemaRecord = dict[str, object]
TypeSchema = str | SchemaRecord


def _load_schema() -> SchemaRecord:
    schema_path = Path(__file__).with_name("chancery.schema.json")
    schema_value: object = json.loads(schema_path.read_text(encoding="utf-8"))
    if not isinstance(schema_value, dict):
        raise ValueError("Chancery schema root must be an object")
    return cast(SchemaRecord, schema_value)


CHANCERY_SCHEMA = _load_schema()
PROGRAM_SCHEMA = cast(SchemaRecord, CHANCERY_SCHEMA["program"])
WIRE_SCHEMA = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
CHANCERY_PROGRAM_ADDRESS = cast(str, PROGRAM_SCHEMA["address"])
ZERO_ADDRESS = cast(str, WIRE_SCHEMA["zero_address"])
SYSTEM_PROGRAM_ADDRESS = cast(str, WIRE_SCHEMA["system_program"])


def instruction_schema(instruction_name: str) -> SchemaRecord:
    instructions = cast(dict[str, object], CHANCERY_SCHEMA["instructions"])
    value = instructions.get(instruction_name)
    if not isinstance(value, dict):
        raise ValueError(f"Unknown Chancery instruction: {instruction_name}")
    return cast(SchemaRecord, value)


def account_schema(account_name: str) -> SchemaRecord:
    accounts = cast(dict[str, object], CHANCERY_SCHEMA["accounts"])
    value = accounts.get(account_name)
    if not isinstance(value, dict):
        raise ValueError(f"Unknown Chancery account: {account_name}")
    return cast(SchemaRecord, value)


def event_schema(event_name: str) -> SchemaRecord:
    events = cast(dict[str, object], CHANCERY_SCHEMA["events"])
    value = events.get(event_name)
    if not isinstance(value, dict):
        raise ValueError(f"Unknown Chancery event: {event_name}")
    return cast(SchemaRecord, value)


def defined_type_schema(type_name: str) -> SchemaRecord:
    types = cast(dict[str, object], CHANCERY_SCHEMA["types"])
    value = types.get(type_name)
    if not isinstance(value, dict):
        raise ValueError(f"Unknown Chancery defined type: {type_name}")
    return cast(SchemaRecord, value)


def chancery_constant(constant_name: str) -> SchemaRecord:
    constants = cast(list[object], CHANCERY_SCHEMA["constants"])
    for constant_value in constants:
        if isinstance(constant_value, dict) and constant_value.get("name") == constant_name:
            return cast(SchemaRecord, constant_value)
    raise ValueError(f"Unknown Chancery constant: {constant_name}")
