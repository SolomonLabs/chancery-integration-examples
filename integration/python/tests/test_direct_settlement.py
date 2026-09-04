from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path

from chancery_integration import (
    CHANCERY_PROGRAM_ID,
    DEFAULT_PUBLIC_KEY,
    MAXIMUM_U64,
    build_mint_direct_instruction,
    build_redeem_direct_instruction,
    instruction_to_document,
    load_mint_direct_operation,
    load_redeem_direct_operation,
    parse_pathway_id,
    parse_unsigned_u64,
)
from chancery_integration.model import InstructionSpec


_FIXTURES_DIRECTORY = Path(__file__).resolve().parents[2] / "fixtures"
_VECTORS = json.loads(
    (_FIXTURES_DIRECTORY / "wire-vectors.json").read_text(encoding="utf-8")
)

_MINT_ACCOUNT_NAMES = (
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceAssetTokenAccount",
    "reserveAssetTokenAccount",
    "destinationIssuedTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "mintAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "feePolicy",
    "feeRecipientTokenAccount",
    "limitPolicy",
    "hourlyUsageWindow",
    "dailyUsageWindow",
    "weeklyUsageWindow",
    "monthlyUsageWindow",
    "evidencePolicy",
    "assetLimitPolicy",
    "assetDailyUsageWindow",
    "counterpartyLimitPolicy",
    "counterpartyDailyUsageWindow",
    "eventProgram",
)

_REDEEM_ACCOUNT_NAMES = (
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceIssuedTokenAccount",
    "reserveAssetTokenAccount",
    "destinationAssetTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "reserveAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "feePolicy",
    "feeRecipientTokenAccount",
    "limitPolicy",
    "hourlyUsageWindow",
    "dailyUsageWindow",
    "weeklyUsageWindow",
    "monthlyUsageWindow",
    "evidencePolicy",
    "assetLimitPolicy",
    "assetDailyUsageWindow",
    "counterpartyLimitPolicy",
    "counterpartyDailyUsageWindow",
    "eventProgram",
)

_WRITABLE_FLAGS = (
    False,
    True,
    False,
    False,
    False,
    False,
    False,
    True,
    True,
    True,
    False,
    True,
    False,
    False,
    False,
    False,
    False,
    False,
    False,
    True,
    False,
    True,
    True,
    True,
    True,
    False,
    False,
    True,
    False,
    True,
    False,
)
_SIGNER_FLAGS = tuple(index == 15 for index in range(31))


class DirectSettlementTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mint_operation = load_mint_direct_operation(
            _FIXTURES_DIRECTORY / "direct-mint.operation.json"
        )
        cls.redeem_operation = load_redeem_direct_operation(
            _FIXTURES_DIRECTORY / "direct-redeem.operation.json"
        )

    def assert_instruction_contract(
        self,
        instruction: InstructionSpec,
        account_names: tuple[str, ...],
        vector_name: str,
    ) -> None:
        document = instruction_to_document(instruction)
        accounts = document["accounts"]
        self.assertIsInstance(accounts, list)
        assert isinstance(accounts, list)

        self.assertEqual(document["programId"], _VECTORS["programId"])
        self.assertEqual(document["programId"], CHANCERY_PROGRAM_ID)
        self.assertEqual(len(accounts), 31)
        self.assertEqual(
            tuple(account["name"] for account in accounts),
            account_names,
        )
        self.assertEqual(
            tuple(account["isWritable"] for account in accounts),
            _WRITABLE_FLAGS,
        )
        self.assertEqual(
            tuple(account["isSigner"] for account in accounts),
            _SIGNER_FLAGS,
        )
        self.assertEqual(
            tuple(account["address"] for account in accounts[18:30]),
            (DEFAULT_PUBLIC_KEY,) * 12,
        )
        self.assertEqual(accounts[30]["address"], CHANCERY_PROGRAM_ID)
        self.assertEqual(document["dataHex"], _VECTORS[vector_name]["dataHex"])
        self.assertEqual(
            document["dataBase64"],
            _VECTORS[vector_name]["dataBase64"],
        )
        self.assertEqual(len(instruction.data), 50)

    def test_mint_direct_matches_shared_wire_vector(self) -> None:
        self.assert_instruction_contract(
            build_mint_direct_instruction(self.mint_operation),
            _MINT_ACCOUNT_NAMES,
            "mint",
        )

    def test_redeem_direct_matches_shared_wire_vector(self) -> None:
        self.assert_instruction_contract(
            build_redeem_direct_instruction(self.redeem_operation),
            _REDEEM_ACCOUNT_NAMES,
            "redeem",
        )

    def test_numeric_and_pathway_bounds(self) -> None:
        self.assertEqual(
            parse_unsigned_u64("0", "minimum_output", allow_zero=True),
            0,
        )
        self.assertEqual(
            parse_unsigned_u64(
                str(MAXIMUM_U64),
                "amount",
                allow_zero=False,
            ),
            MAXIMUM_U64,
        )
        self.assertEqual(len(parse_pathway_id(self.mint_operation.pathway_id)), 32)
        with self.assertRaises(ValueError):
            parse_unsigned_u64("0", "amount", allow_zero=False)
        with self.assertRaises(ValueError):
            parse_unsigned_u64(str(MAXIMUM_U64 + 1), "amount", allow_zero=False)
        with self.assertRaises(ValueError):
            parse_unsigned_u64("1.0", "amount", allow_zero=False)
        with self.assertRaises(ValueError):
            parse_pathway_id("00")

    def test_required_accounts_reject_default_public_key(self) -> None:
        invalid_accounts = replace(
            self.mint_operation.accounts,
            principal=DEFAULT_PUBLIC_KEY,
        )
        invalid_operation = replace(
            self.mint_operation,
            accounts=invalid_accounts,
        )
        with self.assertRaises(ValueError):
            build_mint_direct_instruction(invalid_operation)


if __name__ == "__main__":
    unittest.main()
