import assert from "node:assert/strict";
import wireVectorsValue from "../../fixtures/wire-vectors.json" with { type: "json" };
import test from "node:test";

import {
    buildChanceryInstruction,
    bytesToHex,
    decodeChanceryAccount,
    decodeChanceryEventData,
    decodeChanceryEventsFromRpcTransaction,
    decodeChanceryInstructionData,
    deriveInstructionAccountPda,
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    encodeBase58,
    encodeChanceryAccount,
    encodeChanceryEventData,
    encodeChanceryInstructionData,
    lookupChanceryError,
    parseChanceryProgramError,
    type InstructionAccountInputs,
} from "../src/index.js";

interface RegisterAssetFixture {
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly account_inputs: InstructionAccountInputs;
    readonly asset_config_address: string;
    readonly asset_config_bump: number;
    readonly data_hex: string;
    readonly accounts: readonly {
        readonly name: string;
        readonly address: string;
        readonly is_signer: boolean;
        readonly is_writable: boolean;
    }[];
}

interface BinaryFixture {
    readonly values: Readonly<Record<string, unknown>>;
    readonly data_hex: string;
}

interface WireVectors {
    readonly register_asset: RegisterAssetFixture;
    readonly asset_pause_state: BinaryFixture;
    readonly asset_registered_event: BinaryFixture;
    readonly consume_inbound_message: {
        readonly arguments: Readonly<Record<string, unknown>>;
        readonly data_hex: string;
    };
}

function loadWireVectors(): WireVectors {
    const fixtureValue: unknown = wireVectorsValue;
    if (typeof fixtureValue !== "object" || fixtureValue === null) {
        throw new Error("Wire fixture root must be an object");
    }
    return fixtureValue as WireVectors;
}

const WIRE_VECTORS = loadWireVectors();

test("register_asset builds the exact instruction data and ordered account metas", () => {
    const fixture = WIRE_VECTORS.register_asset;
    const instruction = buildChanceryInstruction(
        "register_asset",
        fixture.arguments,
        fixture.account_inputs,
    );
    assert.equal(bytesToHex(instruction.data), fixture.data_hex);
    assert.deepEqual(instruction.accounts, fixture.accounts.map((account) => ({
        name: account.name,
        address: account.address,
        isSigner: account.is_signer,
        isWritable: account.is_writable,
    })));

    const derived = deriveInstructionAccountPda(
        "register_asset",
        "asset_config",
        fixture.arguments,
        fixture.account_inputs,
    );
    assert.equal(derived.address, fixture.asset_config_address);
    assert.equal(derived.bump, fixture.asset_config_bump);
});

test("the nested cross-chain signature vector has stable binary encoding", () => {
    const fixture = WIRE_VECTORS.consume_inbound_message;
    const encoded = encodeChanceryInstructionData("consume_inbound_message", fixture.arguments);
    assert.equal(bytesToHex(encoded), fixture.data_hex);
    const decoded = decodeChanceryInstructionData(encoded);
    assert.equal(decoded.name, "consume_inbound_message");
    assert.deepEqual(encodeChanceryInstructionData(decoded.name, decoded.arguments), encoded);
});

test("fixed account data matches the shared wire vector", () => {
    const fixture = WIRE_VECTORS.asset_pause_state;
    const encoded = encodeChanceryAccount("AssetPauseState", fixture.values);
    assert.equal(bytesToHex(encoded), fixture.data_hex);
    const decoded = decodeChanceryAccount(encoded);
    assert.equal(decoded.name, "AssetPauseState");
    assert.equal(decoded.values.asset_pause_bits, 3n);
    assert.equal(decoded.values.reason_code, 42);
});

test("event data and canonical RPC extraction match the shared wire vector", () => {
    const fixture = WIRE_VECTORS.asset_registered_event;
    const encoded = encodeChanceryEventData("AssetRegistered", fixture.values, true);
    assert.equal(bytesToHex(encoded), fixture.data_hex);
    const decoded = decodeChanceryEventData(encoded);
    assert.equal(decoded.name, "AssetRegistered");
    assert.equal(decoded.values.unix_timestamp, -12345n);

    const eventAuthority = CHANCERY_SCHEMA.known_pdas.event_authority?.address;
    assert.ok(eventAuthority !== undefined);
    const transactionResult = {
        transaction: {
            message: {
                accountKeys: [CHANCERY_PROGRAM_ADDRESS],
            },
        },
        meta: {
            err: null,
            loadedAddresses: { writable: [], readonly: [eventAuthority] },
            innerInstructions: [
                {
                    index: 3,
                    instructions: [
                        {
                            programIdIndex: 0,
                            accounts: [0],
                            data: encodeBase58(encoded),
                            stackHeight: 2,
                        },
                        {
                            programIdIndex: 0,
                            accounts: [1],
                            data: encodeBase58(encoded),
                            stackHeight: 2,
                        },
                    ],
                },
            ],
        },
    };
    const decodedEvents = decodeChanceryEventsFromRpcTransaction(transactionResult);
    assert.equal(decodedEvents.length, 1);
    assert.equal(decodedEvents[0]?.event.name, "AssetRegistered");
    assert.equal(decodedEvents[0]?.eventAuthority, eventAuthority);
    assert.equal(decodedEvents[0]?.parentInstructionIndex, 3);
    assert.equal(decodedEvents[0]?.innerInstructionIndex, 1);
    assert.equal(decodedEvents[0]?.stackHeight, 2);
});

test("program errors resolve from decimal and hexadecimal runtime messages", () => {
    assert.deepEqual(lookupChanceryError(256), {
        code: 256,
        name: "InstructionDataTooShort",
        message: "instruction data too short",
    });
    assert.equal(parseChanceryProgramError("custom program error: 0x100")?.code, 256);
    assert.equal(parseChanceryProgramError("custom program error: 256")?.code, 256);
    assert.equal(parseChanceryProgramError("unrelated"), null);
});
