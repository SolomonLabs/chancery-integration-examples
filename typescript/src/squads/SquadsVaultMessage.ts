import { decodePublicKey, encodeBase58, normalizePublicKey } from "../Base58Codec.js";
import {
    compileUnversionedMessage,
    compileVersionZeroMessage,
    type AddressLookupTable,
    type SolanaInstruction,
    type SolanaInstructionAccountMeta,
} from "../SolanaTransaction.js";
import {
    concatenateBytes,
    encodeU8,
    encodeU16,
} from "./SquadsCodec.js";
import { deriveSquadsEphemeralSignerAddress } from "./SquadsPda.js";
import { SQUADS_MULTISIG_PROGRAM_ADDRESS } from "./SquadsProgram.js";

const ZERO_BLOCKHASH = new Uint8Array(32);

export interface SquadsCompiledInstruction {
    readonly programIdIndex: number;
    readonly accountIndexes: readonly number[];
    readonly data: Uint8Array;
}

export interface SquadsMessageAddressTableLookup {
    readonly accountKey: string;
    readonly writableIndexes: readonly number[];
    readonly readonlyIndexes: readonly number[];
}

export interface SquadsVaultTransactionMessage {
    readonly numSigners: number;
    readonly numWritableSigners: number;
    readonly numWritableNonSigners: number;
    readonly accountKeys: readonly string[];
    readonly instructions: readonly SquadsCompiledInstruction[];
    readonly addressTableLookups: readonly SquadsMessageAddressTableLookup[];
}

export interface ResolveSquadsExecuteAccountsRequest {
    readonly message: SquadsVaultTransactionMessage;
    readonly vaultAddress: string | Uint8Array;
    readonly transactionAddress: string | Uint8Array;
    readonly ephemeralSignerCount?: number;
    readonly addressLookupTables?: readonly AddressLookupTable[];
    readonly programAddress?: string | Uint8Array;
}

class MessageReader {
    readonly #bytes: Uint8Array;
    #offset = 0;

    constructor(bytes: Uint8Array) {
        this.#bytes = bytes;
    }

    get remaining(): number {
        return this.#bytes.length - this.#offset;
    }

    readBytes(byteLength: number, label: string): Uint8Array {
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > this.remaining) {
            throw new Error(label + " exceeds the available message bytes");
        }
        const bytes = this.#bytes.slice(this.#offset, this.#offset + byteLength);
        this.#offset += byteLength;
        return bytes;
    }

    readU8(label: string): number {
        return this.readBytes(1, label)[0] ?? 0;
    }

    readU16(label: string): number {
        const bytes = this.readBytes(2, label);
        return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
    }

    readShortVectorLength(label: string): number {
        let value = 0;
        let multiplier = 1;
        for (let index = 0; index < 8; index++) {
            const byteValue = this.readU8(label);
            value += (byteValue & 0x7f) * multiplier;
            if (!Number.isSafeInteger(value)) {
                throw new Error(label + " exceeds the safe integer range");
            }
            if ((byteValue & 0x80) === 0) {
                return value;
            }
            multiplier *= 128;
        }
        throw new Error(label + " has an invalid short-vector encoding");
    }
}

function assertU8(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(label + " must fit in an unsigned byte");
    }
}

function assertU16(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(label + " must fit in an unsigned 16-bit integer");
    }
}

function parseStandardCompiledMessage(bytes: Uint8Array): SquadsVaultTransactionMessage {
    const reader = new MessageReader(bytes);
    const firstByte = reader.readU8("message.header");
    const isVersionZero = (firstByte & 0x80) !== 0;
    let numSigners: number;
    if (isVersionZero) {
        const version = firstByte & 0x7f;
        if (version !== 0) {
            throw new Error("Only Solana message version zero is supported");
        }
        numSigners = reader.readU8("message.numSigners");
    } else {
        numSigners = firstByte;
    }
    const numReadonlySignedAccounts = reader.readU8("message.numReadonlySignedAccounts");
    const numReadonlyUnsignedAccounts = reader.readU8("message.numReadonlyUnsignedAccounts");
    const staticAccountCount = reader.readShortVectorLength("message.staticAccountCount");
    const accountKeys: string[] = [];
    for (let index = 0; index < staticAccountCount; index++) {
        accountKeys.push(encodeBase58(reader.readBytes(32, "message.accountKeys")));
    }
    reader.readBytes(32, "message.recentBlockhash");

    const instructionCount = reader.readShortVectorLength("message.instructionCount");
    const instructions: SquadsCompiledInstruction[] = [];
    for (let index = 0; index < instructionCount; index++) {
        const programIdIndex = reader.readU8("message.instructions.programIdIndex");
        const accountIndexCount = reader.readShortVectorLength("message.instructions.accountIndexCount");
        const accountIndexes = [...reader.readBytes(accountIndexCount, "message.instructions.accountIndexes")];
        const dataLength = reader.readShortVectorLength("message.instructions.dataLength");
        const data = reader.readBytes(dataLength, "message.instructions.data");
        instructions.push({ programIdIndex, accountIndexes, data });
    }

    const addressTableLookups: SquadsMessageAddressTableLookup[] = [];
    if (isVersionZero) {
        const lookupCount = reader.readShortVectorLength("message.addressTableLookupCount");
        for (let index = 0; index < lookupCount; index++) {
            const accountKey = encodeBase58(reader.readBytes(32, "message.addressTableLookups.accountKey"));
            const writableCount = reader.readShortVectorLength("message.addressTableLookups.writableCount");
            const writableIndexes = [...reader.readBytes(
                writableCount,
                "message.addressTableLookups.writableIndexes",
            )];
            const readonlyCount = reader.readShortVectorLength("message.addressTableLookups.readonlyCount");
            const readonlyIndexes = [...reader.readBytes(
                readonlyCount,
                "message.addressTableLookups.readonlyIndexes",
            )];
            addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
        }
    }
    if (reader.remaining !== 0) {
        throw new Error("Compiled Solana message has trailing bytes");
    }

    const numWritableSigners = numSigners - numReadonlySignedAccounts;
    const numWritableNonSigners = staticAccountCount - numSigners - numReadonlyUnsignedAccounts;
    const message = {
        numSigners,
        numWritableSigners,
        numWritableNonSigners,
        accountKeys,
        instructions,
        addressTableLookups,
    };
    validateSquadsVaultTransactionMessage(message);
    return message;
}

export function compileSquadsVaultTransactionMessage(
    instructions: readonly SolanaInstruction[],
    vaultAddress: string | Uint8Array,
    addressLookupTables: readonly AddressLookupTable[] = [],
): SquadsVaultTransactionMessage {
    const normalizedVaultAddress = normalizePublicKey(vaultAddress);
    const compiled = addressLookupTables.length === 0
        ? compileUnversionedMessage(instructions, normalizedVaultAddress, ZERO_BLOCKHASH)
        : compileVersionZeroMessage(instructions, normalizedVaultAddress, ZERO_BLOCKHASH, addressLookupTables);
    const message = parseStandardCompiledMessage(compiled.bytes);
    if (message.accountKeys[0] !== normalizedVaultAddress) {
        throw new Error("Squads vault must be the first static account key");
    }
    if (message.numSigners === 0 || message.numWritableSigners === 0) {
        throw new Error("Squads vault must be a writable signer in the inner message");
    }
    return message;
}

export function validateSquadsVaultTransactionMessage(message: SquadsVaultTransactionMessage): void {
    assertU8(message.numSigners, "message.numSigners");
    assertU8(message.numWritableSigners, "message.numWritableSigners");
    assertU8(message.numWritableNonSigners, "message.numWritableNonSigners");
    assertU8(message.accountKeys.length, "message.accountKeys.length");
    assertU8(message.instructions.length, "message.instructions.length");
    assertU8(message.addressTableLookups.length, "message.addressTableLookups.length");
    if (message.numWritableSigners > message.numSigners) {
        throw new Error("message.numWritableSigners exceeds message.numSigners");
    }
    if (message.numSigners > message.accountKeys.length) {
        throw new Error("message.numSigners exceeds the static account-key count");
    }
    if (message.numWritableNonSigners > message.accountKeys.length - message.numSigners) {
        throw new Error("message.numWritableNonSigners exceeds the static non-signer count");
    }

    for (let index = 0, length = message.accountKeys.length; index < length; index++) {
        const address = message.accountKeys[index];
        if (address === undefined) {
            throw new Error("message.accountKeys contains an absent address");
        }
        normalizePublicKey(address);
    }

    let loadedAccountCount = 0;
    for (let lookupIndex = 0, lookupLength = message.addressTableLookups.length; lookupIndex < lookupLength; lookupIndex++) {
        const lookup = message.addressTableLookups[lookupIndex];
        if (lookup === undefined) {
            throw new Error("message.addressTableLookups contains an absent lookup");
        }
        normalizePublicKey(lookup.accountKey);
        assertU8(lookup.writableIndexes.length, "message.addressTableLookups.writableIndexes.length");
        assertU8(lookup.readonlyIndexes.length, "message.addressTableLookups.readonlyIndexes.length");
        loadedAccountCount += lookup.writableIndexes.length + lookup.readonlyIndexes.length;
        for (let index = 0; index < lookup.writableIndexes.length; index++) {
            assertU8(lookup.writableIndexes[index] ?? -1, "message.addressTableLookups.writableIndexes");
        }
        for (let index = 0; index < lookup.readonlyIndexes.length; index++) {
            assertU8(lookup.readonlyIndexes[index] ?? -1, "message.addressTableLookups.readonlyIndexes");
        }
    }

    const totalAccountCount = message.accountKeys.length + loadedAccountCount;
    if (totalAccountCount > 256) {
        throw new Error("Squads vault transaction message exceeds 256 total account keys");
    }
    for (let instructionIndex = 0, instructionLength = message.instructions.length; instructionIndex < instructionLength; instructionIndex++) {
        const instruction = message.instructions[instructionIndex];
        if (instruction === undefined) {
            throw new Error("message.instructions contains an absent instruction");
        }
        assertU8(instruction.programIdIndex, "message.instructions.programIdIndex");
        if (instruction.programIdIndex >= message.accountKeys.length) {
            throw new Error("Instruction program ID must be a static account key");
        }
        assertU8(instruction.accountIndexes.length, "message.instructions.accountIndexes.length");
        assertU16(instruction.data.length, "message.instructions.data.length");
        for (let index = 0; index < instruction.accountIndexes.length; index++) {
            const accountIndex = instruction.accountIndexes[index] ?? -1;
            assertU8(accountIndex, "message.instructions.accountIndexes");
            if (accountIndex >= totalAccountCount) {
                throw new Error("Instruction account index exceeds the compiled account-key count");
            }
        }
    }
}

export function encodeSquadsVaultTransactionMessage(message: SquadsVaultTransactionMessage): Uint8Array {
    validateSquadsVaultTransactionMessage(message);
    const parts: Uint8Array[] = [
        encodeU8(message.numSigners, "message.numSigners"),
        encodeU8(message.numWritableSigners, "message.numWritableSigners"),
        encodeU8(message.numWritableNonSigners, "message.numWritableNonSigners"),
        encodeU8(message.accountKeys.length, "message.accountKeys.length"),
    ];
    for (let index = 0, length = message.accountKeys.length; index < length; index++) {
        const accountKey = message.accountKeys[index];
        if (accountKey !== undefined) {
            parts.push(decodePublicKey(accountKey));
        }
    }
    parts.push(encodeU8(message.instructions.length, "message.instructions.length"));
    for (let index = 0, length = message.instructions.length; index < length; index++) {
        const instruction = message.instructions[index];
        if (instruction === undefined) {
            continue;
        }
        parts.push(encodeU8(instruction.programIdIndex, "instruction.programIdIndex"));
        parts.push(encodeU8(instruction.accountIndexes.length, "instruction.accountIndexes.length"));
        parts.push(new Uint8Array(instruction.accountIndexes));
        parts.push(encodeU16(instruction.data.length, "instruction.data.length"));
        parts.push(instruction.data);
    }
    parts.push(encodeU8(message.addressTableLookups.length, "message.addressTableLookups.length"));
    for (let index = 0, length = message.addressTableLookups.length; index < length; index++) {
        const lookup = message.addressTableLookups[index];
        if (lookup === undefined) {
            continue;
        }
        parts.push(decodePublicKey(lookup.accountKey));
        parts.push(encodeU8(lookup.writableIndexes.length, "lookup.writableIndexes.length"));
        parts.push(new Uint8Array(lookup.writableIndexes));
        parts.push(encodeU8(lookup.readonlyIndexes.length, "lookup.readonlyIndexes.length"));
        parts.push(new Uint8Array(lookup.readonlyIndexes));
    }
    return concatenateBytes(parts);
}

export function decodeSquadsVaultTransactionMessage(bytes: Uint8Array): SquadsVaultTransactionMessage {
    const reader = new MessageReader(bytes);
    const numSigners = reader.readU8("message.numSigners");
    const numWritableSigners = reader.readU8("message.numWritableSigners");
    const numWritableNonSigners = reader.readU8("message.numWritableNonSigners");
    const accountKeyCount = reader.readU8("message.accountKeys.length");
    const accountKeys: string[] = [];
    for (let index = 0; index < accountKeyCount; index++) {
        accountKeys.push(encodeBase58(reader.readBytes(32, "message.accountKeys")));
    }
    const instructionCount = reader.readU8("message.instructions.length");
    const instructions: SquadsCompiledInstruction[] = [];
    for (let index = 0; index < instructionCount; index++) {
        const programIdIndex = reader.readU8("instruction.programIdIndex");
        const accountIndexCount = reader.readU8("instruction.accountIndexes.length");
        const accountIndexes = [...reader.readBytes(accountIndexCount, "instruction.accountIndexes")];
        const dataLength = reader.readU16("instruction.data.length");
        const data = reader.readBytes(dataLength, "instruction.data");
        instructions.push({ programIdIndex, accountIndexes, data });
    }
    const lookupCount = reader.readU8("message.addressTableLookups.length");
    const addressTableLookups: SquadsMessageAddressTableLookup[] = [];
    for (let index = 0; index < lookupCount; index++) {
        const accountKey = encodeBase58(reader.readBytes(32, "lookup.accountKey"));
        const writableCount = reader.readU8("lookup.writableIndexes.length");
        const writableIndexes = [...reader.readBytes(writableCount, "lookup.writableIndexes")];
        const readonlyCount = reader.readU8("lookup.readonlyIndexes.length");
        const readonlyIndexes = [...reader.readBytes(readonlyCount, "lookup.readonlyIndexes")];
        addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
    }
    if (reader.remaining !== 0) {
        throw new Error("Squads vault transaction message has trailing bytes");
    }
    const message = {
        numSigners,
        numWritableSigners,
        numWritableNonSigners,
        accountKeys,
        instructions,
        addressTableLookups,
    };
    validateSquadsVaultTransactionMessage(message);
    return message;
}

export function resolveSquadsVaultTransactionExecuteAccounts(
    request: ResolveSquadsExecuteAccountsRequest,
): readonly SolanaInstructionAccountMeta[] {
    validateSquadsVaultTransactionMessage(request.message);
    const vaultAddress = normalizePublicKey(request.vaultAddress);
    const transactionAddress = normalizePublicKey(request.transactionAddress);
    const ephemeralSignerCount = request.ephemeralSignerCount ?? 0;
    assertU8(ephemeralSignerCount, "ephemeralSignerCount");
    if (request.message.accountKeys[0] !== vaultAddress) {
        throw new Error("Squads execution message does not use the requested vault as its payer");
    }
    if (request.message.numSigners === 0 || request.message.numWritableSigners === 0) {
        throw new Error("Squads execution message does not mark the vault as a writable signer");
    }

    const programAddress = request.programAddress ?? SQUADS_MULTISIG_PROGRAM_ADDRESS;
    const programSignerAddresses = new Set<string>([vaultAddress]);
    for (let index = 0; index < ephemeralSignerCount; index++) {
        programSignerAddresses.add(deriveSquadsEphemeralSignerAddress(
            transactionAddress,
            index,
            programAddress,
        ).address);
    }

    const lookupTableByAddress = new Map<string, AddressLookupTable>();
    const addressLookupTables = request.addressLookupTables ?? [];
    for (let index = 0, length = addressLookupTables.length; index < length; index++) {
        const lookupTable = addressLookupTables[index];
        if (lookupTable === undefined) {
            continue;
        }
        const lookupTableAddress = normalizePublicKey(lookupTable.address);
        if (lookupTableByAddress.has(lookupTableAddress)) {
            throw new Error("Duplicate address lookup table: " + lookupTableAddress);
        }
        lookupTableByAddress.set(lookupTableAddress, lookupTable);
    }

    const accountMetas: SolanaInstructionAccountMeta[] = [];
    for (let index = 0, length = request.message.addressTableLookups.length; index < length; index++) {
        const lookup = request.message.addressTableLookups[index];
        if (lookup !== undefined) {
            accountMetas.push({
                address: normalizePublicKey(lookup.accountKey),
                isSigner: false,
                isWritable: false,
                name: "address_lookup_table_" + String(index),
            });
        }
    }

    for (let index = 0, length = request.message.accountKeys.length; index < length; index++) {
        const accountAddress = request.message.accountKeys[index];
        if (accountAddress === undefined) {
            continue;
        }
        const isSigner = index < request.message.numSigners && !programSignerAddresses.has(accountAddress);
        const isWritable = index < request.message.numWritableSigners || (
            index >= request.message.numSigners &&
            index < request.message.numSigners + request.message.numWritableNonSigners
        );
        accountMetas.push({
            address: accountAddress,
            isSigner,
            isWritable,
            name: "static_account_" + String(index),
        });
    }

    for (let lookupIndex = 0, lookupLength = request.message.addressTableLookups.length; lookupIndex < lookupLength; lookupIndex++) {
        const lookup = request.message.addressTableLookups[lookupIndex];
        if (lookup === undefined) {
            continue;
        }
        const lookupTableAddress = normalizePublicKey(lookup.accountKey);
        const lookupTable = lookupTableByAddress.get(lookupTableAddress);
        if (lookupTable === undefined) {
            throw new Error("Missing address lookup table contents for " + lookupTableAddress);
        }
        for (let index = 0, length = lookup.writableIndexes.length; index < length; index++) {
            const addressIndex = lookup.writableIndexes[index];
            const accountAddress = addressIndex === undefined ? undefined : lookupTable.addresses[addressIndex];
            if (accountAddress === undefined) {
                throw new Error("Writable address lookup index is outside table " + lookupTableAddress);
            }
            accountMetas.push({
                address: normalizePublicKey(accountAddress),
                isSigner: false,
                isWritable: true,
                name: "writable_lookup_" + String(lookupIndex) + "_" + String(index),
            });
        }
        for (let index = 0, length = lookup.readonlyIndexes.length; index < length; index++) {
            const addressIndex = lookup.readonlyIndexes[index];
            const accountAddress = addressIndex === undefined ? undefined : lookupTable.addresses[addressIndex];
            if (accountAddress === undefined) {
                throw new Error("Readonly address lookup index is outside table " + lookupTableAddress);
            }
            accountMetas.push({
                address: normalizePublicKey(accountAddress),
                isSigner: false,
                isWritable: false,
                name: "readonly_lookup_" + String(lookupIndex) + "_" + String(index),
            });
        }
    }
    return accountMetas;
}
