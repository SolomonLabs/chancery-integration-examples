from __future__ import annotations

import unittest

from chancery_reference import (
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    create_program_address,
    decode_base58,
    encode_base58,
    find_program_address,
)


class ProgramAddressTests(unittest.TestCase):
    def test_base58_preserves_public_key_byte_sequences(self) -> None:
        vectors = (
            bytes(32),
            bytes(range(32)),
            bytes(255 - index for index in range(32)),
        )
        for vector in vectors:
            self.assertEqual(decode_base58(encode_base58(vector)), vector)

    def test_known_program_addresses_reproduce_addresses_and_bumps(self) -> None:
        known_pdas = CHANCERY_SCHEMA["known_pdas"]
        self.assertIsInstance(known_pdas, dict)
        for known_pda_name, known_pda_value in known_pdas.items():
            self.assertIsInstance(known_pda_value, dict)
            seeds = [bytes(seed) for seed in known_pda_value["seeds"]]
            result = find_program_address(seeds, CHANCERY_PROGRAM_ADDRESS)
            self.assertEqual(result.address, known_pda_value["address"], known_pda_name)
            self.assertEqual(
                create_program_address([*seeds, bytes([result.bump])], CHANCERY_PROGRAM_ADDRESS),
                known_pda_value["address"],
                known_pda_name,
            )

    def test_seed_limits_are_enforced(self) -> None:
        with self.assertRaisesRegex(ValueError, "exceeds 32 bytes"):
            find_program_address([bytes(33)])
        with self.assertRaisesRegex(ValueError, "at most 15 seeds"):
            find_program_address([bytes(1)] * 16)


if __name__ == "__main__":
    unittest.main()
