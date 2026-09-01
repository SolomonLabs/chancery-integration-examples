import assert from "node:assert/strict";
import test from "node:test";

import {
    buildChanceryInstruction,
    buildSquadsProposalBundle,
    bytesToHex,
    compileSquadsVaultTransactionMessage,
    decodeSquadsVaultTransactionMessage,
    deriveSquadsVaultAddress,
    encodeBase58,
    encodeSquadsVaultTransactionMessage,
    SQUADS_INSTRUCTION_DISCRIMINATORS,
    SQUADS_MULTISIG_PROGRAM_ADDRESS,
    type AddressLookupTable,
    type SolanaInstruction,
} from "../src/index.js";

function address(byteValue: number): string {
    return encodeBase58(new Uint8Array(32).fill(byteValue));
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
    if (bytes.length < prefix.length) {
        return false;
    }
    for (let index = 0; index < prefix.length; index++) {
        if (bytes[index] !== prefix[index]) {
            return false;
        }
    }
    return true;
}

test("Squads vault messages preserve Solana account ordering and round-trip", () => {
    const vaultAddress = address(1);
    const externalSigner = address(2);
    const writableAccount = address(3);
    const readonlyAccount = address(4);
    const programAddress = address(5);
    const instruction: SolanaInstruction = {
        programAddress,
        accounts: [
            { address: vaultAddress, isSigner: true, isWritable: true },
            { address: externalSigner, isSigner: true, isWritable: false },
            { address: writableAccount, isSigner: false, isWritable: true },
            { address: readonlyAccount, isSigner: false, isWritable: false },
        ],
        data: new Uint8Array([9, 8, 7]),
    };

    const message = compileSquadsVaultTransactionMessage([instruction], vaultAddress);
    assert.equal(message.numSigners, 2);
    assert.equal(message.numWritableSigners, 1);
    assert.equal(message.numWritableNonSigners, 1);
    assert.deepEqual(message.accountKeys, [
        vaultAddress,
        externalSigner,
        writableAccount,
        readonlyAccount,
        programAddress,
    ]);
    assert.deepEqual(message.instructions[0], {
        programIdIndex: 4,
        accountIndexes: [0, 1, 2, 3],
        data: new Uint8Array([9, 8, 7]),
    });

    const encoded = encodeSquadsVaultTransactionMessage(message);
    assert.deepEqual(decodeSquadsVaultTransactionMessage(encoded), message);
});

test("Squads vault messages carry address lookup table placements into execution accounts", () => {
    const vaultAddress = address(10);
    const writableAccount = address(11);
    const readonlyAccount = address(12);
    const programAddress = address(13);
    const lookupTable: AddressLookupTable = {
        address: address(14),
        addresses: [readonlyAccount, writableAccount],
    };
    const message = compileSquadsVaultTransactionMessage([{
        programAddress,
        accounts: [
            { address: writableAccount, isSigner: false, isWritable: true },
            { address: readonlyAccount, isSigner: false, isWritable: false },
        ],
        data: new Uint8Array([1]),
    }], vaultAddress, [lookupTable]);

    assert.deepEqual(message.addressTableLookups, [{
        accountKey: lookupTable.address,
        writableIndexes: [1],
        readonlyIndexes: [0],
    }]);
    assert.deepEqual(message.instructions[0]?.accountIndexes, [2, 3]);
});

test("Squads proposal bundle emits create, proposal, approval, and execution instructions", () => {
    const multisigAddress = address(20);
    const creatorAddress = address(21);
    const vaultAddress = deriveSquadsVaultAddress(multisigAddress, 0).address;
    const innerInstruction: SolanaInstruction = {
        programAddress: address(22),
        accounts: [
            { address: vaultAddress, isSigner: true, isWritable: false },
            { address: address(23), isSigner: false, isWritable: true },
        ],
        data: new Uint8Array([4, 5, 6]),
    };
    const bundle = buildSquadsProposalBundle({
        multisigAddress,
        creatorAddress,
        transactionIndex: 7n,
        instructions: [innerInstruction],
        memo: "Chancery proposal",
    });

    assert.equal(bundle.addresses.vault.address, vaultAddress);
    assert.equal(bundle.instructions.creation.length, 2);
    assert.equal(bundle.instructions.activation, null);
    assert.equal(bundle.instructions.creation[0].programAddress, SQUADS_MULTISIG_PROGRAM_ADDRESS);
    assert.ok(startsWithBytes(
        bundle.instructions.creation[0].data,
        SQUADS_INSTRUCTION_DISCRIMINATORS.vaultTransactionCreate,
    ));
    assert.ok(startsWithBytes(
        bundle.instructions.creation[1].data,
        SQUADS_INSTRUCTION_DISCRIMINATORS.proposalCreate,
    ));
    assert.ok(startsWithBytes(
        bundle.instructions.approval.data,
        SQUADS_INSTRUCTION_DISCRIMINATORS.proposalApprove,
    ));
    assert.ok(startsWithBytes(
        bundle.instructions.execution.data,
        SQUADS_INSTRUCTION_DISCRIMINATORS.vaultTransactionExecute,
    ));

    const executeVaultMeta = bundle.instructions.execution.accounts.find(
        (account) => account.address === vaultAddress,
    );
    assert.ok(executeVaultMeta !== undefined);
    assert.equal(executeVaultMeta.isSigner, false);
    assert.equal(executeVaultMeta.isWritable, true);
});

test("Chancery authority instructions can be owned by a Squads vault", () => {
    const multisigAddress = address(30);
    const creatorAddress = address(31);
    const vaultAddress = deriveSquadsVaultAddress(multisigAddress, 0).address;
    const chanceryInstruction = buildChanceryInstruction(
        "set_global_pause",
        {
            pause_bits: 1n,
            is_clear: false,
            reason_code: 42,
            expires_at_slot: 0n,
        },
        { authority: vaultAddress },
    );
    const bundle = buildSquadsProposalBundle({
        multisigAddress,
        creatorAddress,
        transactionIndex: 1n,
        instructions: [chanceryInstruction],
    });

    assert.equal(chanceryInstruction.accounts[3]?.address, vaultAddress);
    assert.equal(bytesToHex(chanceryInstruction.data).slice(0, 4), "0900");
    assert.equal(bundle.transactionMessage.accountKeys[0], vaultAddress);
});
