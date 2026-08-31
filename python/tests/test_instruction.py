from __future__ import annotations

import json
import unittest
from pathlib import Path

from chancery_reference import (
    build_chancery_instruction,
    decode_chancery_account,
    decode_chancery_event_data,
    decode_chancery_events_from_rpc_transaction,
    decode_chancery_instruction_data,
    derive_instruction_account_pda,
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    encode_base58,
    encode_chancery_account,
    encode_chancery_event_data,
    encode_chancery_instruction_data,
    lookup_chancery_error,
    parse_chancery_program_error,
)


def load_wire_vectors() -> dict[str, object]:
    fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "wire-vectors.json"
    fixture_value: object = json.loads(fixture_path.read_text(encoding="utf-8"))
    if not isinstance(fixture_value, dict):
        raise ValueError("Wire fixture root must be an object")
    return fixture_value


class InstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.wire_vectors = load_wire_vectors()

    def test_register_asset_builds_exact_data_and_account_metas(self) -> None:
        fixture = self.wire_vectors["register_asset"]
        self.assertIsInstance(fixture, dict)
        instruction = build_chancery_instruction(
            "register_asset",
            fixture["arguments"],
            fixture["account_inputs"],
        )
        self.assertEqual(instruction.data.hex(), fixture["data_hex"])
        self.assertEqual(
            [
                {
                    "name": account.name,
                    "address": account.address,
                    "is_signer": account.is_signer,
                    "is_writable": account.is_writable,
                }
                for account in instruction.accounts
            ],
            fixture["accounts"],
        )
        derived = derive_instruction_account_pda(
            "register_asset",
            "asset_config",
            fixture["arguments"],
            fixture["account_inputs"],
        )
        self.assertEqual(derived.address, fixture["asset_config_address"])
        self.assertEqual(derived.bump, fixture["asset_config_bump"])

    def test_nested_signature_vector_has_stable_encoding(self) -> None:
        fixture = self.wire_vectors["consume_inbound_message"]
        self.assertIsInstance(fixture, dict)
        encoded = encode_chancery_instruction_data(
            "consume_inbound_message",
            fixture["arguments"],
        )
        self.assertEqual(encoded.hex(), fixture["data_hex"])
        decoded = decode_chancery_instruction_data(encoded)
        self.assertEqual(decoded.name, "consume_inbound_message")
        self.assertEqual(
            encode_chancery_instruction_data(decoded.name, decoded.arguments),
            encoded,
        )

    def test_fixed_account_data_matches_shared_vector(self) -> None:
        fixture = self.wire_vectors["asset_pause_state"]
        self.assertIsInstance(fixture, dict)
        encoded = encode_chancery_account("AssetPauseState", fixture["values"])
        self.assertEqual(encoded.hex(), fixture["data_hex"])
        decoded = decode_chancery_account(encoded)
        self.assertEqual(decoded.name, "AssetPauseState")
        self.assertEqual(decoded.values["asset_pause_bits"], 3)
        self.assertEqual(decoded.values["reason_code"], 42)

    def test_event_and_canonical_rpc_extraction_match_shared_vector(self) -> None:
        fixture = self.wire_vectors["asset_registered_event"]
        self.assertIsInstance(fixture, dict)
        encoded = encode_chancery_event_data("AssetRegistered", fixture["values"], True)
        self.assertEqual(encoded.hex(), fixture["data_hex"])
        decoded = decode_chancery_event_data(encoded)
        self.assertEqual(decoded.name, "AssetRegistered")
        self.assertEqual(decoded.values["unix_timestamp"], -12345)
        known_pdas = CHANCERY_SCHEMA["known_pdas"]
        self.assertIsInstance(known_pdas, dict)
        event_authority_schema = known_pdas["event_authority"]
        self.assertIsInstance(event_authority_schema, dict)
        event_authority = event_authority_schema["address"]
        self.assertIsInstance(event_authority, str)
        transaction_result = {
            "transaction": {
                "message": {
                    "accountKeys": [CHANCERY_PROGRAM_ADDRESS],
                },
            },
            "meta": {
                "err": None,
                "loadedAddresses": {"writable": [], "readonly": [event_authority]},
                "innerInstructions": [
                    {
                        "index": 3,
                        "instructions": [
                            {
                                "programIdIndex": 0,
                                "accounts": [0],
                                "data": encode_base58(encoded),
                                "stackHeight": 2,
                            },
                            {
                                "programIdIndex": 0,
                                "accounts": [1],
                                "data": encode_base58(encoded),
                                "stackHeight": 2,
                            },
                        ],
                    },
                ],
            },
        }
        decoded_events = decode_chancery_events_from_rpc_transaction(transaction_result)
        self.assertEqual(len(decoded_events), 1)
        self.assertEqual(decoded_events[0].event.name, "AssetRegistered")
        self.assertEqual(decoded_events[0].event_authority, event_authority)
        self.assertEqual(decoded_events[0].parent_instruction_index, 3)
        self.assertEqual(decoded_events[0].inner_instruction_index, 1)
        self.assertEqual(decoded_events[0].stack_height, 2)

    def test_program_errors_resolve_decimal_and_hexadecimal_messages(self) -> None:
        self.assertEqual(lookup_chancery_error(256).code, 256)
        self.assertEqual(parse_chancery_program_error("custom program error: 0x100").code, 256)
        self.assertEqual(parse_chancery_program_error("custom program error: 256").code, 256)
        self.assertIsNone(parse_chancery_program_error("unrelated"))


if __name__ == "__main__":
    unittest.main()
