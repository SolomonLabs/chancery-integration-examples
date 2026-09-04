import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    CHANCERY_PROGRAM_ID,
    DEFAULT_PUBLIC_KEY,
    MAXIMUM_U64,
    buildMintDirectInstruction,
    buildRedeemDirectInstruction,
    instructionToDocument,
    loadMintDirectOperation,
    loadRedeemDirectOperation,
    parsePathwayId,
    parseUnsignedU64,
} from "../src/index.ts";
import type {
    MintDirectOperationInput,
    RedeemDirectOperationInput,
} from "../src/index.ts";

interface OperationVector<Operation> {
    readonly operation: Operation;
    readonly dataHex: string;
    readonly dataBase64: string;
}

interface WireVectors {
    readonly programId: string;
    readonly defaultPublicKey: string;
    readonly mint: OperationVector<MintDirectOperationInput>;
    readonly redeem: OperationVector<RedeemDirectOperationInput>;
}

const fixturesDirectory = new URL("../../fixtures/", import.meta.url);
const vectors = JSON.parse(
    readFileSync(new URL("wire-vectors.json", fixturesDirectory), "utf8"),
) as WireVectors;

const mintAccountNames = [
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
];

const redeemAccountNames = [
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
];

const writableFlags = [
    false, true, false, false, false, false, false, true, true, true,
    false, true, false, false, false, false, false, false, false, true,
    false, true, true, true, true, false, false, true, false, true, false,
];
const signerFlags = Array.from({ length: 31 }, (_, index) => index === 15);

function assertInstructionContract(
    accountNames: readonly string[],
    dataHex: string,
    dataBase64: string,
    operationInstruction: ReturnType<typeof buildMintDirectInstruction>,
): void {
    const document = instructionToDocument(operationInstruction);
    assert.equal(document.programId, vectors.programId);
    assert.equal(document.programId, CHANCERY_PROGRAM_ID);
    assert.equal(document.accounts.length, 31);
    assert.deepEqual(document.accounts.map((account) => account.name), accountNames);
    assert.deepEqual(document.accounts.map((account) => account.isWritable), writableFlags);
    assert.deepEqual(document.accounts.map((account) => account.isSigner), signerFlags);
    assert.deepEqual(
        document.accounts.slice(18, 30).map((account) => account.address),
        Array.from({ length: 12 }, () => DEFAULT_PUBLIC_KEY),
    );
    assert.equal(document.accounts[30]?.address, CHANCERY_PROGRAM_ID);
    assert.equal(document.dataHex, dataHex);
    assert.equal(document.dataBase64, dataBase64);
    assert.equal(operationInstruction.data.length, 50);
}

test("mint_direct matches the shared wire vector", () => {
    assertInstructionContract(
        mintAccountNames,
        vectors.mint.dataHex,
        vectors.mint.dataBase64,
        buildMintDirectInstruction(vectors.mint.operation),
    );
});

test("redeem_direct matches the shared wire vector", () => {
    assertInstructionContract(
        redeemAccountNames,
        vectors.redeem.dataHex,
        vectors.redeem.dataBase64,
        buildRedeemDirectInstruction(vectors.redeem.operation),
    );
});

test("operation files parse to the shared vectors", () => {
    const mintPath = fileURLToPath(new URL("direct-mint.operation.json", fixturesDirectory));
    const redeemPath = fileURLToPath(new URL("direct-redeem.operation.json", fixturesDirectory));
    assert.deepEqual(loadMintDirectOperation(mintPath), vectors.mint.operation);
    assert.deepEqual(loadRedeemDirectOperation(redeemPath), vectors.redeem.operation);
});

test("numeric and pathway bounds are enforced", () => {
    assert.equal(parseUnsignedU64("0", "minimumOutput", true), 0n);
    assert.equal(parseUnsignedU64(MAXIMUM_U64.toString(), "amount", false), MAXIMUM_U64);
    assert.equal(parsePathwayId(vectors.mint.operation.pathwayId).length, 32);
    assert.throws(() => parseUnsignedU64("0", "amount", false));
    assert.throws(() => parseUnsignedU64((MAXIMUM_U64 + 1n).toString(), "amount", false));
    assert.throws(() => parseUnsignedU64("1.0", "amount", false));
    assert.throws(() => parsePathwayId("00"));
});

test("required accounts reject the default public key", () => {
    const invalidOperation: MintDirectOperationInput = {
        ...vectors.mint.operation,
        accounts: {
            ...vectors.mint.operation.accounts,
            principal: vectors.defaultPublicKey,
        },
    };
    assert.throws(() => buildMintDirectInstruction(invalidOperation));
});
