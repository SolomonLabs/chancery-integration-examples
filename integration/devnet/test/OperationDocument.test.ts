import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildChanceryInstruction, type InstructionAccountInputs } from "../../../typescript/src/ChanceryInstruction.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { knownPdaAddress } from "../../../typescript/src/client/ChanceryProtocol.js";
import type { InstructionDocument, MintDirectOperationInput, RedeemDirectOperationInput } from "../../typescript/src/model.js";
import { directOperationDocument } from "../operation/Document.js";
import type { DirectOperationInspection } from "../operation/Types.js";

function inspectionFor(action: "mint" | "redeem"): DirectOperationInspection {
    const fixture = JSON.parse(readFileSync(resolve("integration/fixtures/direct-" + action + ".operation.json"), "utf8")) as MintDirectOperationInput | RedeemDirectOperationInput;
    const accounts = fixture.accounts;
    const common: InstructionAccountInputs = {
        asset_config: accounts.assetConfig, pathway_policy: accounts.pathwayPolicy,
        permission_record: accounts.permissionRecord, reserve_asset_token_account: accounts.reserveAssetTokenAccount,
        asset_mint: accounts.assetMint, issued_token_mint: accounts.issuedTokenMint,
        asset_token_program: accounts.assetTokenProgram, issued_token_program: accounts.issuedTokenProgram,
        principal: accounts.principal, asset_pause_state: accounts.assetPauseState,
    };
    const inputAmount = BigInt(fixture.amount);
    const minimumOutput = BigInt(fixture.minimumOutput);
    if (action === "mint") {
        const mint = fixture as MintDirectOperationInput;
        return {
            ready: true, blockingIssues: [], request: { action, mode: "direct" }, instructionName: "mint_direct",
            amounts: { inputAmount, minimumOutput },
            instructionArguments: { pathway_id: Buffer.from(fixture.pathwayId, "hex"), asset_amount: inputAmount, minimum_issued_token_amount: minimumOutput },
            instructionAccounts: { ...common, source_asset_token_account: mint.accounts.sourceAssetTokenAccount,
                destination_issued_token_account: mint.accounts.destinationIssuedTokenAccount, mint_authority_pda: mint.accounts.mintAuthorityPda },
        };
    }
    const redeem = fixture as RedeemDirectOperationInput;
    return {
        ready: true, blockingIssues: [], request: { action, mode: "direct" }, instructionName: "redeem_direct",
        amounts: { inputAmount, minimumOutput },
        instructionArguments: { pathway_id: Buffer.from(fixture.pathwayId, "hex"), issued_token_amount: inputAmount, minimum_asset_amount: minimumOutput },
        instructionAccounts: { ...common, source_issued_token_account: redeem.accounts.sourceIssuedTokenAccount,
            destination_asset_token_account: redeem.accounts.destinationAssetTokenAccount },
    };
}

for (const action of ["mint", "redeem"] as const) {
    test(action + " export resolves defaults and round-trips through the existing example", () => {
        const inspection = inspectionFor(action);
        const instruction = buildChanceryInstruction(inspection.instructionName, inspection.instructionArguments, inspection.instructionAccounts, true);
        const document = directOperationDocument(inspection);
        assert.equal(document.accounts.moduleActivationState, knownPdaAddress("module_activation_state"));
        assert.equal(document.accounts.chanceryConfig, knownPdaAddress("chancery_config"));
        assert.equal(document.accounts.eventAuthority, knownPdaAddress("event_authority"));
        assert.equal(document.accounts.issuedTokenControl, knownPdaAddress("issued_token_control"));
        assert.equal(Object.keys(document.accounts.policyAccounts).length, 12);
        assert.ok(Object.values(document.accounts.policyAccounts).every((account) => account === null));
        const directory = mkdtempSync(join(tmpdir(), "chancery-operation-"));
        try {
            const path = join(directory, action + ".operation.json");
            writeFileSync(path, JSON.stringify(document));
            const output = execFileSync(process.execPath, ["--experimental-strip-types",
                resolve("integration/typescript/examples/build_" + action + ".ts"), path],
                { encoding: "utf8", env: { ...process.env, CHANCERY_TARGET: "devnet" }, stdio: ["ignore", "pipe", "pipe"] });
            const built = JSON.parse(output) as InstructionDocument;
            assert.equal(built.programId, CHANCERY_DEVNET_PROGRAM_ADDRESS);
            assert.equal(built.dataHex, Buffer.from(instruction.data).toString("hex"));
            assert.equal(built.accounts.length, 31);
            assert.deepEqual(built.accounts.map(({ address, isSigner, isWritable }) => ({ address, isSigner, isWritable })),
                instruction.accounts.map(({ address, isSigner, isWritable }) => ({ address, isSigner, isWritable })));
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test("operation export preserves present optional accounts and the full input range", () => {
    const inspection = inspectionFor("mint");
    const amount = (1n << 64n) - 1n;
    const present = inspection.instructionAccounts.asset_config!;
    const document = directOperationDocument({ ...inspection, amounts: { inputAmount: amount, minimumOutput: 0n },
        instructionArguments: { ...inspection.instructionArguments, asset_amount: amount, minimum_issued_token_amount: 0n },
        instructionAccounts: { ...inspection.instructionAccounts, fee_policy: present } });
    assert.equal(document.amount, "18446744073709551615");
    assert.equal(document.minimumOutput, "0");
    assert.equal(document.accounts.policyAccounts.feePolicy, present);
    assert.equal(document.accounts.policyAccounts.limitPolicy, null);
});

test("operation export rejects blocked, non-direct, and action-mismatched inspections", () => {
    const inspection = inspectionFor("mint");
    assert.throws(() => directOperationDocument({ ...inspection, ready: false, blockingIssues: ["asset paused"] }), /asset paused/);
    assert.throws(() => directOperationDocument({ ...inspection, request: { action: "mint", mode: "delegated" } }), /direct/);
    assert.throws(() => directOperationDocument({ ...inspection, instructionName: "redeem_direct" }), /differs/);
    assert.throws(() => directOperationDocument({ ...inspection,
        instructionAccounts: { ...inspection.instructionAccounts, source_asset_token_account: undefined } }), /source_asset_token_account/);
});
