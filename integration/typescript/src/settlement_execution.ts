import type {
    ExecutedMarketMakerSettlement,
    MarketMakerSettlementExecutionPort,
    PreparedMarketMakerSettlement,
} from "./model.ts";

export type SettlementExecutionStage =
    | "preparation"
    | "simulation"
    | "submission"
    | "confirmation"
    | "reconciliation";

export class SettlementExecutionError extends Error {
    readonly stage: SettlementExecutionStage;
    readonly signature: string | null;

    constructor(
        stage: SettlementExecutionStage,
        message: string,
        signature: string | null = null,
    ) {
        super(message);
        this.name = "SettlementExecutionError";
        this.stage = stage;
        this.signature = signature;
    }
}

function executionErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function executePreparedMarketMakerSettlement<PreparedTransaction>(
    settlement: PreparedMarketMakerSettlement,
    executionPort: MarketMakerSettlementExecutionPort<PreparedTransaction>,
): Promise<ExecutedMarketMakerSettlement> {
    let transaction: PreparedTransaction;
    try {
        transaction = await executionPort.prepareTransaction(settlement);
    } catch (error: unknown) {
        throw new SettlementExecutionError(
            "preparation",
            executionErrorMessage(error),
        );
    }

    let simulation;
    try {
        simulation = await executionPort.simulate(transaction, settlement);
    } catch (error: unknown) {
        throw new SettlementExecutionError(
            "simulation",
            executionErrorMessage(error),
        );
    }
    if (!simulation.accepted) {
        throw new SettlementExecutionError("simulation", simulation.reason);
    }

    let signature: string;
    try {
        signature = await executionPort.submit(transaction, settlement);
    } catch (error: unknown) {
        throw new SettlementExecutionError(
            "submission",
            executionErrorMessage(error),
        );
    }
    if (signature.trim().length === 0) {
        throw new SettlementExecutionError(
            "submission",
            "Settlement submission returned an empty transaction signature",
        );
    }

    let confirmation;
    try {
        confirmation = await executionPort.confirm(signature, settlement);
    } catch (error: unknown) {
        throw new SettlementExecutionError(
            "confirmation",
            executionErrorMessage(error),
            signature,
        );
    }
    if (!confirmation.confirmed) {
        throw new SettlementExecutionError(
            "confirmation",
            confirmation.reason,
            signature,
        );
    }

    try {
        await executionPort.reconcile(signature, settlement);
    } catch (error: unknown) {
        throw new SettlementExecutionError(
            "reconciliation",
            executionErrorMessage(error),
            signature,
        );
    }

    return { action: settlement.action, signature };
}
