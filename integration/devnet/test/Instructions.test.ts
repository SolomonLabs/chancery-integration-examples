import assert from "node:assert/strict";
import test from "node:test";
import { encodeBase58 } from "../../../typescript/src/Base58Codec.js";
import { buildChanceryInstruction } from "../../../typescript/src/ChanceryInstruction.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS, CHANCERY_MAINNET_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { compileUnversionedMessage, keypairFromSecretKeyBytes, signSolanaTransaction, type SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { deriveAssociatedTokenAddress, SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "../../../typescript/src/SplToken.js";
import { knownPdaAddress } from "../../../typescript/src/client/ChanceryProtocol.js";
import { FAUCET_PROGRAM_ADDRESS, testAssetForSymbol } from "../configuration/Deployment.js";
import { controllerAuthority, faucetAuthority } from "../controller/Authority.js";
import { createAssociatedTokenAccountInstruction } from "../instructions/AssociatedTokenAccount.js";
import { executeChanceryInstruction } from "../instructions/ExecuteChancery.js";
import { mintTestAssetInstruction } from "../instructions/Faucet.js";
import { scheduleConfigChangeInstruction } from "../instructions/ScheduleConfigChange.js";

const signer = keypairFromSecretKeyBytes(new Uint8Array(32).fill(7));
const target = encodeBase58(new Uint8Array(32).fill(8));

function proposal(): SolanaInstruction {
    return buildChanceryInstruction("propose_config_change", {
        change_kind: 5, risk_class: 2, target_account: target,
        old_value_hash: new Uint8Array(32), new_value_hash: new Uint8Array(32).fill(1),
        executable_after_unix_timestamp: 0n, expires_at_unix_timestamp: 0n, proposer_nonce: 42n,
    }, { activation_state: knownPdaAddress("module_activation_state"), pending: target,
        payer: signer.publicKey, governance_authority: controllerAuthority(0) });
}

test("controller relay clears PDA signer flags while preserving order and writability", () => {
    const instruction: SolanaInstruction = {
        programAddress: CHANCERY_DEVNET_PROGRAM_ADDRESS,
        accounts: [
            { address: signer.publicKey, isSigner: true, isWritable: true },
            { address: controllerAuthority(0), isSigner: true, isWritable: false },
            { address: controllerAuthority(1), isSigner: true, isWritable: true },
            { address: target, isSigner: false, isWritable: true },
        ],
        data: Uint8Array.of(9, 7, 10, 20),
    };
    const wrapped = executeChanceryInstruction(signer.publicKey, instruction);
    assert.equal(wrapped.programAddress, FAUCET_PROGRAM_ADDRESS);
    assert.deepEqual(wrapped.data, Uint8Array.of(1, 3, 9, 7, 10, 20));
    assert.deepEqual(wrapped.accounts.slice(2), instruction.accounts.map((account, index) => ({ ...account, isSigner: index === 0 })));
    assert.equal(instruction.accounts[1]!.isSigner, true);
    const message = compileUnversionedMessage([wrapped], signer.publicKey, target);
    assert.deepEqual(message.signerAddresses, [signer.publicKey]);
    assert.ok(signSolanaTransaction(message, [signer]).primarySignature.length > 0);
});

test("controller relay rejects other programs, missing roles, and additional signers", () => {
    const instruction = proposal();
    assert.throws(() => executeChanceryInstruction(signer.publicKey, { ...instruction, programAddress: CHANCERY_MAINNET_PROGRAM_ADDRESS }), /devnet/);
    assert.throws(() => executeChanceryInstruction(signer.publicKey, { ...instruction, data: Uint8Array.of(9) }), /devnet/);
    assert.throws(() => executeChanceryInstruction(signer.publicKey, { ...instruction, accounts: [] }), /at least one/);
    assert.throws(() => executeChanceryInstruction(signer.publicKey, { ...instruction,
        accounts: [...instruction.accounts, { address: target, isSigner: true, isWritable: false }] }), /Additional signer/);
});

test("scheduled proposals encode the controller delay and lifetime before the original payload", () => {
    const instruction = proposal();
    const wrapped = scheduleConfigChangeInstruction(signer.publicKey, instruction);
    const data = Buffer.from(wrapped.data);
    assert.deepEqual([...data.subarray(0, 2)], [2, 1]);
    assert.equal(data.readBigUInt64LE(2), 1n);
    assert.equal(data.readBigUInt64LE(10), 3600n);
    assert.deepEqual(data.subarray(18), Buffer.from(instruction.data));
    assert.throws(() => scheduleConfigChangeInstruction(signer.publicKey, instruction, 0n), /positive/);
    assert.throws(() => scheduleConfigChangeInstruction(signer.publicKey, instruction, 1n, 0n), /positive/);
    assert.throws(() => scheduleConfigChangeInstruction(signer.publicKey, instruction, 1n << 63n));
    assert.throws(() => scheduleConfigChangeInstruction(signer.publicKey, { ...instruction, data: Uint8Array.of(9, 8) }), /proposal/);
});

test("faucet instructions preserve amount encoding and the four declared accounts", () => {
    const asset = testAssetForSymbol("USDC");
    const destination = deriveAssociatedTokenAddress(signer.publicKey, asset.mint, asset.tokenProgramAddress).address;
    const instruction = mintTestAssetInstruction(asset.mint, destination, asset.tokenProgramAddress, 1_000_000n, 6);
    assert.equal(instruction.programAddress, FAUCET_PROGRAM_ADDRESS);
    assert.equal(Buffer.from(instruction.data).toString("hex"), "0040420f0000000000");
    assert.deepEqual(instruction.accounts.map((account) => account.address), [asset.mint, destination, faucetAuthority(), SPL_TOKEN_PROGRAM_ADDRESS]);
    assert.deepEqual(instruction.accounts.map((account) => account.isWritable), [true, true, false, false]);
    assert.ok(instruction.accounts.every((account) => !account.isSigner));
    assert.doesNotThrow(() => mintTestAssetInstruction(asset.mint, destination, asset.tokenProgramAddress, 10_000_000_000n, 6));
    for (const amount of [0n, -1n, 10_000_000_001n]) {
        assert.throws(() => mintTestAssetInstruction(asset.mint, destination, asset.tokenProgramAddress, amount, 6));
    }
    assert.throws(() => mintTestAssetInstruction(asset.mint, destination, asset.tokenProgramAddress, 1n, 16));
});

test("associated token account instructions use idempotent creation for both token programs", () => {
    for (const symbol of ["USDC", "USDG"]) {
        const asset = testAssetForSymbol(symbol);
        const instruction = createAssociatedTokenAccountInstruction(signer.publicKey, signer.publicKey, asset.mint, asset.tokenProgramAddress);
        assert.deepEqual(instruction.data, Uint8Array.of(1));
        assert.equal(instruction.accounts.length, 6);
        assert.equal(instruction.accounts[1]!.address, deriveAssociatedTokenAddress(signer.publicKey, asset.mint, asset.tokenProgramAddress).address);
        assert.equal(instruction.accounts[5]!.address, symbol === "USDC" ? SPL_TOKEN_PROGRAM_ADDRESS : TOKEN_2022_PROGRAM_ADDRESS);
    }
});
