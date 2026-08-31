from __future__ import annotations

import re
from dataclasses import dataclass
from typing import cast

from .schema import CHANCERY_SCHEMA, SchemaRecord


@dataclass(frozen=True)
class ChanceryProgramError:
    code: int
    name: str
    message: str


def lookup_chancery_error(code: int) -> ChanceryProgramError | None:
    if isinstance(code, bool) or not isinstance(code, int) or code < 0:
        raise ValueError("Program error code must be a non-negative integer")
    errors = cast(dict[str, object], CHANCERY_SCHEMA["errors"])
    error_value = errors.get(str(code))
    if not isinstance(error_value, dict):
        return None
    error_schema = cast(SchemaRecord, error_value)
    name = error_schema.get("name")
    message = error_schema.get("message")
    if not isinstance(name, str) or not isinstance(message, str):
        raise ValueError("Program error schema is invalid")
    return ChanceryProgramError(code=code, name=name, message=message)


def parse_chancery_program_error(message: str) -> ChanceryProgramError | None:
    hexadecimal_match = re.search(r"custom program error:\s*0x([0-9a-f]+)", message, re.IGNORECASE)
    if hexadecimal_match is not None:
        return lookup_chancery_error(int(hexadecimal_match.group(1), 16))
    decimal_match = re.search(r"custom program error:\s*([0-9]+)", message, re.IGNORECASE)
    if decimal_match is not None:
        return lookup_chancery_error(int(decimal_match.group(1), 10))
    return None
