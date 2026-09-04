from __future__ import annotations

from .direct_settlement import (
    build_mint_direct_instruction,
    build_redeem_direct_instruction,
)
from .instruction_json import instruction_to_document
from .model import (
    MintDirectOperationInput,
    PreparedMarketMakerSettlement,
    RedeemDirectOperationInput,
)


def prepare_market_maker_mint(
    operation: MintDirectOperationInput,
) -> PreparedMarketMakerSettlement:
    return PreparedMarketMakerSettlement(
        action="mint",
        principal=operation.accounts.principal,
        input_amount=operation.amount,
        minimum_output=operation.minimum_output,
        instruction=build_mint_direct_instruction(operation),
    )


def prepare_market_maker_redeem(
    operation: RedeemDirectOperationInput,
) -> PreparedMarketMakerSettlement:
    return PreparedMarketMakerSettlement(
        action="redeem",
        principal=operation.accounts.principal,
        input_amount=operation.amount,
        minimum_output=operation.minimum_output,
        instruction=build_redeem_direct_instruction(operation),
    )


def prepared_settlement_to_document(
    settlement: PreparedMarketMakerSettlement,
) -> dict[str, object]:
    return {
        "action": settlement.action,
        "principal": settlement.principal,
        "inputAmount": settlement.input_amount,
        "minimumOutput": settlement.minimum_output,
        "instruction": instruction_to_document(settlement.instruction),
    }
