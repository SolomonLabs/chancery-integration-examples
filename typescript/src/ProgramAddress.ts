import { createHash } from "node:crypto";

import { decodePublicKey, encodeBase58 } from "./Base58Codec.js";
import { CHANCERY_PROGRAM_ADDRESS } from "./ChancerySchema.js";

const PROGRAM_DERIVED_ADDRESS_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const ED25519_FIELD_MODULUS = (1n << 255n) - 19n;
const ED25519_D = modulo(-121665n * modularInverse(121666n, ED25519_FIELD_MODULUS), ED25519_FIELD_MODULUS);
const ED25519_SQRT_MINUS_ONE = modularPower(2n, (ED25519_FIELD_MODULUS - 1n) / 4n, ED25519_FIELD_MODULUS);

export interface ProgramAddressResult {
    readonly address: string;
    readonly bump: number;
}

function modulo(value: bigint, modulus: bigint): bigint {
    const remainder = value % modulus;
    return remainder >= 0n ? remainder : remainder + modulus;
}

function modularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    let currentBase = modulo(base, modulus);
    let currentExponent = exponent;
    while (currentExponent > 0n) {
        if ((currentExponent & 1n) === 1n) {
            result = modulo(result * currentBase, modulus);
        }
        currentBase = modulo(currentBase * currentBase, modulus);
        currentExponent >>= 1n;
    }
    return result;
}

function modularInverse(value: bigint, modulus: bigint): bigint {
    if (modulo(value, modulus) === 0n) {
        throw new Error("Modular inverse does not exist");
    }
    return modularPower(value, modulus - 2n, modulus);
}

function littleEndianInteger(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index--) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}

function isEd25519CurvePoint(compressedPoint: Uint8Array): boolean {
    if (compressedPoint.length !== 32) {
        return false;
    }

    const encodedY = new Uint8Array(compressedPoint);
    const sign = ((encodedY[31] ?? 0) >>> 7) & 1;
    encodedY[31] = (encodedY[31] ?? 0) & 0x7f;
    const y = littleEndianInteger(encodedY);
    if (y >= ED25519_FIELD_MODULUS) {
        return false;
    }

    const ySquared = modulo(y * y, ED25519_FIELD_MODULUS);
    const numerator = modulo(ySquared - 1n, ED25519_FIELD_MODULUS);
    const denominator = modulo(ED25519_D * ySquared + 1n, ED25519_FIELD_MODULUS);
    if (denominator === 0n) {
        return false;
    }

    const xSquared = modulo(
        numerator * modularInverse(denominator, ED25519_FIELD_MODULUS),
        ED25519_FIELD_MODULUS,
    );
    let x = modularPower(
        xSquared,
        (ED25519_FIELD_MODULUS + 3n) / 8n,
        ED25519_FIELD_MODULUS,
    );
    if (modulo(x * x - xSquared, ED25519_FIELD_MODULUS) !== 0n) {
        x = modulo(x * ED25519_SQRT_MINUS_ONE, ED25519_FIELD_MODULUS);
    }
    if (modulo(x * x - xSquared, ED25519_FIELD_MODULUS) !== 0n) {
        return false;
    }
    if (x === 0n && sign === 1) {
        return false;
    }
    return true;
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

function hashBytes(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function validateSeeds(seeds: readonly Uint8Array[], maximumSeedCount: number): void {
    if (seeds.length > maximumSeedCount) {
        throw new Error(`Program address accepts at most ${maximumSeedCount} seeds`);
    }
    for (let index = 0, length = seeds.length; index < length; index++) {
        const seed = seeds[index];
        if (seed === undefined || seed.length > 32) {
            throw new Error(`Program address seed ${index} exceeds 32 bytes`);
        }
    }
}

export function createProgramAddress(
    seeds: readonly Uint8Array[],
    programAddress: string | Uint8Array = CHANCERY_PROGRAM_ADDRESS,
): string {
    validateSeeds(seeds, 16);
    const programAddressBytes = decodePublicKey(programAddress);
    const hashInput = concatenate([...seeds, programAddressBytes, PROGRAM_DERIVED_ADDRESS_MARKER]);
    const addressBytes = hashBytes(hashInput);
    if (isEd25519CurvePoint(addressBytes)) {
        throw new Error("Derived address is on the Ed25519 curve");
    }
    return encodeBase58(addressBytes);
}

export function findProgramAddress(
    seeds: readonly Uint8Array[],
    programAddress: string | Uint8Array = CHANCERY_PROGRAM_ADDRESS,
): ProgramAddressResult {
    validateSeeds(seeds, 15);
    for (let bump = 255; bump >= 0; bump--) {
        try {
            return {
                address: createProgramAddress([...seeds, new Uint8Array([bump])], programAddress),
                bump,
            };
        } catch (error: unknown) {
            if (!(error instanceof Error) || error.message !== "Derived address is on the Ed25519 curve") {
                throw error;
            }
        }
    }
    throw new Error("Unable to find an off-curve program address");
}
