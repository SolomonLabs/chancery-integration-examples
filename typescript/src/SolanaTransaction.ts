import {
    createPrivateKey,
    createPublicKey,
    sign as signBytes,
    type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

import { decodePublicKey, encodeBase58, normalizePublicKey } from "./Base58Codec.js";

const ED25519_PKCS8_PREFIX = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const MAX_TRANSACTION_BYTES = 1232;

export interface SolanaInstructionAccountMeta {
    readonly address: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
    readonly name?: string;
}

export interface SolanaInstruction {
    readonly programAddress: string;
    readonly accounts: readonly SolanaInstructionAccountMeta[];
    readonly data: Uint8Array;
}

export interface SolanaKeypair {
    readonly publicKey: string;
    readonly secretKeySeed: Uint8Array;
}

export interface AddressLookupTable {
    readonly address: string;
    readonly addresses: readonly string[];
}

export interface CompiledSolanaMessage {
    readonly version: "unversioned" | 0;
    readonly bytes: Uint8Array;
    readonly accountKeys: readonly string[];
    readonly signerAddresses: readonly string[];
    readonly numberOfRequiredSignatures: number;
    readonly numberOfReadonlySignedAccounts: number;
    readonly numberOfReadonlyUnsignedAccounts: number;
    readonly addressTableLookups: readonly CompiledAddressTableLookup[];
}

export interface CompiledAddressTableLookup {
    readonly tableAddress: string;
    readonly writableIndexes: readonly number[];
    readonly readonlyIndexes: readonly number[];
}

export interface SignedSolanaTransaction {
    readonly bytes: Uint8Array;
    readonly message: CompiledSolanaMessage;
    readonly signatures: Readonly<Record<string, Uint8Array>>;
    readonly primarySignature: string;
}

interface AggregatedAccountMeta {
    readonly address: string;
    readonly firstSeenIndex: number;
    isSigner: boolean;
    isWritable: boolean;
    isProgram: boolean;
}

interface LookupPlacement {
    readonly tableIndex: number;
    readonly addressIndex: number;
    readonly isWritable: boolean;
}

interface LookupCompilation {
    readonly staticMetas: readonly AggregatedAccountMeta[];
    readonly writableLoadedAddresses: readonly string[];
    readonly readonlyLoadedAddresses: readonly string[];
    readonly placements: ReadonlyMap<string, LookupPlacement>;
    readonly lookups: readonly CompiledAddressTableLookup[];
}

export function encodeShortVectorLength(value: number): Uint8Array {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Short-vector length must be a safe unsigned integer");
    }
    const bytes: number[] = [];
    let remaining = value;
    do {
        let byteValue = remaining & 0x7f;
        remaining = Math.floor(remaining / 128);
        if (remaining > 0) {
            byteValue |= 0x80;
        }
        bytes.push(byteValue);
    } while (remaining > 0);
    return new Uint8Array(bytes);
}

export function compileUnversionedMessage(
    instructions: readonly SolanaInstruction[],
    feePayer: string | Uint8Array,
    recentBlockhash: string | Uint8Array,
): CompiledSolanaMessage {
    const aggregated = aggregateAccountMetas(instructions, feePayer);
    const ordered = orderStaticAccountMetas(aggregated);
    return compileMessageBytes(
        "unversioned",
        instructions,
        ordered,
        [],
        [],
        new Map<string, LookupPlacement>(),
        [],
        recentBlockhash,
    );
}

export function compileVersionZeroMessage(
    instructions: readonly SolanaInstruction[],
    feePayer: string | Uint8Array,
    recentBlockhash: string | Uint8Array,
    lookupTables: readonly AddressLookupTable[],
): CompiledSolanaMessage {
    if (lookupTables.length === 0) {
        throw new Error("Version-zero compilation requires at least one address lookup table");
    }
    const aggregated = aggregateAccountMetas(instructions, feePayer);
    const lookupCompilation = placeAccountsInLookupTables(aggregated, lookupTables);
    const orderedStatic = orderStaticAccountMetas(lookupCompilation.staticMetas);
    return compileMessageBytes(
        0,
        instructions,
        orderedStatic,
        lookupCompilation.writableLoadedAddresses,
        lookupCompilation.readonlyLoadedAddresses,
        lookupCompilation.placements,
        lookupCompilation.lookups,
        recentBlockhash,
    );
}

export function createUnsignedTransaction(message: CompiledSolanaMessage): Uint8Array {
    const signatures: Uint8Array[] = [];
    for (let index = 0; index < message.numberOfRequiredSignatures; index++) {
        signatures.push(new Uint8Array(64));
    }
    return serializeTransaction(message.bytes, signatures);
}

export function signSolanaTransaction(
    message: CompiledSolanaMessage,
    keypairs: readonly SolanaKeypair[],
): SignedSolanaTransaction {
    const keypairByPublicKey = new Map<string, SolanaKeypair>();
    for (let index = 0, length = keypairs.length; index < length; index++) {
        const keypair = keypairs[index];
        if (keypair !== undefined) {
            keypairByPublicKey.set(normalizePublicKey(keypair.publicKey), keypair);
        }
    }

    const signatureBytes: Uint8Array[] = [];
    const signatureRecord: Record<string, Uint8Array> = {};
    for (let index = 0, length = message.signerAddresses.length; index < length; index++) {
        const signerAddress = message.signerAddresses[index];
        if (signerAddress === undefined) {
            continue;
        }
        const keypair = keypairByPublicKey.get(signerAddress);
        if (keypair === undefined) {
            throw new Error(`Missing keypair for required signer ${signerAddress}`);
        }
        const signature = signMessageWithKeypair(message.bytes, keypair);
        signatureBytes.push(signature);
        signatureRecord[signerAddress] = signature;
    }
    const bytes = serializeTransaction(message.bytes, signatureBytes);
    if (bytes.length > MAX_TRANSACTION_BYTES) {
        throw new Error(
            `Serialized transaction is ${bytes.length} bytes; Solana packet limit is ${MAX_TRANSACTION_BYTES}. ` +
            "Compile a version-zero message with an address lookup table.",
        );
    }
    const firstSignature = signatureBytes[0];
    if (firstSignature === undefined) {
        throw new Error("Transaction has no required signatures");
    }
    return {
        bytes,
        message,
        signatures: signatureRecord,
        primarySignature: encodeBase58(firstSignature),
    };
}

export function loadSolanaKeypairFile(filePath: string): SolanaKeypair {
    const text = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
        throw new Error(`Keypair file ${filePath} must contain a JSON byte array`);
    }
    const keyBytes = new Uint8Array(parsed.length);
    for (let index = 0, length = parsed.length; index < length; index++) {
        const value = parsed[index];
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
            throw new Error(`Keypair file ${filePath} contains an invalid byte at index ${index}`);
        }
        keyBytes[index] = value;
    }
    return keypairFromSecretKeyBytes(keyBytes);
}

export function keypairFromSecretKeyBytes(secretKeyBytes: Uint8Array): SolanaKeypair {
    if (secretKeyBytes.length !== 32 && secretKeyBytes.length !== 64) {
        throw new Error("Solana secret key must contain 32 seed bytes or 64 keypair bytes");
    }
    const seed = secretKeyBytes.slice(0, 32);
    const privateKey = privateKeyFromSeed(seed);
    const publicKeyBytes = publicKeyBytesFromPrivateKey(privateKey);
    if (secretKeyBytes.length === 64) {
        for (let index = 0; index < 32; index++) {
            if (secretKeyBytes[32 + index] !== publicKeyBytes[index]) {
                throw new Error("Solana keypair public-key suffix does not match its secret seed");
            }
        }
    }
    return {
        publicKey: encodeBase58(publicKeyBytes),
        secretKeySeed: seed,
    };
}

export function parseAddressLookupTableAccount(
    tableAddress: string | Uint8Array,
    accountData: Uint8Array,
): AddressLookupTable {
    const metadataByteLength = 56;
    if (accountData.length < metadataByteLength || (accountData.length - metadataByteLength) % 32 !== 0) {
        throw new Error("Address lookup table account has an invalid byte length");
    }
    const stateDiscriminator = readLittleEndianUnsigned(accountData.slice(0, 4));
    if (stateDiscriminator !== 1n) {
        throw new Error("Address lookup table account is not initialized");
    }
    const addresses: string[] = [];
    for (let offset = metadataByteLength; offset < accountData.length; offset += 32) {
        addresses.push(encodeBase58(accountData.slice(offset, offset + 32)));
    }
    return {
        address: normalizePublicKey(tableAddress),
        addresses,
    };
}

function aggregateAccountMetas(
    instructions: readonly SolanaInstruction[],
    feePayerInput: string | Uint8Array,
): readonly AggregatedAccountMeta[] {
    const feePayer = normalizePublicKey(feePayerInput);
    const metas = new Map<string, AggregatedAccountMeta>();
    let firstSeenIndex = 0;

    metas.set(feePayer, {
        address: feePayer,
        firstSeenIndex: firstSeenIndex++,
        isSigner: true,
        isWritable: true,
        isProgram: false,
    });

    for (let instructionIndex = 0, instructionLength = instructions.length; instructionIndex < instructionLength; instructionIndex++) {
        const instruction = instructions[instructionIndex];
        if (instruction === undefined) {
            continue;
        }
        for (let accountIndex = 0, accountLength = instruction.accounts.length; accountIndex < accountLength; accountIndex++) {
            const account = instruction.accounts[accountIndex];
            if (account === undefined) {
                continue;
            }
            mergeAccountMeta(
                metas,
                normalizePublicKey(account.address),
                account.isSigner,
                account.isWritable,
                false,
                firstSeenIndex++,
            );
        }
        mergeAccountMeta(
            metas,
            normalizePublicKey(instruction.programAddress),
            false,
            false,
            true,
            firstSeenIndex++,
        );
    }
    return [...metas.values()];
}

function mergeAccountMeta(
    metas: Map<string, AggregatedAccountMeta>,
    address: string,
    isSigner: boolean,
    isWritable: boolean,
    isProgram: boolean,
    firstSeenIndex: number,
): void {
    const existing = metas.get(address);
    if (existing === undefined) {
        metas.set(address, {
            address,
            firstSeenIndex,
            isSigner,
            isWritable,
            isProgram,
        });
        return;
    }
    existing.isSigner = existing.isSigner || isSigner;
    existing.isWritable = existing.isWritable || isWritable;
    existing.isProgram = existing.isProgram || isProgram;
}

function orderStaticAccountMetas(metas: readonly AggregatedAccountMeta[]): readonly AggregatedAccountMeta[] {
    const ordered = [...metas];
    ordered.sort((left, right) => {
        const leftGroup = accountOrderGroup(left);
        const rightGroup = accountOrderGroup(right);
        if (leftGroup !== rightGroup) {
            return leftGroup - rightGroup;
        }
        return left.firstSeenIndex - right.firstSeenIndex;
    });
    return ordered;
}

function accountOrderGroup(meta: AggregatedAccountMeta): number {
    if (meta.isSigner && meta.isWritable) {
        return 0;
    }
    if (meta.isSigner) {
        return 1;
    }
    if (meta.isWritable) {
        return 2;
    }
    return 3;
}

function placeAccountsInLookupTables(
    metas: readonly AggregatedAccountMeta[],
    lookupTables: readonly AddressLookupTable[],
): LookupCompilation {
    const tableAddressIndexes: Map<string, number>[] = [];
    for (let tableIndex = 0, tableLength = lookupTables.length; tableIndex < tableLength; tableIndex++) {
        const table = lookupTables[tableIndex];
        if (table === undefined) {
            continue;
        }
        if (table.addresses.length > 256) {
            throw new Error(`Address lookup table ${table.address} has more than 256 addresses`);
        }
        const addressIndexes = new Map<string, number>();
        for (let addressIndex = 0, addressLength = table.addresses.length; addressIndex < addressLength; addressIndex++) {
            const address = table.addresses[addressIndex];
            if (address !== undefined && !addressIndexes.has(address)) {
                addressIndexes.set(normalizePublicKey(address), addressIndex);
            }
        }
        tableAddressIndexes.push(addressIndexes);
    }

    const staticMetas: AggregatedAccountMeta[] = [];
    const placements = new Map<string, LookupPlacement>();
    const writableIndexesByTable: number[][] = [];
    const readonlyIndexesByTable: number[][] = [];
    for (let tableIndex = 0, tableLength = lookupTables.length; tableIndex < tableLength; tableIndex++) {
        writableIndexesByTable.push([]);
        readonlyIndexesByTable.push([]);
    }

    for (let metaIndex = 0, metaLength = metas.length; metaIndex < metaLength; metaIndex++) {
        const meta = metas[metaIndex];
        if (meta === undefined) {
            continue;
        }
        if (meta.isSigner || meta.isProgram || metaIndex === 0) {
            staticMetas.push(meta);
            continue;
        }
        let placement: LookupPlacement | undefined;
        for (let tableIndex = 0, tableLength = tableAddressIndexes.length; tableIndex < tableLength; tableIndex++) {
            const addressIndex = tableAddressIndexes[tableIndex]?.get(meta.address);
            if (addressIndex !== undefined) {
                placement = {
                    tableIndex,
                    addressIndex,
                    isWritable: meta.isWritable,
                };
                break;
            }
        }
        if (placement === undefined) {
            staticMetas.push(meta);
            continue;
        }
        placements.set(meta.address, placement);
        const destination = placement.isWritable
            ? writableIndexesByTable[placement.tableIndex]
            : readonlyIndexesByTable[placement.tableIndex];
        if (destination === undefined) {
            throw new Error("Address lookup table placement index is invalid");
        }
        destination.push(placement.addressIndex);
    }

    const writableLoadedAddresses: string[] = [];
    const readonlyLoadedAddresses: string[] = [];
    const lookups: CompiledAddressTableLookup[] = [];
    for (let tableIndex = 0, tableLength = lookupTables.length; tableIndex < tableLength; tableIndex++) {
        const table = lookupTables[tableIndex];
        const writableIndexes = writableIndexesByTable[tableIndex] ?? [];
        const readonlyIndexes = readonlyIndexesByTable[tableIndex] ?? [];
        if (table === undefined || (writableIndexes.length === 0 && readonlyIndexes.length === 0)) {
            continue;
        }
        for (let index = 0, length = writableIndexes.length; index < length; index++) {
            const addressIndex = writableIndexes[index];
            const address = addressIndex === undefined ? undefined : table.addresses[addressIndex];
            if (address === undefined) {
                throw new Error(`Lookup table ${table.address} writable index is invalid`);
            }
            writableLoadedAddresses.push(normalizePublicKey(address));
        }
        for (let index = 0, length = readonlyIndexes.length; index < length; index++) {
            const addressIndex = readonlyIndexes[index];
            const address = addressIndex === undefined ? undefined : table.addresses[addressIndex];
            if (address === undefined) {
                throw new Error(`Lookup table ${table.address} readonly index is invalid`);
            }
            readonlyLoadedAddresses.push(normalizePublicKey(address));
        }
        lookups.push({
            tableAddress: normalizePublicKey(table.address),
            writableIndexes,
            readonlyIndexes,
        });
    }

    return {
        staticMetas,
        writableLoadedAddresses,
        readonlyLoadedAddresses,
        placements,
        lookups,
    };
}

function compileMessageBytes(
    version: "unversioned" | 0,
    instructions: readonly SolanaInstruction[],
    staticMetas: readonly AggregatedAccountMeta[],
    writableLoadedAddresses: readonly string[],
    readonlyLoadedAddresses: readonly string[],
    placements: ReadonlyMap<string, LookupPlacement>,
    lookups: readonly CompiledAddressTableLookup[],
    recentBlockhash: string | Uint8Array,
): CompiledSolanaMessage {
    if (staticMetas.length > 256) {
        throw new Error("Compiled message has more than 256 static account keys");
    }
    const requiredSignatures = countMatching(staticMetas, (meta) => meta.isSigner);
    const readonlySigned = countMatching(staticMetas, (meta) => meta.isSigner && !meta.isWritable);
    const readonlyUnsigned = countMatching(staticMetas, (meta) => !meta.isSigner && !meta.isWritable);
    if (requiredSignatures > 255 || readonlySigned > 255 || readonlyUnsigned > 255) {
        throw new Error("Compiled message header count exceeds one byte");
    }

    const staticAccountKeys: string[] = [];
    const accountIndexByAddress = new Map<string, number>();
    for (let index = 0, length = staticMetas.length; index < length; index++) {
        const meta = staticMetas[index];
        if (meta !== undefined) {
            staticAccountKeys.push(meta.address);
            accountIndexByAddress.set(meta.address, index);
        }
    }

    let nextLoadedIndex = staticAccountKeys.length;
    for (let index = 0, length = writableLoadedAddresses.length; index < length; index++) {
        const address = writableLoadedAddresses[index];
        if (address !== undefined) {
            accountIndexByAddress.set(address, nextLoadedIndex++);
        }
    }
    for (let index = 0, length = readonlyLoadedAddresses.length; index < length; index++) {
        const address = readonlyLoadedAddresses[index];
        if (address !== undefined) {
            accountIndexByAddress.set(address, nextLoadedIndex++);
        }
    }
    if (nextLoadedIndex > 256) {
        throw new Error("Compiled message has more than 256 total account keys");
    }

    const messageParts: Uint8Array[] = [];
    if (version === 0) {
        messageParts.push(new Uint8Array([0x80]));
    }
    messageParts.push(new Uint8Array([
        requiredSignatures,
        readonlySigned,
        readonlyUnsigned,
    ]));
    messageParts.push(encodeShortVectorLength(staticAccountKeys.length));
    for (let index = 0, length = staticAccountKeys.length; index < length; index++) {
        const address = staticAccountKeys[index];
        if (address !== undefined) {
            messageParts.push(decodePublicKey(address));
        }
    }
    messageParts.push(decodePublicKey(recentBlockhash));
    messageParts.push(encodeShortVectorLength(instructions.length));

    for (let instructionIndex = 0, instructionLength = instructions.length; instructionIndex < instructionLength; instructionIndex++) {
        const instruction = instructions[instructionIndex];
        if (instruction === undefined) {
            continue;
        }
        const programAddress = normalizePublicKey(instruction.programAddress);
        const programIndex = accountIndexByAddress.get(programAddress);
        if (programIndex === undefined || programIndex > 255) {
            throw new Error(`Instruction program address is absent from the static account list: ${programAddress}`);
        }
        messageParts.push(new Uint8Array([programIndex]));
        messageParts.push(encodeShortVectorLength(instruction.accounts.length));
        const accountIndexes = new Uint8Array(instruction.accounts.length);
        for (let accountIndex = 0, accountLength = instruction.accounts.length; accountIndex < accountLength; accountIndex++) {
            const account = instruction.accounts[accountIndex];
            if (account === undefined) {
                continue;
            }
            const address = normalizePublicKey(account.address);
            const compiledIndex = accountIndexByAddress.get(address);
            if (compiledIndex === undefined || compiledIndex > 255) {
                const lookupPlacement = placements.get(address);
                const placementText = lookupPlacement === undefined ? "" : ` via table ${lookupPlacement.tableIndex}`;
                throw new Error(`Instruction account is absent from compiled keys: ${address}${placementText}`);
            }
            accountIndexes[accountIndex] = compiledIndex;
        }
        messageParts.push(accountIndexes);
        messageParts.push(encodeShortVectorLength(instruction.data.length));
        messageParts.push(instruction.data);
    }

    if (version === 0) {
        messageParts.push(encodeShortVectorLength(lookups.length));
        for (let lookupIndex = 0, lookupLength = lookups.length; lookupIndex < lookupLength; lookupIndex++) {
            const lookup = lookups[lookupIndex];
            if (lookup === undefined) {
                continue;
            }
            messageParts.push(decodePublicKey(lookup.tableAddress));
            messageParts.push(encodeShortVectorLength(lookup.writableIndexes.length));
            messageParts.push(new Uint8Array(lookup.writableIndexes));
            messageParts.push(encodeShortVectorLength(lookup.readonlyIndexes.length));
            messageParts.push(new Uint8Array(lookup.readonlyIndexes));
        }
    }

    const bytes = concatenate(messageParts);
    const signerAddresses = staticMetas
        .slice(0, requiredSignatures)
        .map((meta) => meta.address);
    return {
        version,
        bytes,
        accountKeys: [...staticAccountKeys, ...writableLoadedAddresses, ...readonlyLoadedAddresses],
        signerAddresses,
        numberOfRequiredSignatures: requiredSignatures,
        numberOfReadonlySignedAccounts: readonlySigned,
        numberOfReadonlyUnsignedAccounts: readonlyUnsigned,
        addressTableLookups: lookups,
    };
}

function countMatching(
    values: readonly AggregatedAccountMeta[],
    predicate: (value: AggregatedAccountMeta) => boolean,
): number {
    let count = 0;
    for (let index = 0, length = values.length; index < length; index++) {
        const value = values[index];
        if (value !== undefined && predicate(value)) {
            count++;
        }
    }
    return count;
}

function signMessageWithKeypair(message: Uint8Array, keypair: SolanaKeypair): Uint8Array {
    const privateKey = privateKeyFromSeed(keypair.secretKeySeed);
    const actualPublicKey = encodeBase58(publicKeyBytesFromPrivateKey(privateKey));
    if (actualPublicKey !== normalizePublicKey(keypair.publicKey)) {
        throw new Error(`Secret seed does not match public key ${keypair.publicKey}`);
    }
    return new Uint8Array(signBytes(null, message, privateKey));
}

function privateKeyFromSeed(seed: Uint8Array): KeyObject {
    if (seed.length !== 32) {
        throw new Error("Ed25519 seed must contain 32 bytes");
    }
    return createPrivateKey({
        key: Buffer.from(concatenate([ED25519_PKCS8_PREFIX, seed])),
        format: "der",
        type: "pkcs8",
    });
}

function publicKeyBytesFromPrivateKey(privateKey: KeyObject): Uint8Array {
    const exported = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    const bytes = new Uint8Array(exported);
    if (bytes.length < 32) {
        throw new Error("Ed25519 public-key export is too short");
    }
    return bytes.slice(bytes.length - 32);
}

function serializeTransaction(messageBytes: Uint8Array, signatures: readonly Uint8Array[]): Uint8Array {
    const parts: Uint8Array[] = [encodeShortVectorLength(signatures.length)];
    for (let index = 0, length = signatures.length; index < length; index++) {
        const signature = signatures[index];
        if (signature === undefined || signature.length !== 64) {
            throw new Error(`Transaction signature ${index} must contain 64 bytes`);
        }
        parts.push(signature);
    }
    parts.push(messageBytes);
    return concatenate(parts);
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

function readLittleEndianUnsigned(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index--) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}
