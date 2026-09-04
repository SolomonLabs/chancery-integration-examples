import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    SettlementExecutionError,
    executePreparedMarketMakerSettlement,
    loadMintDirectOperation,
    loadRedeemDirectOperation,
    prepareMarketMakerMint,
    prepareMarketMakerRedeem,
    preparedSettlementToDocument,
} from "../src/index.ts";
import type {
    MarketMakerSettlementExecutionPort,
    PreparedMarketMakerSettlement,
    SettlementConfirmationResult,
    SettlementSimulationResult,
} from "../src/index.ts";

interface PreparedTransaction {
    readonly identifier: string;
}

const fixturesDirectory = new URL("../../fixtures/", import.meta.url);
const mintOperation = loadMintDirectOperation(
    fileURLToPath(new URL("direct-mint.operation.json", fixturesDirectory)),
);
const redeemOperation = loadRedeemDirectOperation(
    fileURLToPath(new URL("direct-redeem.operation.json", fixturesDirectory)),
);

class RecordingExecutionPort implements MarketMakerSettlementExecutionPort<PreparedTransaction> {
    readonly calls: string[] = [];
    readonly transaction: PreparedTransaction = { identifier: "signed-transaction" };
    simulationResult: SettlementSimulationResult = { accepted: true };
    confirmationResult: SettlementConfirmationResult = { confirmed: true };
    signature = "5N6xMarketMakerSettlementSignature";

    async prepareTransaction(
        _settlement: PreparedMarketMakerSettlement,
    ): Promise<PreparedTransaction> {
        this.calls.push("prepare");
        return this.transaction;
    }

    async simulate(
        transaction: PreparedTransaction,
        _settlement: PreparedMarketMakerSettlement,
    ): Promise<SettlementSimulationResult> {
        assert.equal(transaction, this.transaction);
        this.calls.push("simulate");
        return this.simulationResult;
    }

    async submit(
        transaction: PreparedTransaction,
        _settlement: PreparedMarketMakerSettlement,
    ): Promise<string> {
        assert.equal(transaction, this.transaction);
        this.calls.push("submit");
        return this.signature;
    }

    async confirm(
        signature: string,
        _settlement: PreparedMarketMakerSettlement,
    ): Promise<SettlementConfirmationResult> {
        this.calls.push("confirm:" + signature);
        return this.confirmationResult;
    }

    async reconcile(
        signature: string,
        _settlement: PreparedMarketMakerSettlement,
    ): Promise<void> {
        this.calls.push("reconcile:" + signature);
    }
}

test("market maker mint preparation identifies the inventory direction", () => {
    const settlement = prepareMarketMakerMint(mintOperation);
    const document = preparedSettlementToDocument(settlement);

    assert.equal(settlement.action, "mint");
    assert.equal(settlement.principal, mintOperation.accounts.principal);
    assert.equal(settlement.inputAmount, mintOperation.amount);
    assert.equal(settlement.minimumOutput, mintOperation.minimumOutput);
    assert.equal(document.instruction.accounts.length, 31);
    assert.equal(document.instruction.dataHex.slice(0, 4), "0401");
});

test("market maker redeem preparation identifies the inventory direction", () => {
    const settlement = prepareMarketMakerRedeem(redeemOperation);
    const document = preparedSettlementToDocument(settlement);

    assert.equal(settlement.action, "redeem");
    assert.equal(settlement.principal, redeemOperation.accounts.principal);
    assert.equal(settlement.inputAmount, redeemOperation.amount);
    assert.equal(settlement.minimumOutput, redeemOperation.minimumOutput);
    assert.equal(document.instruction.accounts.length, 31);
    assert.equal(document.instruction.dataHex.slice(0, 4), "0402");
});

test("execution reuses one prepared transaction through simulation and submission", async () => {
    const settlement = prepareMarketMakerMint(mintOperation);
    const executionPort = new RecordingExecutionPort();

    const executed = await executePreparedMarketMakerSettlement(
        settlement,
        executionPort,
    );

    assert.deepEqual(executed, {
        action: "mint",
        signature: executionPort.signature,
    });
    assert.deepEqual(executionPort.calls, [
        "prepare",
        "simulate",
        "submit",
        "confirm:" + executionPort.signature,
        "reconcile:" + executionPort.signature,
    ]);
});

test("simulation rejection prevents submission", async () => {
    const settlement = prepareMarketMakerRedeem(redeemOperation);
    const executionPort = new RecordingExecutionPort();
    executionPort.simulationResult = {
        accepted: false,
        reason: "program simulation rejected the settlement",
    };

    await assert.rejects(
        executePreparedMarketMakerSettlement(settlement, executionPort),
        (error: unknown) => {
            assert.ok(error instanceof SettlementExecutionError);
            assert.equal(error.stage, "simulation");
            assert.equal(error.signature, null);
            return true;
        },
    );
    assert.deepEqual(executionPort.calls, ["prepare", "simulate"]);
});

test("confirmation rejection preserves the submitted signature", async () => {
    const settlement = prepareMarketMakerMint(mintOperation);
    const executionPort = new RecordingExecutionPort();
    executionPort.confirmationResult = {
        confirmed: false,
        reason: "blockhash expired before confirmation",
    };

    await assert.rejects(
        executePreparedMarketMakerSettlement(settlement, executionPort),
        (error: unknown) => {
            assert.ok(error instanceof SettlementExecutionError);
            assert.equal(error.stage, "confirmation");
            assert.equal(error.signature, executionPort.signature);
            return true;
        },
    );
    assert.deepEqual(executionPort.calls, [
        "prepare",
        "simulate",
        "submit",
        "confirm:" + executionPort.signature,
    ]);
});
