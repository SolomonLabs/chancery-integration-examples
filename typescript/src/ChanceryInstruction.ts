import { decodePublicKey, normalizePublicKey } from "./Base58Codec.js";
import {
    BinaryReader,
    bytesFromValue,
    decodeStruct,
    encodeStruct,
    encodeType,
    fieldSchemaByName,
    type StructValues,
} from "./BinaryCodec.js";
import {
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    getInstructionSchema,
    SYSTEM_PROGRAM_ADDRESS,
    type InstructionAccountSchema,
    type InstructionSchema,
    type PdaSeedSchema,
    ZERO_ADDRESS,
} from "./ChancerySchema.js";
import { findProgramAddress, type ProgramAddressResult } from "./ProgramAddress.js";

export type PublicKeyInput = string | Uint8Array;
export type InstructionAccountInputs = Readonly<Record<string, PublicKeyInput | undefined>>;

export interface InstructionAccountMeta {
    readonly name: string;
    readonly address: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
}

export interface ChanceryInstruction {
    readonly programAddress: string;
    readonly accounts: readonly InstructionAccountMeta[];
    readonly data: Uint8Array;
}

export interface DecodedInstructionData {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
}

export interface DerivedInstructionPda extends ProgramAddressResult {
    readonly accountName: string;
}

function discriminatorKey(discriminator: ArrayLike<number>): string {
    let key = "";
    for (let index = 0, length = discriminator.length; index < length; index++) {
        if (index > 0) {
            key += ":";
        }
        key += String(discriminator[index] ?? 0);
    }
    return key;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
    let byteLength = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        byteLength += parts[index]?.length ?? 0;
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        const part = parts[index];
        if (part !== undefined) {
            bytes.set(part, offset);
            offset += part.length;
        }
    }
    return bytes;
}

function instructionByDiscriminator(data: Uint8Array): [string, InstructionSchema] {
    if (data.length < CHANCERY_SCHEMA.wire.instruction_discriminator_bytes) {
        throw new Error("Instruction data is shorter than the Chancery discriminator");
    }
    const actualKey = discriminatorKey(data.slice(0, CHANCERY_SCHEMA.wire.instruction_discriminator_bytes));
    const instructionNames = Object.keys(CHANCERY_SCHEMA.instructions);
    for (let index = 0, length = instructionNames.length; index < length; index++) {
        const instructionName = instructionNames[index];
        if (instructionName === undefined) {
            continue;
        }
        const instructionSchema = CHANCERY_SCHEMA.instructions[instructionName];
        if (instructionSchema !== undefined && discriminatorKey(instructionSchema.discriminator) === actualKey) {
            return [instructionName, instructionSchema];
        }
    }
    throw new Error(`Unknown Chancery instruction discriminator: ${actualKey}`);
}

function encodePdaArgumentSeed(
    instructionSchema: InstructionSchema,
    argumentValues: StructValues,
    seedName: string,
): Uint8Array {
    const fieldSchema = fieldSchemaByName(instructionSchema.args, seedName);
    const value = argumentValues[seedName];
    if (value === undefined) {
        throw new Error(`PDA seed argument is missing: ${seedName}`);
    }
    const encoded = encodeType(fieldSchema.type, value, `arguments.${seedName}`);
    if (encoded.length > 32) {
        throw new Error(`PDA seed argument ${seedName} encodes to more than 32 bytes`);
    }
    return encoded;
}

function pdaSeedBytes(
    instructionSchema: InstructionSchema,
    seedSchema: PdaSeedSchema,
    argumentValues: StructValues,
    accountAddresses: Readonly<Record<string, string>>,
): Uint8Array {
    if (seedSchema.kind === "const") {
        return new Uint8Array(seedSchema.bytes);
    }
    if (seedSchema.kind === "argument") {
        return encodePdaArgumentSeed(instructionSchema, argumentValues, seedSchema.name);
    }
    const accountAddress = accountAddresses[seedSchema.name];
    if (accountAddress === undefined) {
        throw new Error(`PDA seed account is missing: ${seedSchema.name}`);
    }
    return decodePublicKey(accountAddress);
}

function defaultAccountAddress(accountSchema: InstructionAccountSchema): string | undefined {
    const defaultSchema = accountSchema.default;
    if (defaultSchema === undefined) {
        return undefined;
    }
    if (defaultSchema.kind === "program_address") {
        return CHANCERY_PROGRAM_ADDRESS;
    }
    if (defaultSchema.kind === "system_program") {
        return SYSTEM_PROGRAM_ADDRESS;
    }
    if (defaultSchema.kind === "zero_address") {
        return ZERO_ADDRESS;
    }
    if (defaultSchema.kind === "known_pda") {
        if (defaultSchema.name === undefined) {
            throw new Error(`Known PDA default for ${accountSchema.name} has no name`);
        }
        const knownPda = CHANCERY_SCHEMA.known_pdas[defaultSchema.name];
        if (knownPda === undefined) {
            throw new Error(`Unknown named Chancery PDA: ${defaultSchema.name}`);
        }
        return knownPda.address;
    }
    return undefined;
}

export function encodeChanceryInstructionData(
    instructionName: string,
    argumentValues: StructValues = {},
): Uint8Array {
    const instructionSchema = getInstructionSchema(instructionName);
    return concatenate([
        new Uint8Array(instructionSchema.discriminator),
        encodeStruct({ fields: instructionSchema.args }, argumentValues, `instructions.${instructionName}.arguments`),
    ]);
}

export function decodeChanceryInstructionData(data: Uint8Array): DecodedInstructionData {
    const [instructionName, instructionSchema] = instructionByDiscriminator(data);
    const reader = new BinaryReader(data, CHANCERY_SCHEMA.wire.instruction_discriminator_bytes);
    const argumentValues = decodeStruct(
        { fields: instructionSchema.args },
        reader,
        `instructions.${instructionName}.arguments`,
    );
    if (reader.remaining !== 0) {
        throw new Error(`Instruction ${instructionName} has ${reader.remaining} trailing bytes`);
    }
    return {
        name: instructionName,
        arguments: argumentValues,
    };
}

export function deriveInstructionAccountPda(
    instructionName: string,
    accountName: string,
    argumentValues: StructValues,
    accountInputs: InstructionAccountInputs,
): DerivedInstructionPda {
    const instructionSchema = getInstructionSchema(instructionName);
    let targetAccountSchema: InstructionAccountSchema | undefined;
    for (let index = 0, length = instructionSchema.accounts.length; index < length; index++) {
        const accountSchema = instructionSchema.accounts[index];
        if (accountSchema?.name === accountName) {
            targetAccountSchema = accountSchema;
            break;
        }
    }
    if (targetAccountSchema?.pda === undefined) {
        throw new Error(`${instructionName}.${accountName} has no PDA schema`);
    }

    const accountAddresses: Record<string, string> = {};
    const inputNames = Object.keys(accountInputs);
    for (let index = 0, length = inputNames.length; index < length; index++) {
        const inputName = inputNames[index];
        if (inputName === undefined) {
            continue;
        }
        const inputAddress = accountInputs[inputName];
        if (inputAddress !== undefined) {
            accountAddresses[inputName] = normalizePublicKey(inputAddress);
        }
    }
    for (let index = 0, length = instructionSchema.accounts.length; index < length; index++) {
        const accountSchema = instructionSchema.accounts[index];
        if (accountSchema === undefined || accountAddresses[accountSchema.name] !== undefined) {
            continue;
        }
        const accountDefault = defaultAccountAddress(accountSchema);
        if (accountDefault !== undefined) {
            accountAddresses[accountSchema.name] = accountDefault;
        }
    }

    const seedBytes: Uint8Array[] = [];
    for (let index = 0, length = targetAccountSchema.pda.seeds.length; index < length; index++) {
        const seedSchema = targetAccountSchema.pda.seeds[index];
        if (seedSchema !== undefined) {
            seedBytes.push(pdaSeedBytes(instructionSchema, seedSchema, argumentValues, accountAddresses));
        }
    }
    const result = findProgramAddress(seedBytes, CHANCERY_PROGRAM_ADDRESS);
    return {
        accountName,
        address: result.address,
        bump: result.bump,
    };
}

export function resolveChanceryInstructionAccounts(
    instructionName: string,
    argumentValues: StructValues,
    accountInputs: InstructionAccountInputs,
    verifyPdas = true,
): readonly InstructionAccountMeta[] {
    const instructionSchema = getInstructionSchema(instructionName);
    const resolvedAddresses: Record<string, string> = {};

    for (let index = 0, length = instructionSchema.accounts.length; index < length; index++) {
        const accountSchema = instructionSchema.accounts[index];
        if (accountSchema === undefined) {
            continue;
        }
        const inputAddress = accountInputs[accountSchema.name];
        if (inputAddress !== undefined) {
            resolvedAddresses[accountSchema.name] = normalizePublicKey(inputAddress);
            continue;
        }
        const accountDefault = defaultAccountAddress(accountSchema);
        if (accountDefault !== undefined) {
            resolvedAddresses[accountSchema.name] = accountDefault;
        }
    }

    for (let pass = 0, passLimit = instructionSchema.accounts.length; pass < passLimit; pass++) {
        let changed = false;
        for (let index = 0, length = instructionSchema.accounts.length; index < length; index++) {
            const accountSchema = instructionSchema.accounts[index];
            if (
                accountSchema === undefined ||
                resolvedAddresses[accountSchema.name] !== undefined ||
                accountSchema.pda === undefined
            ) {
                continue;
            }
            try {
                const seedBytes: Uint8Array[] = [];
                for (
                    let seedIndex = 0, seedLength = accountSchema.pda.seeds.length;
                    seedIndex < seedLength;
                    seedIndex++
                ) {
                    const seedSchema = accountSchema.pda.seeds[seedIndex];
                    if (seedSchema !== undefined) {
                        seedBytes.push(pdaSeedBytes(instructionSchema, seedSchema, argumentValues, resolvedAddresses));
                    }
                }
                resolvedAddresses[accountSchema.name] = findProgramAddress(
                    seedBytes,
                    CHANCERY_PROGRAM_ADDRESS,
                ).address;
                changed = true;
            } catch (error: unknown) {
                if (!(error instanceof Error) || !error.message.startsWith("PDA seed account is missing:")) {
                    throw error;
                }
            }
        }
        if (!changed) {
            break;
        }
    }

    const accountMetas: InstructionAccountMeta[] = [];
    for (let index = 0, length = instructionSchema.accounts.length; index < length; index++) {
        const accountSchema = instructionSchema.accounts[index];
        if (accountSchema === undefined) {
            continue;
        }
        const resolvedAddress = resolvedAddresses[accountSchema.name];
        if (resolvedAddress === undefined) {
            throw new Error(`Required instruction account is missing: ${instructionName}.${accountSchema.name}`);
        }
        if (verifyPdas && accountSchema.pda !== undefined) {
            const seedBytes: Uint8Array[] = [];
            for (let seedIndex = 0, seedLength = accountSchema.pda.seeds.length; seedIndex < seedLength; seedIndex++) {
                const seedSchema = accountSchema.pda.seeds[seedIndex];
                if (seedSchema !== undefined) {
                    seedBytes.push(pdaSeedBytes(instructionSchema, seedSchema, argumentValues, resolvedAddresses));
                }
            }
            const expectedAddress = findProgramAddress(seedBytes, CHANCERY_PROGRAM_ADDRESS).address;
            if (resolvedAddress !== expectedAddress) {
                throw new Error(
                    `PDA mismatch for ${instructionName}.${accountSchema.name}: ` +
                    `expected ${expectedAddress}, received ${resolvedAddress}`,
                );
            }
        }
        accountMetas.push({
            name: accountSchema.name,
            address: resolvedAddress,
            isSigner: accountSchema.signer,
            isWritable: accountSchema.writable,
        });
    }
    return accountMetas;
}

export function buildChanceryInstruction(
    instructionName: string,
    argumentValues: StructValues,
    accountInputs: InstructionAccountInputs,
    verifyPdas = true,
): ChanceryInstruction {
    return {
        programAddress: CHANCERY_PROGRAM_ADDRESS,
        accounts: resolveChanceryInstructionAccounts(
            instructionName,
            argumentValues,
            accountInputs,
            verifyPdas,
        ),
        data: encodeChanceryInstructionData(instructionName, argumentValues),
    };
}

export function pdaSeedFromBytes(value: unknown, label = "seed"): Uint8Array {
    const bytes = bytesFromValue(value, label);
    if (bytes.length > 32) {
        throw new Error(`${label} exceeds 32 bytes`);
    }
    return bytes;
}
