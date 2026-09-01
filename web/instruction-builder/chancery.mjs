import { decodePublicKey, normalizePublicKey } from "./base58.mjs";
import { findProgramAddress } from "./program-address.mjs";
import { concatenateBytes, encodeStruct, encodeType } from "./wire.mjs";

function instructionSchema(schema, instructionName) {
    const value = schema.instructions[instructionName];
    if (value === undefined) {
        throw new Error("Unknown Chancery instruction " + instructionName);
    }
    return value;
}

function defaultAccountAddress(schema, account) {
    const defaultValue = account.default;
    if (defaultValue === undefined) return undefined;
    if (defaultValue.kind === "program_address") return schema.program.address;
    if (defaultValue.kind === "system_program") return schema.wire.system_program;
    if (defaultValue.kind === "zero_address") return schema.wire.zero_address;
    if (defaultValue.kind === "known_pda") {
        const knownPda = schema.known_pdas[defaultValue.name];
        if (knownPda === undefined) {
            throw new Error("Unknown named Chancery PDA " + defaultValue.name);
        }
        return knownPda.address;
    }
    return undefined;
}

function argumentField(instruction, fieldName) {
    const field = instruction.args.find((candidate) => candidate.name === fieldName);
    if (field === undefined) {
        throw new Error("Unknown instruction argument " + fieldName);
    }
    return field;
}

function pdaSeedBytes(schema, instruction, seed, argumentsValue, accountAddresses) {
    if (seed.kind === "const") return new Uint8Array(seed.bytes);
    if (seed.kind === "argument") {
        const field = argumentField(instruction, seed.name);
        const value = argumentsValue[seed.name];
        if (value === undefined) {
            throw new Error("PDA seed argument is missing: " + seed.name);
        }
        const encoded = encodeType(schema, field.type, value, "arguments." + seed.name);
        if (encoded.length > 32) {
            throw new Error("PDA seed argument exceeds 32 bytes: " + seed.name);
        }
        return encoded;
    }
    const accountAddress = accountAddresses[seed.name];
    if (accountAddress === undefined) {
        throw new Error("PDA seed account is missing: " + seed.name);
    }
    return decodePublicKey(accountAddress);
}

export function encodeChanceryInstructionData(schema, instructionName, argumentsValue) {
    const instruction = instructionSchema(schema, instructionName);
    return concatenateBytes([
        new Uint8Array(instruction.discriminator),
        encodeStruct(schema, instruction.args, argumentsValue, "instructions." + instructionName + ".arguments"),
    ]);
}

export async function resolveChanceryInstructionAccounts(
    schema,
    instructionName,
    argumentsValue,
    accountInputs,
    verifyPdas,
) {
    const instruction = instructionSchema(schema, instructionName);
    const resolvedAddresses = {};
    for (const account of instruction.accounts) {
        const inputAddress = accountInputs[account.name];
        if (inputAddress !== undefined && inputAddress.length > 0) {
            resolvedAddresses[account.name] = normalizePublicKey(inputAddress);
            continue;
        }
        const defaultAddress = defaultAccountAddress(schema, account);
        if (defaultAddress !== undefined) {
            resolvedAddresses[account.name] = defaultAddress;
        }
    }

    for (let pass = 0; pass < instruction.accounts.length; pass++) {
        let changed = false;
        for (const account of instruction.accounts) {
            if (resolvedAddresses[account.name] !== undefined || account.pda === undefined) continue;
            try {
                const seeds = account.pda.seeds.map((seed) => pdaSeedBytes(
                    schema,
                    instruction,
                    seed,
                    argumentsValue,
                    resolvedAddresses,
                ));
                resolvedAddresses[account.name] = (
                    await findProgramAddress(seeds, schema.program.address)
                ).address;
                changed = true;
            } catch (error) {
                if (!(error instanceof Error) || !error.message.startsWith("PDA seed account is missing:")) {
                    throw error;
                }
            }
        }
        if (!changed) break;
    }

    const accountMetas = [];
    for (const account of instruction.accounts) {
        const address = resolvedAddresses[account.name];
        if (address === undefined) {
            throw new Error("Required instruction account is missing: " + instructionName + "." + account.name);
        }
        if (verifyPdas && account.pda !== undefined) {
            const seeds = account.pda.seeds.map((seed) => pdaSeedBytes(
                schema,
                instruction,
                seed,
                argumentsValue,
                resolvedAddresses,
            ));
            const expectedAddress = (await findProgramAddress(seeds, schema.program.address)).address;
            if (expectedAddress !== address) {
                throw new Error(
                    "PDA mismatch for " + instructionName + "." + account.name +
                    ": expected " + expectedAddress + ", received " + address,
                );
            }
        }
        accountMetas.push({
            name: account.name,
            address,
            isSigner: account.signer,
            isWritable: account.writable,
        });
    }
    return accountMetas;
}

export async function buildChanceryInstruction(
    schema,
    instructionName,
    argumentsValue,
    accountInputs,
    verifyPdas = true,
) {
    return {
        programAddress: schema.program.address,
        accounts: await resolveChanceryInstructionAccounts(
            schema,
            instructionName,
            argumentsValue,
            accountInputs,
            verifyPdas,
        ),
        data: encodeChanceryInstructionData(schema, instructionName, argumentsValue),
    };
}

export function defaultInstructionAccountValue(schema, account) {
    return defaultAccountAddress(schema, account) ?? "";
}
