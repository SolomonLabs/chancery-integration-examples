export type UnsignedIntegerInput = bigint | number | string;

const TEXT_ENCODER = new TextEncoder();

export function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
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

function unsignedIntegerFromValue(value: UnsignedIntegerInput, label: string): bigint {
    if (typeof value === "bigint") {
        if (value < 0n) {
            throw new Error(label + " must be unsigned");
        }
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(label + " must be a safe unsigned integer");
        }
        return BigInt(value);
    }
    if (!/^[0-9]+$/.test(value)) {
        throw new Error(label + " must be a decimal unsigned integer string");
    }
    return BigInt(value);
}

export function encodeUnsignedInteger(
    value: UnsignedIntegerInput,
    byteLength: number,
    label: string,
): Uint8Array {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
        throw new Error("Unsigned integer byte length must be a positive integer");
    }
    let integerValue = unsignedIntegerFromValue(value, label);
    const exclusiveMaximum = 1n << BigInt(byteLength * 8);
    if (integerValue >= exclusiveMaximum) {
        throw new Error(label + " exceeds the unsigned " + String(byteLength * 8) + "-bit range");
    }
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
        bytes[index] = Number(integerValue & 0xffn);
        integerValue >>= 8n;
    }
    return bytes;
}

export function encodeU8(value: UnsignedIntegerInput, label = "u8"): Uint8Array {
    return encodeUnsignedInteger(value, 1, label);
}

export function encodeU16(value: UnsignedIntegerInput, label = "u16"): Uint8Array {
    return encodeUnsignedInteger(value, 2, label);
}

export function encodeU32(value: UnsignedIntegerInput, label = "u32"): Uint8Array {
    return encodeUnsignedInteger(value, 4, label);
}

export function encodeU64(value: UnsignedIntegerInput, label = "u64"): Uint8Array {
    return encodeUnsignedInteger(value, 8, label);
}

export function encodeBoolean(value: boolean): Uint8Array {
    return new Uint8Array([value ? 1 : 0]);
}

export function encodeByteVector(bytes: Uint8Array, label = "bytes"): Uint8Array {
    return concatenateBytes([
        encodeU32(bytes.length, label + ".length"),
        bytes,
    ]);
}

export function encodeOptionalString(value: string | null | undefined, label = "string"): Uint8Array {
    if (value === null || value === undefined) {
        return new Uint8Array([0]);
    }
    const bytes = TEXT_ENCODER.encode(value);
    return concatenateBytes([
        new Uint8Array([1]),
        encodeU32(bytes.length, label + ".length"),
        bytes,
    ]);
}
