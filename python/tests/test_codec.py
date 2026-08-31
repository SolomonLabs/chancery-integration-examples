from __future__ import annotations

import unittest
from pathlib import Path

from chancery_reference import (
    CHANCERY_SCHEMA,
    decode_chancery_account,
    decode_chancery_event_data,
    decode_chancery_instruction_data,
    encode_chancery_account,
    encode_chancery_event_data,
    encode_chancery_instruction_data,
    chancery_constant,
    identify_chancery_account,
    lookup_chancery_error,
    parse_chancery_program_error,
    resolve_chancery_instruction_accounts,
    ZERO_ADDRESS,
)
from chancery_reference.binary_codec import zero_value_for_type


def zero_struct_values(fields: list[object]) -> dict[str, object]:
    values: dict[str, object] = {}
    for field_value in fields:
        if not isinstance(field_value, dict):
            raise ValueError("Field schema must be an object")
        field_name = field_value.get("name")
        field_type = field_value.get("type")
        if not isinstance(field_name, str) or not isinstance(field_type, (str, dict)):
            raise ValueError("Field schema is invalid")
        values[field_name] = zero_value_for_type(field_type)
    return values


def zero_account_inputs(accounts: list[object]) -> dict[str, str]:
    inputs: dict[str, str] = {}
    for account_value in accounts:
        if not isinstance(account_value, dict):
            raise ValueError("Instruction account schema must be an object")
        account_name = account_value.get("name")
        if not isinstance(account_name, str):
            raise ValueError("Instruction account name must be a string")
        if "pda" not in account_value and "default" not in account_value:
            inputs[account_name] = ZERO_ADDRESS
    return inputs


class CodecTests(unittest.TestCase):
    def test_packages_carry_identical_schema_files(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        typescript_schema = (repository_root / "typescript" / "chancery.schema.json").read_bytes()
        python_schema = (
            repository_root / "python" / "chancery_reference" / "chancery.schema.json"
        ).read_bytes()
        self.assertEqual(typescript_schema, python_schema)
        self.assertEqual(
            {
                "instructions": len(CHANCERY_SCHEMA["instructions"]),
                "accounts": len(CHANCERY_SCHEMA["accounts"]),
                "events": len(CHANCERY_SCHEMA["events"]),
                "types": len(CHANCERY_SCHEMA["types"]),
                "constants": len(CHANCERY_SCHEMA["constants"]),
                "errors": len(CHANCERY_SCHEMA["errors"]),
            },
            {
                "instructions": 68,
                "accounts": 22,
                "events": 52,
                "types": 1,
                "constants": 390,
                "errors": 219,
            },
        )

    def test_wire_discriminators_are_unique_and_have_declared_lengths(self) -> None:
        wire = CHANCERY_SCHEMA["wire"]
        discriminator_groups = (
            ("instruction", wire["instruction_discriminator_bytes"], CHANCERY_SCHEMA["instructions"]),
            ("account", wire["account_discriminator_bytes"], CHANCERY_SCHEMA["accounts"]),
            ("event", wire["event_discriminator_bytes"], CHANCERY_SCHEMA["events"]),
        )
        for group_name, expected_length, schemas in discriminator_groups:
            self.assertIsInstance(expected_length, int)
            self.assertIsInstance(schemas, dict)
            seen: set[tuple[int, ...]] = set()
            for schema_name, schema_value in schemas.items():
                self.assertIsInstance(schema_value, dict)
                discriminator = schema_value["discriminator"]
                self.assertIsInstance(discriminator, list)
                self.assertEqual(len(discriminator), expected_length, f"{group_name}.{schema_name}")
                key = tuple(discriminator)
                self.assertNotIn(key, seen, f"{group_name} discriminator collision: {schema_name}")
                seen.add(key)

    def test_every_instruction_schema_round_trips(self) -> None:
        instructions = CHANCERY_SCHEMA["instructions"]
        self.assertIsInstance(instructions, dict)
        for instruction_name, instruction_value in instructions.items():
            self.assertIsInstance(instruction_value, dict)
            fields = instruction_value["args"]
            self.assertIsInstance(fields, list)
            encoded = encode_chancery_instruction_data(
                instruction_name,
                zero_struct_values(fields),
            )
            decoded = decode_chancery_instruction_data(encoded)
            self.assertEqual(decoded.name, instruction_name)
            self.assertEqual(
                encode_chancery_instruction_data(instruction_name, decoded.arguments),
                encoded,
                instruction_name,
            )

    def test_every_instruction_resolves_complete_ordered_account_metas(self) -> None:
        instructions = CHANCERY_SCHEMA["instructions"]
        self.assertIsInstance(instructions, dict)
        for instruction_name, instruction_value in instructions.items():
            self.assertIsInstance(instruction_value, dict)
            arguments = instruction_value["args"]
            accounts = instruction_value["accounts"]
            self.assertIsInstance(arguments, list)
            self.assertIsInstance(accounts, list)
            account_metas = resolve_chancery_instruction_accounts(
                instruction_name,
                zero_struct_values(arguments),
                zero_account_inputs(accounts),
            )
            self.assertEqual(len(account_metas), len(accounts), instruction_name)
            for account_index, account_meta in enumerate(account_metas):
                account_schema = accounts[account_index]
                self.assertIsInstance(account_schema, dict)
                self.assertEqual(account_meta.name, account_schema["name"])
                self.assertEqual(account_meta.is_signer, account_schema["signer"])
                self.assertEqual(account_meta.is_writable, account_schema["writable"])
                self.assertNotEqual(account_meta.address, "")

    def test_every_constant_and_program_error_is_addressable(self) -> None:
        constants = CHANCERY_SCHEMA["constants"]
        self.assertIsInstance(constants, list)
        for constant_schema in constants:
            self.assertIsInstance(constant_schema, dict)
            constant_name = constant_schema["name"]
            self.assertIsInstance(constant_name, str)
            self.assertEqual(chancery_constant(constant_name), constant_schema)

        errors = CHANCERY_SCHEMA["errors"]
        self.assertIsInstance(errors, dict)
        for encoded_code, error_schema in errors.items():
            self.assertIsInstance(error_schema, dict)
            code = int(encoded_code, 10)
            expected_name = error_schema["name"]
            expected_message = error_schema["message"]
            resolved = lookup_chancery_error(code)
            self.assertIsNotNone(resolved)
            self.assertEqual(resolved.name, expected_name)
            self.assertEqual(resolved.message, expected_message)
            self.assertEqual(parse_chancery_program_error(f"custom program error: {code}"), resolved)
            self.assertEqual(parse_chancery_program_error(f"custom program error: 0x{code:x}"), resolved)

    def test_every_account_layout_round_trips_at_exact_size(self) -> None:
        accounts = CHANCERY_SCHEMA["accounts"]
        self.assertIsInstance(accounts, dict)
        for account_name, account_value in accounts.items():
            self.assertIsInstance(account_value, dict)
            fields = account_value["fields"]
            self.assertIsInstance(fields, list)
            encoded = encode_chancery_account(account_name, zero_struct_values(fields))
            self.assertEqual(len(encoded), account_value["size"], account_name)
            self.assertEqual(identify_chancery_account(encoded), account_name)
            decoded = decode_chancery_account(encoded)
            self.assertEqual(decoded.name, account_name)
            self.assertEqual(encode_chancery_account(account_name, decoded.values), encoded)

    def test_every_event_layout_round_trips_with_both_prefix_forms(self) -> None:
        events = CHANCERY_SCHEMA["events"]
        self.assertIsInstance(events, dict)
        for event_name, event_value in events.items():
            self.assertIsInstance(event_value, dict)
            fields = event_value["fields"]
            self.assertIsInstance(fields, list)
            values = zero_struct_values(fields)
            prefixed = encode_chancery_event_data(event_name, values, True)
            bare = encode_chancery_event_data(event_name, values, False)
            self.assertEqual(decode_chancery_event_data(prefixed).name, event_name)
            self.assertEqual(decode_chancery_event_data(bare).name, event_name)
            decoded = decode_chancery_event_data(prefixed)
            self.assertEqual(
                encode_chancery_event_data(event_name, decoded.values, True),
                prefixed,
                event_name,
            )


if __name__ == "__main__":
    unittest.main()
