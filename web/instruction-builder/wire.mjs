import { decodePublicKey } from "./base58.mjs";

const TEXT_ENCODER = new TextEncoder();

export function concatenateBytes(parts) {
    let byteLength = 0;
    for (const part of parts) {
        byteLength += part.length;
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}

export function encodeUnsignedInteger(value, byteLength, label) {
    let integerValue;
    if (typeof value === "bigint") {
        integerValue = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
        integerValue = BigInt(value);
    } else if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
        integerValue = BigInt(value);
    } else {
        throw new Error(label + " must be an integer");
    }
    const exclusiveMaximum = 1n << BigInt(byteLength * 8);
    if (integerValue < 0n || integerValue >= exclusiveMaximum) {
        throw new Error(label + " exceeds the unsigned " + String(byteLength * 8) + "-bit range");
    }
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
        bytes[index] = Number(integerValue & 0xffn);
        integerValue >>= 8n;
    }
    return bytes;
}

export function encodeSignedInteger(value, byteLength, label) {
    let integerValue;
    if (typeof value === "bigint") {
        integerValue = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
        integerValue = BigInt(value);
    } else if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
        integerValue = BigInt(value);
    } else {
        throw new Error(label + " must be an integer");
    }
    const bitLength = BigInt(byteLength * 8);
    const minimumValue = -(1n << (bitLength - 1n));
    const maximumValue = (1n << (bitLength - 1n)) - 1n;
    if (integerValue < minimumValue || integerValue > maximumValue) {
        throw new Error(label + " exceeds the signed " + String(byteLength * 8) + "-bit range");
    }
    if (integerValue < 0n) {
        integerValue += 1n << bitLength;
    }
    return encodeUnsignedInteger(integerValue, byteLength, label);
}

export function decodeHex(value) {
    const body = value.startsWith("0x") ? value.slice(2) : value;
    if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
        throw new Error("Hexadecimal data requires an even number of digits");
    }
    const bytes = new Uint8Array(body.length / 2);
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

export function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function bytesFromValue(value, label) {
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (Array.isArray(value)) {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index++) {
            const byteValue = value[index];
            if (!Number.isInteger(byteValue) || byteValue < 0 || byteValue > 255) {
                throw new Error(label + "[" + String(index) + "] must be an unsigned byte");
            }
            bytes[index] = byteValue;
        }
        return bytes;
    }
    if (typeof value === "string") {
        if (value.startsWith("0x")) {
            return decodeHex(value);
        }
        if (value.startsWith("base64:")) {
            return decodeBase64(value.slice(7));
        }
    }
    throw new Error(label + " must be hexadecimal, base64-prefixed data, or a byte array");
}

export function encodeType(schema, type, value, label) {
    if (typeof type === "string") {
        switch (type) {
            case "u8": return encodeUnsignedInteger(value, 1, label);
            case "u16": return encodeUnsignedInteger(value, 2, label);
            case "u32": return encodeUnsignedInteger(value, 4, label);
            case "u64": return encodeUnsignedInteger(value, 8, label);
            case "u128": return encodeUnsignedInteger(value, 16, label);
            case "i64": return encodeSignedInteger(value, 8, label);
            case "i128": return encodeSignedInteger(value, 16, label);
            case "bool":
                if (typeof value !== "boolean") {
                    throw new Error(label + " must be a boolean");
                }
                return new Uint8Array([value ? 1 : 0]);
            case "pubkey":
                return decodePublicKey(value);
            default:
                throw new Error("Unsupported primitive type " + type);
        }
    }
    if (type.kind === "option") {
        if (value === null || value === undefined || value === "") {
            return new Uint8Array([0]);
        }
        return concatenateBytes([new Uint8Array([1]), encodeType(schema, type.item, value, label)]);
    }
    if (type.kind === "array") {
        if (type.item === "u8") {
            const bytes = bytesFromValue(value, label);
            if (bytes.length !== type.length) {
                throw new Error(label + " must contain exactly " + String(type.length) + " bytes");
            }
            return bytes;
        }
        if (!Array.isArray(value) || value.length !== type.length) {
            throw new Error(label + " must contain exactly " + String(type.length) + " items");
        }
        return concatenateBytes(value.map((item, index) => encodeType(
            schema,
            type.item,
            item,
            label + "[" + String(index) + "]",
        )));
    }
    if (type.kind === "vector") {
        if (type.item === "u8") {
            const bytes = bytesFromValue(value, label);
            return concatenateBytes([encodeUnsignedInteger(bytes.length, 4, label + ".length"), bytes]);
        }
        if (!Array.isArray(value)) {
            throw new Error(label + " must be an array");
        }
        return concatenateBytes([
            encodeUnsignedInteger(value.length, 4, label + ".length"),
            ...value.map((item, index) => encodeType(
                schema,
                type.item,
                item,
                label + "[" + String(index) + "]",
            )),
        ]);
    }
    if (type.kind === "defined") {
        const struct = schema.types[type.name];
        if (struct === undefined) {
            throw new Error("Unknown defined type " + type.name);
        }
        return encodeStruct(schema, struct.fields, value, label);
    }
    throw new Error("Unsupported Chancery type");
}

export function encodeStruct(schema, fields, values, label) {
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
        throw new Error(label + " must be an object");
    }
    const parts = [];
    for (const field of fields) {
        let value = values[field.name];
        if (value === undefined && !(typeof field.type !== "string" && field.type.kind === "option")) {
            throw new Error(label + "." + field.name + " is required");
        }
        parts.push(encodeType(schema, field.type, value, label + "." + field.name));
    }
    return concatenateBytes(parts);
}

export function parseInputValue(type, rawValue) {
    const value = rawValue.trim();
    if (typeof type === "string") {
        if (type === "bool") {
            if (value === "true") return true;
            if (value === "false") return false;
            throw new Error("Boolean values must be true or false");
        }
        if (type === "pubkey") {
            return value;
        }
        return value;
    }
    if (type.kind === "option") {
        return value.length === 0 ? null : parseInputValue(type.item, value);
    }
    if ((type.kind === "array" || type.kind === "vector") && type.item === "u8") {
        return value;
    }
    if (value.length === 0) {
        throw new Error("JSON value is required");
    }
    return JSON.parse(value);
}

function zeroValue(schema, type) {
    if (typeof type === "string") {
        if (type === "bool") return false;
        if (type === "pubkey") return "";
        return "0";
    }
    if (type.kind === "option") return null;
    if (type.kind === "vector") return type.item === "u8" ? "0x" : [];
    if (type.kind === "array") {
        if (type.item === "u8") return "0x" + "00".repeat(type.length);
        return Array.from({ length: type.length }, () => zeroValue(schema, type.item));
    }
    if (type.kind === "defined") {
        const struct = schema.types[type.name];
        const values = {};
        for (const field of struct.fields) {
            values[field.name] = zeroValue(schema, field.type);
        }
        return values;
    }
    throw new Error("Unsupported Chancery type");
}

export function initialInputValue(schema, type) {
    const value = zeroValue(schema, type);
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value === null) {
        return "";
    }
    return JSON.stringify(value, null, 2);
}

export function typeLabel(type) {
    if (typeof type === "string") return type;
    if (type.kind === "option") return "option<" + typeLabel(type.item) + ">";
    if (type.kind === "array") return "[" + typeLabel(type.item) + "; " + String(type.length) + "]";
    if (type.kind === "vector") return "vector<" + typeLabel(type.item) + ">";
    if (type.kind === "defined") return type.name;
    return "unknown";
}

export function bytesToHex(bytes) {
    let value = "";
    for (const byte of bytes) {
        value += byte.toString(16).padStart(2, "0");
    }
    return value;
}

export function bytesToBase64(bytes) {
    let binary = "";
    const chunkLength = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkLength) {
        const end = Math.min(offset + chunkLength, bytes.length);
        for (let index = offset; index < end; index++) {
            binary += String.fromCharCode(bytes[index] ?? 0);
        }
    }
    return btoa(binary);
}

export function jsonReplacer(_key, value) {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Uint8Array) return "0x" + bytesToHex(value);
    return value;
}

export function instructionForJson(instruction) {
    return {
        programAddress: instruction.programAddress,
        accounts: instruction.accounts,
        dataHex: "0x" + bytesToHex(instruction.data),
        dataBase64: bytesToBase64(instruction.data),
    };
}

export function textBytes(value) {
    return TEXT_ENCODER.encode(value);
}
