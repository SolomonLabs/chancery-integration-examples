from __future__ import annotations

from typing import Literal, Protocol, TypeVar

from .model import (
    ExecutedMarketMakerSettlement,
    PreparedMarketMakerSettlement,
    SettlementConfirmationResult,
    SettlementSimulationResult,
)


PreparedTransaction = TypeVar("PreparedTransaction")
SettlementExecutionStage = Literal[
    "preparation",
    "simulation",
    "submission",
    "confirmation",
    "reconciliation",
]


class MarketMakerSettlementExecutionPort(Protocol[PreparedTransaction]):
    def prepare_transaction(
        self,
        settlement: PreparedMarketMakerSettlement,
    ) -> PreparedTransaction:
        ...

    def simulate(
        self,
        transaction: PreparedTransaction,
        settlement: PreparedMarketMakerSettlement,
    ) -> SettlementSimulationResult:
        ...

    def submit(
        self,
        transaction: PreparedTransaction,
        settlement: PreparedMarketMakerSettlement,
    ) -> str:
        ...

    def confirm(
        self,
        signature: str,
        settlement: PreparedMarketMakerSettlement,
    ) -> SettlementConfirmationResult:
        ...

    def reconcile(
        self,
        signature: str,
        settlement: PreparedMarketMakerSettlement,
    ) -> None:
        ...


class SettlementExecutionError(RuntimeError):
    stage: SettlementExecutionStage
    signature: str | None

    def __init__(
        self,
        stage: SettlementExecutionStage,
        message: str,
        signature: str | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.signature = signature


def execute_prepared_market_maker_settlement(
    settlement: PreparedMarketMakerSettlement,
    execution_port: MarketMakerSettlementExecutionPort[PreparedTransaction],
) -> ExecutedMarketMakerSettlement:
    try:
        transaction = execution_port.prepare_transaction(settlement)
    except Exception as error:
        raise SettlementExecutionError("preparation", str(error)) from error

    try:
        simulation = execution_port.simulate(transaction, settlement)
    except Exception as error:
        raise SettlementExecutionError("simulation", str(error)) from error
    if not simulation.accepted:
        raise SettlementExecutionError(
            "simulation",
            simulation.reason or "Settlement simulation was rejected",
        )

    try:
        signature = execution_port.submit(transaction, settlement)
    except Exception as error:
        raise SettlementExecutionError("submission", str(error)) from error
    if not signature.strip():
        raise SettlementExecutionError(
            "submission",
            "Settlement submission returned an empty transaction signature",
        )

    try:
        confirmation = execution_port.confirm(signature, settlement)
    except Exception as error:
        raise SettlementExecutionError(
            "confirmation",
            str(error),
            signature,
        ) from error
    if not confirmation.confirmed:
        raise SettlementExecutionError(
            "confirmation",
            confirmation.reason or "Settlement was not confirmed",
            signature,
        )

    try:
        execution_port.reconcile(signature, settlement)
    except Exception as error:
        raise SettlementExecutionError(
            "reconciliation",
            str(error),
            signature,
        ) from error

    return ExecutedMarketMakerSettlement(
        action=settlement.action,
        signature=signature,
    )
