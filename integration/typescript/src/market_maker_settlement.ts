import {
    buildMintDirectInstruction,
    buildRedeemDirectInstruction,
} from "./direct_settlement.ts";
import { instructionToDocument } from "./instruction_json.ts";
import type {
    MintDirectOperationInput,
    PreparedMarketMakerSettlement,
    PreparedMarketMakerSettlementDocument,
    RedeemDirectOperationInput,
} from "./model.ts";

export function prepareMarketMakerMint(
    operation: MintDirectOperationInput,
): PreparedMarketMakerSettlement {
    return {
        action: "mint",
        principal: operation.accounts.principal,
        inputAmount: operation.amount,
        minimumOutput: operation.minimumOutput,
        instruction: buildMintDirectInstruction(operation),
    };
}

export function prepareMarketMakerRedeem(
    operation: RedeemDirectOperationInput,
): PreparedMarketMakerSettlement {
    return {
        action: "redeem",
        principal: operation.accounts.principal,
        inputAmount: operation.amount,
        minimumOutput: operation.minimumOutput,
        instruction: buildRedeemDirectInstruction(operation),
    };
}

export function preparedSettlementToDocument(
    settlement: PreparedMarketMakerSettlement,
): PreparedMarketMakerSettlementDocument {
    return {
        action: settlement.action,
        principal: settlement.principal,
        inputAmount: settlement.inputAmount,
        minimumOutput: settlement.minimumOutput,
        instruction: instructionToDocument(settlement.instruction),
    };
}
