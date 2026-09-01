import { decodePublicKey, encodeBase58 } from "./base58.mjs";
import { concatenateBytes, textBytes } from "./wire.mjs";

const PROGRAM_DERIVED_ADDRESS_MARKER = textBytes("ProgramDerivedAddress");
const ED25519_FIELD_MODULUS = (1n << 255n) - 19n;
const ED25519_D = modulo(-121665n * modularInverse(121666n, ED25519_FIELD_MODULUS), ED25519_FIELD_MODULUS);
const ED25519_SQRT_MINUS_ONE = modularPower(2n, (ED25519_FIELD_MODULUS - 1n) / 4n, ED25519_FIELD_MODULUS);

function modulo(value, modulus) {
    const remainder = value % modulus;
    return remainder >= 0n ? remainder : remainder + modulus;
}

function modularPower(base, exponent, modulus) {
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

function modularInverse(value, modulus) {
    if (modulo(value, modulus) === 0n) {
        throw new Error("Modular inverse does not exist");
    }
    return modularPower(value, modulus - 2n, modulus);
}

function littleEndianInteger(bytes) {
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index--) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}

function isEd25519CurvePoint(compressedPoint) {
    if (compressedPoint.length !== 32) return false;
    const encodedY = new Uint8Array(compressedPoint);
    const sign = ((encodedY[31] ?? 0) >>> 7) & 1;
    encodedY[31] = (encodedY[31] ?? 0) & 0x7f;
    const y = littleEndianInteger(encodedY);
    if (y >= ED25519_FIELD_MODULUS) return false;
    const ySquared = modulo(y * y, ED25519_FIELD_MODULUS);
    const numerator = modulo(ySquared - 1n, ED25519_FIELD_MODULUS);
    const denominator = modulo(ED25519_D * ySquared + 1n, ED25519_FIELD_MODULUS);
    if (denominator === 0n) return false;
    const xSquared = modulo(
        numerator * modularInverse(denominator, ED25519_FIELD_MODULUS),
        ED25519_FIELD_MODULUS,
    );
    let x = modularPower(xSquared, (ED25519_FIELD_MODULUS + 3n) / 8n, ED25519_FIELD_MODULUS);
    if (modulo(x * x - xSquared, ED25519_FIELD_MODULUS) !== 0n) {
        x = modulo(x * ED25519_SQRT_MINUS_ONE, ED25519_FIELD_MODULUS);
    }
    if (modulo(x * x - xSquared, ED25519_FIELD_MODULUS) !== 0n) return false;
    return !(x === 0n && sign === 1);
}

async function sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) {
        throw new Error("WebCrypto SHA-256 is unavailable");
    }
    return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

function validateSeeds(seeds, maximumSeedCount) {
    if (seeds.length > maximumSeedCount) {
        throw new Error("Program address accepts at most " + String(maximumSeedCount) + " seeds");
    }
    for (let index = 0; index < seeds.length; index++) {
        if (seeds[index].length > 32) {
            throw new Error("Program address seed " + String(index) + " exceeds 32 bytes");
        }
    }
}

export async function createProgramAddress(seeds, programAddress) {
    validateSeeds(seeds, 16);
    const hashInput = concatenateBytes([
        ...seeds,
        decodePublicKey(programAddress),
        PROGRAM_DERIVED_ADDRESS_MARKER,
    ]);
    const addressBytes = await sha256(hashInput);
    if (isEd25519CurvePoint(addressBytes)) {
        throw new Error("Derived address is on the Ed25519 curve");
    }
    return encodeBase58(addressBytes);
}

export async function findProgramAddress(seeds, programAddress) {
    validateSeeds(seeds, 15);
    for (let bump = 255; bump >= 0; bump--) {
        try {
            return {
                address: await createProgramAddress([...seeds, new Uint8Array([bump])], programAddress),
                bump,
            };
        } catch (error) {
            if (!(error instanceof Error) || error.message !== "Derived address is on the Ed25519 curve") {
                throw error;
            }
        }
    }
    throw new Error("Unable to find an off-curve program address");
}
