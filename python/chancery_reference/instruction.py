from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast

from .base58_codec import decode_public_key, normalize_public_key
from .binary_codec import (
    BinaryReader,
    StructValues,
    encode_struct,
    encode_type,
    decode_struct,
    field_schema_by_name,
)
from .program_address import ProgramAddressResult, find_program_address
from .schema import (
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    SYSTEM_PROGRAM_ADDRESS,
    ZERO_ADDRESS,
    SchemaRecord,
    TypeSchema,
    instruction_schema,
)

PublicKeyInput = str | bytes | bytearray | memoryview
InstructionAccountInputs = Mapping[str, PublicKeyInput | None]


@dataclass(frozen=True)
class InstructionAccountMeta:
    name: str
    address: str
    is_signer: bool
    is_writable: bool


@dataclass(frozen=True)
class ChanceryInstruction:
    program_address: str
    accounts: tuple[InstructionAccountMeta, ...]
    data: bytes


@dataclass(frozen=True)
class DecodedInstructionData:
    name: str
    arguments: dict[str, object]


@dataclass(frozen=True)
class DerivedInstructionPda:
    account_name: str
    address: str
    bump: int


def _instruction_accounts(schema: SchemaRecord) -> list[SchemaRecord]:
    accounts_value = schema.get("accounts")
    if not isinstance(accounts_value, list):
        raise ValueError("Instruction accounts schema must be an array")
    accounts: list[SchemaRecord] = []
    for account_value in accounts_value:
        if not isinstance(account_value, dict):
            raise ValueError("Instruction account schema must be an object")
        accounts.append(cast(SchemaRecord, account_value))
    return accounts


def _instruction_arguments(schema: SchemaRecord) -> list[SchemaRecord]:
    arguments_value = schema.get("args")
    if not isinstance(arguments_value, list):
        raise ValueError("Instruction argument schema must be an array")
    arguments: list[SchemaRecord] = []
    for argument_value in arguments_value:
        if not isinstance(argument_value, dict):
            raise ValueError("Instruction argument schema must be an object")
        arguments.append(cast(SchemaRecord, argument_value))
    return arguments


def _discriminator_bytes(schema: SchemaRecord) -> bytes:
    discriminator_value = schema.get("discriminator")
    if not isinstance(discriminator_value, list):
        raise ValueError("Instruction discriminator must be an array")
    return bytes(cast(list[int], discriminator_value))


def _instruction_by_discriminator(data: bytes) -> tuple[str, SchemaRecord]:
    wire_schema = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
    discriminator_length = cast(int, wire_schema["instruction_discriminator_bytes"])
    if len(data) < discriminator_length:
        raise ValueError("Instruction data is shorter than the Chancery discriminator")
    actual_discriminator = data[:discriminator_length]
    instructions = cast(dict[str, object], CHANCERY_SCHEMA["instructions"])
    for instruction_name, schema_value in instructions.items():
        if (
            isinstance(schema_value, dict)
            and _discriminator_bytes(cast(SchemaRecord, schema_value)) == actual_discriminator
        ):
            return instruction_name, cast(SchemaRecord, schema_value)
    raise ValueError(f"Unknown Chancery instruction discriminator: {actual_discriminator.hex()}")


def _default_account_address(account_schema: SchemaRecord) -> str | None:
    default_value = account_schema.get("default")
    if default_value is None:
        return None
    if not isinstance(default_value, dict):
        raise ValueError("Instruction account default must be an object")
    default_schema = cast(SchemaRecord, default_value)
    kind = default_schema.get("kind")
    if kind == "program_address":
        return CHANCERY_PROGRAM_ADDRESS
    if kind == "system_program":
        return SYSTEM_PROGRAM_ADDRESS
    if kind == "zero_address":
        return ZERO_ADDRESS
    if kind == "known_pda":
        name = default_schema.get("name")
        if not isinstance(name, str):
            raise ValueError("Known PDA default requires a name")
        known_pdas = cast(dict[str, object], CHANCERY_SCHEMA["known_pdas"])
        known_value = known_pdas.get(name)
        if not isinstance(known_value, dict) or not isinstance(known_value.get("address"), str):
            raise ValueError(f"Unknown named Chancery PDA: {name}")
        return cast(str, known_value["address"])
    raise ValueError(f"Unsupported instruction account default: {kind}")


def _encode_pda_argument_seed(
    schema: SchemaRecord,
    argument_values: StructValues,
    seed_name: str,
) -> bytes:
    field_schema = field_schema_by_name(schema.get("args"), seed_name)
    field_type = field_schema.get("type")
    if not isinstance(field_type, (str, dict)):
        raise ValueError(f"PDA seed argument type is invalid: {seed_name}")
    if seed_name not in argument_values:
        raise ValueError(f"PDA seed argument is missing: {seed_name}")
    encoded = encode_type(
        cast(TypeSchema, field_type),
        argument_values[seed_name],
        f"arguments.{seed_name}",
    )
    if len(encoded) > 32:
        raise ValueError(f"PDA seed argument {seed_name} encodes to more than 32 bytes")
    return encoded


def _pda_seed_bytes(
    schema: SchemaRecord,
    seed_schema: SchemaRecord,
    argument_values: StructValues,
    account_addresses: Mapping[str, str],
) -> bytes:
    kind = seed_schema.get("kind")
    if kind == "const":
        byte_values = seed_schema.get("bytes")
        if not isinstance(byte_values, list):
            raise ValueError("Constant PDA seed requires bytes")
        return bytes(cast(list[int], byte_values))
    name = seed_schema.get("name")
    if not isinstance(name, str):
        raise ValueError("Dynamic PDA seed requires a name")
    if kind == "argument":
        return _encode_pda_argument_seed(schema, argument_values, name)
    if kind == "account":
        account_address = account_addresses.get(name)
        if account_address is None:
            raise ValueError(f"PDA seed account is missing: {name}")
        return decode_public_key(account_address)
    raise ValueError(f"Unsupported PDA seed kind: {kind}")


def _derive_from_account_schema(
    schema: SchemaRecord,
    account_schema: SchemaRecord,
    argument_values: StructValues,
    account_addresses: Mapping[str, str],
) -> ProgramAddressResult:
    pda_value = account_schema.get("pda")
    if not isinstance(pda_value, dict):
        raise ValueError("Instruction account has no PDA schema")
    seeds_value = pda_value.get("seeds")
    if not isinstance(seeds_value, list):
        raise ValueError("PDA schema seeds must be an array")
    seeds: list[bytes] = []
    for seed_value in seeds_value:
        if not isinstance(seed_value, dict):
            raise ValueError("PDA seed schema must be an object")
        seeds.append(
            _pda_seed_bytes(
                schema,
                cast(SchemaRecord, seed_value),
                argument_values,
                account_addresses,
            )
        )
    return find_program_address(seeds, CHANCERY_PROGRAM_ADDRESS)


def encode_chancery_instruction_data(
    instruction_name: str,
    argument_values: StructValues | None = None,
) -> bytes:
    schema = instruction_schema(instruction_name)
    values = {} if argument_values is None else argument_values
    return _discriminator_bytes(schema) + encode_struct(
        {"fields": _instruction_arguments(schema)},
        values,
        f"instructions.{instruction_name}.arguments",
    )


def decode_chancery_instruction_data(data: bytes | bytearray | memoryview) -> DecodedInstructionData:
    raw = bytes(data)
    instruction_name, schema = _instruction_by_discriminator(raw)
    wire_schema = cast(SchemaRecord, CHANCERY_SCHEMA["wire"])
    discriminator_length = cast(int, wire_schema["instruction_discriminator_bytes"])
    reader = BinaryReader(raw, discriminator_length)
    arguments = decode_struct(
        {"fields": _instruction_arguments(schema)},
        reader,
        f"instructions.{instruction_name}.arguments",
    )
    if reader.remaining != 0:
        raise ValueError(f"Instruction {instruction_name} has {reader.remaining} trailing bytes")
    return DecodedInstructionData(name=instruction_name, arguments=arguments)


def derive_instruction_account_pda(
    instruction_name: str,
    account_name: str,
    argument_values: StructValues,
    account_inputs: InstructionAccountInputs,
) -> DerivedInstructionPda:
    schema = instruction_schema(instruction_name)
    target_schema: SchemaRecord | None = None
    for account_value in _instruction_accounts(schema):
        if account_value.get("name") == account_name:
            target_schema = account_value
            break
    if target_schema is None or not isinstance(target_schema.get("pda"), dict):
        raise ValueError(f"{instruction_name}.{account_name} has no PDA schema")

    account_addresses: dict[str, str] = {}
    for input_name, input_address in account_inputs.items():
        if input_address is not None:
            account_addresses[input_name] = normalize_public_key(input_address)
    for account_value in _instruction_accounts(schema):
        name = account_value.get("name")
        if not isinstance(name, str) or name in account_addresses:
            continue
        default_address = _default_account_address(account_value)
        if default_address is not None:
            account_addresses[name] = default_address

    result = _derive_from_account_schema(
        schema,
        target_schema,
        argument_values,
        account_addresses,
    )
    return DerivedInstructionPda(
        account_name=account_name,
        address=result.address,
        bump=result.bump,
    )


def resolve_chancery_instruction_accounts(
    instruction_name: str,
    argument_values: StructValues,
    account_inputs: InstructionAccountInputs,
    verify_pdas: bool = True,
) -> tuple[InstructionAccountMeta, ...]:
    schema = instruction_schema(instruction_name)
    account_schemas = _instruction_accounts(schema)
    resolved_addresses: dict[str, str] = {}

    for account_value in account_schemas:
        name = account_value.get("name")
        if not isinstance(name, str):
            raise ValueError("Instruction account name must be a string")
        input_address = account_inputs.get(name)
        if input_address is not None:
            resolved_addresses[name] = normalize_public_key(input_address)
            continue
        default_address = _default_account_address(account_value)
        if default_address is not None:
            resolved_addresses[name] = default_address

    for _ in range(len(account_schemas)):
        changed = False
        for account_value in account_schemas:
            name = account_value.get("name")
            if (
                not isinstance(name, str)
                or name in resolved_addresses
                or not isinstance(account_value.get("pda"), dict)
            ):
                continue
            try:
                result = _derive_from_account_schema(
                    schema,
                    account_value,
                    argument_values,
                    resolved_addresses,
                )
            except ValueError as error:
                if not str(error).startswith("PDA seed account is missing:"):
                    raise
                continue
            resolved_addresses[name] = result.address
            changed = True
        if not changed:
            break

    metas: list[InstructionAccountMeta] = []
    for account_value in account_schemas:
        name = account_value.get("name")
        if not isinstance(name, str):
            raise ValueError("Instruction account name must be a string")
        resolved_address = resolved_addresses.get(name)
        if resolved_address is None:
            raise ValueError(f"Required instruction account is missing: {instruction_name}.{name}")
        if verify_pdas and isinstance(account_value.get("pda"), dict):
            expected_address = _derive_from_account_schema(
                schema,
                account_value,
                argument_values,
                resolved_addresses,
            ).address
            if resolved_address != expected_address:
                raise ValueError(
                    f"PDA mismatch for {instruction_name}.{name}: "
                    f"expected {expected_address}, received {resolved_address}"
                )
        signer = account_value.get("signer")
        writable = account_value.get("writable")
        if not isinstance(signer, bool) or not isinstance(writable, bool):
            raise ValueError("Instruction account flags must be booleans")
        metas.append(
            InstructionAccountMeta(
                name=name,
                address=resolved_address,
                is_signer=signer,
                is_writable=writable,
            )
        )
    return tuple(metas)


def build_chancery_instruction(
    instruction_name: str,
    argument_values: StructValues,
    account_inputs: InstructionAccountInputs,
    verify_pdas: bool = True,
) -> ChanceryInstruction:
    return ChanceryInstruction(
        program_address=CHANCERY_PROGRAM_ADDRESS,
        accounts=resolve_chancery_instruction_accounts(
            instruction_name,
            argument_values,
            account_inputs,
            verify_pdas,
        ),
        data=encode_chancery_instruction_data(instruction_name, argument_values),
    )
