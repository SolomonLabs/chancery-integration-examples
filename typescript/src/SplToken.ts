import { decodePublicKey, encodeBase58, normalizePublicKey } from "./Base58Codec.js";
import { findProgramAddress, type ProgramAddressResult } from "./ProgramAddress.js";

export const SPL_TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const TOKEN_MINT_BASE_SIZE = 82;
const TOKEN_ACCOUNT_BASE_SIZE = 165;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165;
const TOKEN_2022_TLV_OFFSET = 166;
const TOKEN_2022_MINT_ACCOUNT_TYPE = 1;
const TRANSFER_FEE_CONFIG_EXTENSION_TYPE = 1;
const TRANSFER_HOOK_EXTENSION_TYPE = 14;
const CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION_TYPE = 16;
const TRANSFER_FEE_CONFIG_SIZE = 108;
const BASIS_POINT_DENOMINATOR = 10_000n;

export interface Token2022Extension {
    readonly extensionType: number;
    readonly byteLength: number;
    readonly value: Uint8Array;
}

export interface Token2022TransferFee {
    readonly epoch: bigint;
    readonly maximumFee: bigint;
    readonly transferFeeBasisPoints: number;
}

export interface Token2022TransferFeeConfig {
    readonly transferFeeConfigAuthority: string | null;
    readonly withdrawWithheldAuthority: string | null;
    readonly withheldAmount: bigint;
    readonly olderTransferFee: Token2022TransferFee;
    readonly newerTransferFee: Token2022TransferFee;
}

export interface TokenTransferFeeCalculation {
    readonly epoch: bigint;
    readonly amount: bigint;
    readonly transferFeeBasisPoints: number;
    readonly maximumFee: bigint;
    readonly feeAmount: bigint;
    readonly receivedAmount: bigint;
}

export interface DecodedTokenMint {
    readonly mintAuthority: string | null;
    readonly supply: bigint;
    readonly decimals: number;
    readonly initialized: boolean;
    readonly freezeAuthority: string | null;
    readonly baseSize: number;
    readonly totalSize: number;
    readonly hasExtensions: boolean;
    readonly accountType: number | null;
    readonly extensions: readonly Token2022Extension[];
    readonly transferFeeConfig: Token2022TransferFeeConfig | null;
    readonly transferHookProgramAddress: string | null;
    readonly hasUnmodeledTransferBehavior: boolean;
}

export interface DecodedTokenAccount {
    readonly mint: string;
    readonly owner: string;
    readonly amount: bigint;
    readonly delegate: string | null;
    readonly state: number;
    readonly nativeReserve: bigint | null;
    readonly delegatedAmount: bigint;
    readonly closeAuthority: string | null;
    readonly baseSize: number;
    readonly totalSize: number;
    readonly hasExtensions: boolean;
}

export interface AssociatedTokenAddress extends ProgramAddressResult {
    readonly owner: string;
    readonly mint: string;
    readonly tokenProgramAddress: string;
}

export function isSupportedTokenProgram(programAddress: string | Uint8Array): boolean {
    const normalized = normalizePublicKey(programAddress);
    return normalized === SPL_TOKEN_PROGRAM_ADDRESS || normalized === TOKEN_2022_PROGRAM_ADDRESS;
}

export function assertSupportedTokenProgram(programAddress: string | Uint8Array): string {
    const normalized = normalizePublicKey(programAddress);
    if (!isSupportedTokenProgram(normalized)) {
        throw new Error(`Unsupported token program: ${normalized}`);
    }
    return normalized;
}

export function deriveAssociatedTokenAddress(
    owner: string | Uint8Array,
    mint: string | Uint8Array,
    tokenProgramAddress: string | Uint8Array,
): AssociatedTokenAddress {
    const normalizedOwner = normalizePublicKey(owner);
    const normalizedMint = normalizePublicKey(mint);
    const normalizedTokenProgram = assertSupportedTokenProgram(tokenProgramAddress);
    const result = findProgramAddress(
        [
            decodePublicKey(normalizedOwner),
            decodePublicKey(normalizedTokenProgram),
            decodePublicKey(normalizedMint),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    );
    return {
        ...result,
        owner: normalizedOwner,
        mint: normalizedMint,
        tokenProgramAddress: normalizedTokenProgram,
    };
}

export function decodeTokenMint(data: Uint8Array): DecodedTokenMint {
    if (data.length < TOKEN_MINT_BASE_SIZE) {
        throw new Error(`Token mint requires at least ${TOKEN_MINT_BASE_SIZE} bytes; received ${data.length}`);
    }
    const mintAuthority = decodeCOptionPublicKey(data, 0, "mint authority");
    const supply = readUnsignedLittleEndian(data, 36, 8, "mint supply");
    const decimals = data[44];
    const initializedByte = data[45];
    if (decimals === undefined || initializedByte === undefined) {
        throw new Error("Token mint base data is incomplete");
    }
    if (initializedByte !== 0 && initializedByte !== 1) {
        throw new Error(`Token mint initialized flag is invalid: ${initializedByte}`);
    }
    const freezeAuthority = decodeCOptionPublicKey(data, 46, "freeze authority");
    const extensionResult = decodeToken2022MintExtensions(data);
    return {
        mintAuthority,
        supply,
        decimals,
        initialized: initializedByte === 1,
        freezeAuthority,
        baseSize: TOKEN_MINT_BASE_SIZE,
        totalSize: data.length,
        hasExtensions: extensionResult.extensions.length > 0,
        accountType: extensionResult.accountType,
        extensions: extensionResult.extensions,
        transferFeeConfig: extensionResult.transferFeeConfig,
        transferHookProgramAddress: extensionResult.transferHookProgramAddress,
        hasUnmodeledTransferBehavior: extensionResult.hasUnmodeledTransferBehavior,
    };
}

export function selectActiveTransferFee(
    config: Token2022TransferFeeConfig,
    currentEpoch: bigint,
): Token2022TransferFee {
    if (currentEpoch < 0n) {
        throw new Error("Current epoch must be non-negative");
    }
    return currentEpoch < config.newerTransferFee.epoch
        ? config.olderTransferFee
        : config.newerTransferFee;
}

export function calculateTokenTransferFee(
    amount: bigint,
    config: Token2022TransferFeeConfig | null,
    currentEpoch: bigint,
): TokenTransferFeeCalculation {
    if (amount < 0n) {
        throw new Error("Transfer amount must be non-negative");
    }
    if (config === null) {
        return {
            epoch: currentEpoch,
            amount,
            transferFeeBasisPoints: 0,
            maximumFee: 0n,
            feeAmount: 0n,
            receivedAmount: amount,
        };
    }
    const activeFee = selectActiveTransferFee(config, currentEpoch);
    const basisPoints = BigInt(activeFee.transferFeeBasisPoints);
    const uncappedFee = amount === 0n || basisPoints === 0n
        ? 0n
        : divideCeiling(amount * basisPoints, BASIS_POINT_DENOMINATOR);
    const feeAmount = uncappedFee <= activeFee.maximumFee ? uncappedFee : activeFee.maximumFee;
    if (feeAmount > amount) {
        throw new Error("Calculated transfer fee exceeds transfer amount");
    }
    return {
        epoch: currentEpoch,
        amount,
        transferFeeBasisPoints: activeFee.transferFeeBasisPoints,
        maximumFee: activeFee.maximumFee,
        feeAmount,
        receivedAmount: amount - feeAmount,
    };
}

export function decodeTokenAccount(data: Uint8Array): DecodedTokenAccount {
    if (data.length < TOKEN_ACCOUNT_BASE_SIZE) {
        throw new Error(`Token account requires at least ${TOKEN_ACCOUNT_BASE_SIZE} bytes; received ${data.length}`);
    }
    const state = data[108];
    if (state === undefined || state > 2) {
        throw new Error(`Token account state is invalid: ${String(state)}`);
    }
    return {
        mint: encodeBase58(data.slice(0, 32)),
        owner: encodeBase58(data.slice(32, 64)),
        amount: readUnsignedLittleEndian(data, 64, 8, "token account amount"),
        delegate: decodeCOptionPublicKey(data, 72, "delegate"),
        state,
        nativeReserve: decodeCOptionUnsignedInteger(data, 109, "native reserve"),
        delegatedAmount: readUnsignedLittleEndian(data, 121, 8, "delegated amount"),
        closeAuthority: decodeCOptionPublicKey(data, 129, "close authority"),
        baseSize: TOKEN_ACCOUNT_BASE_SIZE,
        totalSize: data.length,
        hasExtensions: data.length > TOKEN_ACCOUNT_BASE_SIZE,
    };
}

export function assertTokenAccountBinding(
    tokenAccount: DecodedTokenAccount,
    expectedMint: string | Uint8Array,
    expectedOwner: string | Uint8Array,
    label: string,
): void {
    const normalizedMint = normalizePublicKey(expectedMint);
    const normalizedOwner = normalizePublicKey(expectedOwner);
    if (tokenAccount.mint !== normalizedMint) {
        throw new Error(`${label} mint ${tokenAccount.mint} does not match ${normalizedMint}`);
    }
    if (tokenAccount.owner !== normalizedOwner) {
        throw new Error(`${label} owner ${tokenAccount.owner} does not match ${normalizedOwner}`);
    }
    if (tokenAccount.state !== 1) {
        throw new Error(`${label} is not initialized`);
    }
}

interface Token2022MintExtensionResult {
    readonly accountType: number | null;
    readonly extensions: readonly Token2022Extension[];
    readonly transferFeeConfig: Token2022TransferFeeConfig | null;
    readonly transferHookProgramAddress: string | null;
    readonly hasUnmodeledTransferBehavior: boolean;
}

function decodeToken2022MintExtensions(data: Uint8Array): Token2022MintExtensionResult {
    if (data.length === TOKEN_MINT_BASE_SIZE) {
        return {
            accountType: null,
            extensions: [],
            transferFeeConfig: null,
            transferHookProgramAddress: null,
            hasUnmodeledTransferBehavior: false,
        };
    }
    if (data.length <= TOKEN_2022_ACCOUNT_TYPE_OFFSET) {
        throw new Error("Token-2022 mint extension region is truncated");
    }
    const accountType = data[TOKEN_2022_ACCOUNT_TYPE_OFFSET];
    if (accountType !== TOKEN_2022_MINT_ACCOUNT_TYPE) {
        throw new Error(`Token-2022 mint account type is invalid: ${String(accountType)}`);
    }
    const extensions: Token2022Extension[] = [];
    let transferFeeConfig: Token2022TransferFeeConfig | null = null;
    let transferHookProgramAddress: string | null = null;
    let hasUnmodeledTransferBehavior = false;
    let cursor = TOKEN_2022_TLV_OFFSET;
    while (cursor + 4 <= data.length) {
        const extensionType = Number(readUnsignedLittleEndian(data, cursor, 2, "extension type"));
        const byteLength = Number(readUnsignedLittleEndian(data, cursor + 2, 2, "extension length"));
        if (extensionType === 0) {
            break;
        }
        const valueOffset = cursor + 4;
        const value = sliceExact(data, valueOffset, byteLength, `extension ${extensionType}`);
        extensions.push({ extensionType, byteLength, value });
        if (extensionType === TRANSFER_FEE_CONFIG_EXTENSION_TYPE) {
            if (transferFeeConfig !== null) {
                throw new Error("Token-2022 mint has duplicate TransferFeeConfig extensions");
            }
            transferFeeConfig = decodeTransferFeeConfig(value);
        } else if (extensionType === TRANSFER_HOOK_EXTENSION_TYPE) {
            if (value.length !== 64) {
                throw new Error(`TransferHook extension requires 64 bytes; received ${value.length}`);
            }
            transferHookProgramAddress = decodeOptionalNonzeroPublicKey(value, 32, "transfer hook program");
            if (transferHookProgramAddress !== null) {
                hasUnmodeledTransferBehavior = true;
            }
        } else if (extensionType === CONFIDENTIAL_TRANSFER_FEE_CONFIG_EXTENSION_TYPE) {
            hasUnmodeledTransferBehavior = true;
        }
        cursor = valueOffset + byteLength;
    }
    if (cursor < data.length && data.length - cursor < 4) {
        for (let index = cursor, length = data.length; index < length; index++) {
            if (data[index] !== 0) {
                throw new Error("Token-2022 mint TLV has nonzero trailing bytes");
            }
        }
    }
    return {
        accountType,
        extensions,
        transferFeeConfig,
        transferHookProgramAddress,
        hasUnmodeledTransferBehavior,
    };
}

function decodeTransferFeeConfig(value: Uint8Array): Token2022TransferFeeConfig {
    if (value.length !== TRANSFER_FEE_CONFIG_SIZE) {
        throw new Error(`TransferFeeConfig requires ${TRANSFER_FEE_CONFIG_SIZE} bytes; received ${value.length}`);
    }
    return {
        transferFeeConfigAuthority: decodeOptionalNonzeroPublicKey(value, 0, "transfer fee config authority"),
        withdrawWithheldAuthority: decodeOptionalNonzeroPublicKey(value, 32, "withdraw withheld authority"),
        withheldAmount: readUnsignedLittleEndian(value, 64, 8, "withheld amount"),
        olderTransferFee: decodeTransferFee(value, 72, "older transfer fee"),
        newerTransferFee: decodeTransferFee(value, 90, "newer transfer fee"),
    };
}

function decodeTransferFee(value: Uint8Array, offset: number, label: string): Token2022TransferFee {
    const transferFeeBasisPoints = Number(readUnsignedLittleEndian(value, offset + 16, 2, `${label} basis points`));
    if (transferFeeBasisPoints > 10_000) {
        throw new Error(`${label} basis points exceed 10000: ${transferFeeBasisPoints}`);
    }
    return {
        epoch: readUnsignedLittleEndian(value, offset, 8, `${label} epoch`),
        maximumFee: readUnsignedLittleEndian(value, offset + 8, 8, `${label} maximum fee`),
        transferFeeBasisPoints,
    };
}

function decodeOptionalNonzeroPublicKey(data: Uint8Array, offset: number, label: string): string | null {
    const bytes = sliceExact(data, offset, 32, label);
    let nonzero = false;
    for (let index = 0; index < 32; index++) {
        if (bytes[index] !== 0) {
            nonzero = true;
            break;
        }
    }
    return nonzero ? encodeBase58(bytes) : null;
}

function decodeCOptionPublicKey(data: Uint8Array, offset: number, label: string): string | null {
    const tag = readUnsignedLittleEndian(data, offset, 4, `${label} option tag`);
    if (tag === 0n) {
        return null;
    }
    if (tag !== 1n) {
        throw new Error(`${label} option tag is invalid: ${tag.toString()}`);
    }
    return encodeBase58(sliceExact(data, offset + 4, 32, label));
}

function decodeCOptionUnsignedInteger(data: Uint8Array, offset: number, label: string): bigint | null {
    const tag = readUnsignedLittleEndian(data, offset, 4, `${label} option tag`);
    if (tag === 0n) {
        return null;
    }
    if (tag !== 1n) {
        throw new Error(`${label} option tag is invalid: ${tag.toString()}`);
    }
    return readUnsignedLittleEndian(data, offset + 4, 8, label);
}

function readUnsignedLittleEndian(
    data: Uint8Array,
    offset: number,
    byteLength: number,
    label: string,
): bigint {
    const bytes = sliceExact(data, offset, byteLength, label);
    let value = 0n;
    for (let index = byteLength - 1; index >= 0; index--) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}

function divideCeiling(numerator: bigint, denominator: bigint): bigint {
    if (denominator <= 0n) {
        throw new Error("Division denominator must be positive");
    }
    return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function sliceExact(data: Uint8Array, offset: number, byteLength: number, label: string): Uint8Array {
    if (!Number.isInteger(offset) || offset < 0 || offset + byteLength > data.length) {
        throw new Error(`${label} requires bytes ${offset}..${offset + byteLength - 1}`);
    }
    return data.slice(offset, offset + byteLength);
}
