from __future__ import annotations

import unittest
from pathlib import Path

from chancery_integration import (
    MarketMakerSettlementExecutionPort,
    PreparedMarketMakerSettlement,
    SettlementConfirmationResult,
    SettlementExecutionError,
    SettlementSimulationResult,
    execute_prepared_market_maker_settlement,
    load_mint_direct_operation,
    load_redeem_direct_operation,
    prepare_market_maker_mint,
    prepare_market_maker_redeem,
    prepared_settlement_to_document,
)


_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


class RecordingExecutionPort(
    MarketMakerSettlementExecutionPort[dict[str, str]]
):
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.transaction = {"identifier": "signed-transaction"}
        self.simulation_result = SettlementSimulationResult(accepted=True)
        self.confirmation_result = SettlementConfirmationResult(confirmed=True)
        self.signature = "5N6xMarketMakerSettlementSignature"

    def prepare_transaction(
        self,
        settlement: PreparedMarketMakerSettlement,
    ) -> dict[str, str]:
        del settlement
        self.calls.append("prepare")
        return self.transaction

    def simulate(
        self,
        transaction: dict[str, str],
        settlement: PreparedMarketMakerSettlement,
    ) -> SettlementSimulationResult:
        del settlement
        self.assert_same_transaction(transaction)
        self.calls.append("simulate")
        return self.simulation_result

    def submit(
        self,
        transaction: dict[str, str],
        settlement: PreparedMarketMakerSettlement,
    ) -> str:
        del settlement
        self.assert_same_transaction(transaction)
        self.calls.append("submit")
        return self.signature

    def confirm(
        self,
        signature: str,
        settlement: PreparedMarketMakerSettlement,
    ) -> SettlementConfirmationResult:
        del settlement
        self.calls.append(f"confirm:{signature}")
        return self.confirmation_result

    def reconcile(
        self,
        signature: str,
        settlement: PreparedMarketMakerSettlement,
    ) -> None:
        del settlement
        self.calls.append(f"reconcile:{signature}")

    def assert_same_transaction(self, transaction: dict[str, str]) -> None:
        if transaction is not self.transaction:
            raise AssertionError("execution did not reuse the prepared transaction")


class MarketMakerSettlementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mint_operation = load_mint_direct_operation(
            _FIXTURES / "direct-mint.operation.json"
        )
        self.redeem_operation = load_redeem_direct_operation(
            _FIXTURES / "direct-redeem.operation.json"
        )

    def test_mint_preparation_identifies_inventory_direction(self) -> None:
        settlement = prepare_market_maker_mint(self.mint_operation)
        document = prepared_settlement_to_document(settlement)

        self.assertEqual(settlement.action, "mint")
        self.assertEqual(
            settlement.principal,
            self.mint_operation.accounts.principal,
        )
        self.assertEqual(settlement.input_amount, self.mint_operation.amount)
        self.assertEqual(
            settlement.minimum_output,
            self.mint_operation.minimum_output,
        )
        instruction = document["instruction"]
        self.assertIsInstance(instruction, dict)
        assert isinstance(instruction, dict)
        self.assertEqual(len(instruction["accounts"]), 31)
        self.assertTrue(str(instruction["dataHex"]).startswith("0401"))

    def test_redeem_preparation_identifies_inventory_direction(self) -> None:
        settlement = prepare_market_maker_redeem(self.redeem_operation)
        document = prepared_settlement_to_document(settlement)

        self.assertEqual(settlement.action, "redeem")
        self.assertEqual(
            settlement.principal,
            self.redeem_operation.accounts.principal,
        )
        self.assertEqual(settlement.input_amount, self.redeem_operation.amount)
        self.assertEqual(
            settlement.minimum_output,
            self.redeem_operation.minimum_output,
        )
        instruction = document["instruction"]
        self.assertIsInstance(instruction, dict)
        assert isinstance(instruction, dict)
        self.assertEqual(len(instruction["accounts"]), 31)
        self.assertTrue(str(instruction["dataHex"]).startswith("0402"))

    def test_execution_reuses_one_prepared_transaction(self) -> None:
        settlement = prepare_market_maker_mint(self.mint_operation)
        execution_port = RecordingExecutionPort()

        executed = execute_prepared_market_maker_settlement(
            settlement,
            execution_port,
        )

        self.assertEqual(executed.action, "mint")
        self.assertEqual(executed.signature, execution_port.signature)
        self.assertEqual(
            execution_port.calls,
            [
                "prepare",
                "simulate",
                "submit",
                f"confirm:{execution_port.signature}",
                f"reconcile:{execution_port.signature}",
            ],
        )

    def test_simulation_rejection_prevents_submission(self) -> None:
        settlement = prepare_market_maker_redeem(self.redeem_operation)
        execution_port = RecordingExecutionPort()
        execution_port.simulation_result = SettlementSimulationResult(
            accepted=False,
            reason="program simulation rejected the settlement",
        )

        with self.assertRaises(SettlementExecutionError) as raised:
            execute_prepared_market_maker_settlement(settlement, execution_port)

        self.assertEqual(raised.exception.stage, "simulation")
        self.assertIsNone(raised.exception.signature)
        self.assertEqual(execution_port.calls, ["prepare", "simulate"])

    def test_confirmation_rejection_preserves_signature(self) -> None:
        settlement = prepare_market_maker_mint(self.mint_operation)
        execution_port = RecordingExecutionPort()
        execution_port.confirmation_result = SettlementConfirmationResult(
            confirmed=False,
            reason="blockhash expired before confirmation",
        )

        with self.assertRaises(SettlementExecutionError) as raised:
            execute_prepared_market_maker_settlement(settlement, execution_port)

        self.assertEqual(raised.exception.stage, "confirmation")
        self.assertEqual(raised.exception.signature, execution_port.signature)
        self.assertEqual(
            execution_port.calls,
            [
                "prepare",
                "simulate",
                "submit",
                f"confirm:{execution_port.signature}",
            ],
        )


if __name__ == "__main__":
    unittest.main()
