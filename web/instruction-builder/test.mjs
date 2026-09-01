import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { encodeBase58 } from "./base58.mjs";
import { buildChanceryInstruction } from "./chancery.mjs";
import { INSTRUCTION_TEMPLATES } from "./templates.mjs";
import {
    buildSquadsProposal,
    deriveSquadsVaultAddress,
    SQUADS_MULTISIG_PROGRAM_ADDRESS,
} from "./squads.mjs";

globalThis.crypto ??= webcrypto;

function address(byte) {
    return encodeBase58(new Uint8Array(32).fill(byte));
}

function zeroValue(schema, type) {
    if (typeof type === "string") {
        if (type === "bool") return false;
        if (type === "pubkey") return schema.wire.zero_address;
        return "0";
    }
    if (type.kind === "option") return null;
    if (type.kind === "vector") return type.item === "u8" ? "0x" : [];
    if (type.kind === "array") {
        if (type.item === "u8") return "0x" + "00".repeat(type.length);
        return Array.from({ length: type.length }, () => zeroValue(schema, type.item));
    }
    if (type.kind === "defined") {
        const definition = schema.types[type.name];
        const value = {};
        for (const field of definition.fields) value[field.name] = zeroValue(schema, field.type);
        return value;
    }
    throw new Error("Unsupported schema type");
}

function zeroArguments(schema, instruction) {
    const values = {};
    for (const field of instruction.args) values[field.name] = zeroValue(schema, field.type);
    return values;
}

function zeroAccountInputs(schema, instruction) {
    const values = {};
    for (const account of instruction.accounts) {
        if (account.pda === undefined && account.default === undefined) {
            values[account.name] = schema.wire.zero_address;
        }
    }
    return values;
}

async function main() {
    const schema = JSON.parse(readFileSync(new URL("./chancery.schema.json", import.meta.url), "utf8"));
    const squadsIdl = JSON.parse(readFileSync(new URL("./squads_multisig_program.json", import.meta.url), "utf8"));
    assert.equal(squadsIdl.metadata.address, SQUADS_MULTISIG_PROGRAM_ADDRESS);
    assert.ok(squadsIdl.instructions.some((instruction) => instruction.name === "vaultTransactionCreate"));
    assert.ok(squadsIdl.instructions.some((instruction) => instruction.name === "proposalCreate"));
    assert.ok(squadsIdl.instructions.some((instruction) => instruction.name === "vaultTransactionExecute"));

    for (const template of INSTRUCTION_TEMPLATES) {
        const instruction = schema.instructions[template.instructionName];
        assert.ok(instruction, template.id);
        for (const argumentName of Object.keys(template.arguments)) {
            assert.ok(instruction.args.some((field) => field.name === argumentName), template.id + "." + argumentName);
        }
        for (const accountName of Object.keys(template.accounts)) {
            assert.ok(
                instruction.accounts.some((account) => account.name === accountName),
                template.id + "." + accountName,
            );
        }
    }

    const instructionEntries = Object.entries(schema.instructions);
    assert.equal(instructionEntries.length, 68);
    for (const [instructionName, instruction] of instructionEntries) {
        const built = await buildChanceryInstruction(
            schema,
            instructionName,
            zeroArguments(schema, instruction),
            zeroAccountInputs(schema, instruction),
            true,
        );
        assert.equal(built.accounts.length, instruction.accounts.length, instructionName);
        assert.deepEqual(
            [...built.data.slice(0, schema.wire.instruction_discriminator_bytes)],
            instruction.discriminator,
            instructionName,
        );
    }

    const multisigAddress = address(7);
    const creatorAddress = address(9);
    const vault = await deriveSquadsVaultAddress(multisigAddress, 0);
    const chanceryInstruction = await buildChanceryInstruction(
        schema,
        "set_global_pause",
        {
            pause_bits: "3",
            is_clear: false,
            reason_code: "17",
            expires_at_slot: "900",
        },
        { authority: vault.address },
        true,
    );
    assert.equal(chanceryInstruction.programAddress, schema.program.address);
    assert.deepEqual([...chanceryInstruction.data.slice(0, 2)], schema.instructions.set_global_pause.discriminator);

    const pauseState = chanceryInstruction.accounts.find((account) => account.name === "pause_state");
    assert.ok(pauseState);
    const lookupTable = {
        address: address(11),
        addresses: [pauseState.address],
    };
    const proposal = await buildSquadsProposal({
        multisigAddress,
        creatorAddress,
        transactionIndex: "4",
        vaultIndex: 0,
        instructions: [chanceryInstruction],
        memo: "Chancery browser builder test",
        addressLookupTables: [lookupTable],
    });
    assert.equal(proposal.addresses.vault.address, vault.address);
    assert.equal(proposal.instructions.creation.length, 2);
    assert.equal(proposal.instructions.activation, null);
    assert.equal(proposal.transactionMessage.addressTableLookups.length, 1);
    assert.equal(proposal.transactionMessage.addressTableLookups[0].accountKey, lookupTable.address);
    assert.deepEqual(proposal.transactionMessage.addressTableLookups[0].writableIndexes, [0]);
    assert.equal(proposal.instructions.execution.accounts[4].address, lookupTable.address);
    assert.ok(proposal.transactionMessageBytes.length > chanceryInstruction.data.length);

    process.stdout.write("instruction builder core tests passed\n");
}

main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(message + "\n");
    process.exitCode = 1;
});
