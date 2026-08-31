import { decodeBase58, encodeBase58 } from "./Base58Codec.js";
import type { FieldSchema, StructSchema, TypeSchema } from "./ChancerySchema.js";
import { getDefinedTypeSchema } from "./ChancerySchema.js";

export type StructValues = Readonly<Record<string, unknown>>;

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
    let totalLength = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        totalLength += parts[index]?.length ?? 0;
    }
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        const part = parts[index];
        if (part === undefined) {
            continue;
        }
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}

function integerFromValue(value: unknown, label: string): bigint {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
        return BigInt(value);
    }
    throw new Error(`${label} must be a bigint, safe integer, or decimal integer string`);
}

function encodeUnsignedInteger(value: unknown, byteLength: number, label: string): Uint8Array {
    let integerValue = integerFromValue(value, label);
    const maximumValue = 1n << BigInt(byteLength * 8);
    if (integerValue < 0n || integerValue >= maximumValue) {
        throw new Error(`${label} is outside the unsigned ${byteLength * 8}-bit range`);
    }
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index++) {
        bytes[index] = Number(integerValue & 0xffn);
        integerValue >>= 8n;
    }
    return bytes;
}

function encodeSignedInteger(value: unknown, byteLength: number, label: string): Uint8Array {
    let integerValue = integerFromValue(value, label);
    const bitLength = BigInt(byteLength * 8);
    const minimumValue = -(1n << (bitLength - 1n));
    const maximumValue = (1n << (bitLength - 1n)) - 1n;
    if (integerValue < minimumValue || integerValue > maximumValue) {
        throw new Error(`${label} is outside the signed ${byteLength * 8}-bit range`);
    }
    if (integerValue < 0n) {
        integerValue += 1n << bitLength;
    }
    return encodeUnsignedInteger(integerValue, byteLength, label);
}

function decodeHex(hexadecimal: string): Uint8Array {
    const body = hexadecimal.startsWith("0x") ? hexadecimal.slice(2) : hexadecimal;
    if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
        throw new Error("Hexadecimal byte strings require an even number of hexadecimal digits");
    }
    const bytes = new Uint8Array(body.length / 2);
    for (let index = 0, length = bytes.length; index < length; index++) {
        bytes[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

export function decodeBase64(encoded: string): Uint8Array {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0, length = binary.length; index < length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, bytes.length);
        for (let index = offset; index < end; index++) {
            binary += String.fromCharCode(bytes[index] ?? 0);
        }
    }
    return btoa(binary);
}

export function bytesFromValue(value: unknown, label: string): Uint8Array {
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (Array.isArray(value)) {
        const bytes = new Uint8Array(value.length);
        for (let index = 0, length = value.length; index < length; index++) {
            const byteValue = value[index];
            if (typeof byteValue !== "number" || !Number.isInteger(byteValue) || byteValue < 0 || byteValue > 255) {
                throw new Error(`${label}[${index}] must be an unsigned byte`);
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
    throw new Error(
        `${label} must be Uint8Array, an unsigned-byte array, ` +
        "0x-prefixed hexadecimal, or base64-prefixed data",
    );
}

function recordFromValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value) || value instanceof Uint8Array) {
        throw new Error(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function arrayFromValue(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    return value;
}

function encodePrimitive(typeName: string, value: unknown, label: string): Uint8Array {
    switch (typeName) {
        case "u8":
            return encodeUnsignedInteger(value, 1, label);
        case "u16":
            return encodeUnsignedInteger(value, 2, label);
        case "u32":
            return encodeUnsignedInteger(value, 4, label);
        case "u64":
            return encodeUnsignedInteger(value, 8, label);
        case "u128":
            return encodeUnsignedInteger(value, 16, label);
        case "i64":
            return encodeSignedInteger(value, 8, label);
        case "i128":
            return encodeSignedInteger(value, 16, label);
        case "bool":
            if (typeof value !== "boolean") {
                throw new Error(`${label} must be a boolean`);
            }
            return new Uint8Array([value ? 1 : 0]);
        case "pubkey": {
            const publicKeyBytes = typeof value === "string" ? decodeBase58(value) : bytesFromValue(value, label);
            if (publicKeyBytes.length !== 32) {
                throw new Error(`${label} public key must contain 32 bytes`);
            }
            return publicKeyBytes;
        }
        default:
            throw new Error(`Unsupported primitive type: ${typeName}`);
    }
}

export function encodeType(typeSchema: TypeSchema, value: unknown, label = "value"): Uint8Array {
    if (typeof typeSchema === "string") {
        return encodePrimitive(typeSchema, value, label);
    }
    if (typeSchema.kind === "option") {
        if (value === null || value === undefined) {
            return new Uint8Array([0]);
        }
        return concatenateBytes([new Uint8Array([1]), encodeType(typeSchema.item, value, label)]);
    }
    if (typeSchema.kind === "array") {
        if (typeSchema.item === "u8") {
            const bytes = bytesFromValue(value, label);
            if (bytes.length !== typeSchema.length) {
                throw new Error(`${label} must contain exactly ${typeSchema.length} bytes`);
            }
            return bytes;
        }
        const values = arrayFromValue(value, label);
        if (values.length !== typeSchema.length) {
            throw new Error(`${label} must contain exactly ${typeSchema.length} items`);
        }
        const parts: Uint8Array[] = [];
        for (let index = 0; index < typeSchema.length; index++) {
            parts.push(encodeType(typeSchema.item, values[index], `${label}[${index}]`));
        }
        return concatenateBytes(parts);
    }
    if (typeSchema.kind === "vector") {
        if (typeSchema.item === "u8") {
            const bytes = bytesFromValue(value, label);
            return concatenateBytes([encodeUnsignedInteger(bytes.length, 4, `${label}.length`), bytes]);
        }
        const values = arrayFromValue(value, label);
        const parts: Uint8Array[] = [encodeUnsignedInteger(values.length, 4, `${label}.length`)];
        for (let index = 0, length = values.length; index < length; index++) {
            parts.push(encodeType(typeSchema.item, values[index], `${label}[${index}]`));
        }
        return concatenateBytes(parts);
    }
    if (typeSchema.kind === "defined") {
        return encodeStruct(getDefinedTypeSchema(typeSchema.name), recordFromValue(value, label), label);
    }
    throw new Error("Unsupported type schema");
}

export function zeroValueForType(typeSchema: TypeSchema): unknown {
    if (typeof typeSchema === "string") {
        switch (typeSchema) {
            case "bool":
                return false;
            case "pubkey":
                return new Uint8Array(32);
            default:
                return 0;
        }
    }
    if (typeSchema.kind === "option") {
        return null;
    }
    if (typeSchema.kind === "vector") {
        return typeSchema.item === "u8" ? new Uint8Array(0) : [];
    }
    if (typeSchema.kind === "array") {
        if (typeSchema.item === "u8") {
            return new Uint8Array(typeSchema.length);
        }
        const values: unknown[] = [];
        for (let index = 0; index < typeSchema.length; index++) {
            values.push(zeroValueForType(typeSchema.item));
        }
        return values;
    }
    if (typeSchema.kind === "defined") {
        const values: Record<string, unknown> = {};
        const structSchema = getDefinedTypeSchema(typeSchema.name);
        for (let index = 0, length = structSchema.fields.length; index < length; index++) {
            const field = structSchema.fields[index];
            if (field !== undefined) {
                values[field.name] = zeroValueForType(field.type);
            }
        }
        return values;
    }
    throw new Error("Unsupported type schema");
}

export function encodeStruct(
    structSchema: StructSchema,
    values: StructValues,
    label = "struct",
    defaultMissingPadding = false,
): Uint8Array {
    const parts: Uint8Array[] = [];
    for (let index = 0, length = structSchema.fields.length; index < length; index++) {
        const field = structSchema.fields[index];
        if (field === undefined) {
            continue;
        }
        let fieldValue = values[field.name];
        if (
            fieldValue === undefined &&
            defaultMissingPadding &&
            (field.name.startsWith("_pad") || field.name.startsWith("_reserved"))
        ) {
            fieldValue = zeroValueForType(field.type);
        }
        if (fieldValue === undefined && !(typeof field.type !== "string" && field.type.kind === "option")) {
            throw new Error(`${label}.${field.name} is required`);
        }
        parts.push(encodeType(field.type, fieldValue, `${label}.${field.name}`));
    }
    return concatenateBytes(parts);
}

function decodeUnsignedInteger(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index--) {
        value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
}

function decodeSignedInteger(bytes: Uint8Array): bigint {
    const unsignedValue = decodeUnsignedInteger(bytes);
    const bitLength = BigInt(bytes.length * 8);
    const signBit = 1n << (bitLength - 1n);
    return (unsignedValue & signBit) === 0n ? unsignedValue : unsignedValue - (1n << bitLength);
}

export class BinaryReader {
    readonly #bytes: Uint8Array;
    #offset = 0;

    constructor(bytes: Uint8Array, offset = 0) {
        if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) {
            throw new Error("BinaryReader offset is outside the input range");
        }
        this.#bytes = bytes;
        this.#offset = offset;
    }

    get offset(): number {
        return this.#offset;
    }

    get remaining(): number {
        return this.#bytes.length - this.#offset;
    }

    readBytes(byteLength: number, label: string): Uint8Array {
        if (!Number.isInteger(byteLength) || byteLength < 0 || this.#offset + byteLength > this.#bytes.length) {
            throw new Error(`${label} requires ${byteLength} bytes with only ${this.remaining} remaining`);
        }
        const bytes = this.#bytes.slice(this.#offset, this.#offset + byteLength);
        this.#offset += byteLength;
        return bytes;
    }
}

function decodePrimitive(typeName: string, reader: BinaryReader, label: string): unknown {
    switch (typeName) {
        case "u8":
            return Number(decodeUnsignedInteger(reader.readBytes(1, label)));
        case "u16":
            return Number(decodeUnsignedInteger(reader.readBytes(2, label)));
        case "u32":
            return Number(decodeUnsignedInteger(reader.readBytes(4, label)));
        case "u64":
            return decodeUnsignedInteger(reader.readBytes(8, label));
        case "u128":
            return decodeUnsignedInteger(reader.readBytes(16, label));
        case "i64":
            return decodeSignedInteger(reader.readBytes(8, label));
        case "i128":
            return decodeSignedInteger(reader.readBytes(16, label));
        case "bool": {
            const value = Number(decodeUnsignedInteger(reader.readBytes(1, label)));
            if (value !== 0 && value !== 1) {
                throw new Error(`${label} contains an invalid boolean tag: ${value}`);
            }
            return value === 1;
        }
        case "pubkey":
            return encodeBase58(reader.readBytes(32, label));
        default:
            throw new Error(`Unsupported primitive type: ${typeName}`);
    }
}

export function decodeType(typeSchema: TypeSchema, reader: BinaryReader, label = "value"): unknown {
    if (typeof typeSchema === "string") {
        return decodePrimitive(typeSchema, reader, label);
    }
    if (typeSchema.kind === "option") {
        const tag = Number(decodeUnsignedInteger(reader.readBytes(1, `${label}.tag`)));
        if (tag === 0) {
            return null;
        }
        if (tag !== 1) {
            throw new Error(`${label} contains an invalid option tag: ${tag}`);
        }
        return decodeType(typeSchema.item, reader, label);
    }
    if (typeSchema.kind === "array") {
        if (typeSchema.item === "u8") {
            return reader.readBytes(typeSchema.length, label);
        }
        const values: unknown[] = [];
        for (let index = 0; index < typeSchema.length; index++) {
            values.push(decodeType(typeSchema.item, reader, `${label}[${index}]`));
        }
        return values;
    }
    if (typeSchema.kind === "vector") {
        const length = Number(decodeUnsignedInteger(reader.readBytes(4, `${label}.length`)));
        if (typeSchema.item === "u8") {
            return reader.readBytes(length, label);
        }
        const values: unknown[] = [];
        for (let index = 0; index < length; index++) {
            values.push(decodeType(typeSchema.item, reader, `${label}[${index}]`));
        }
        return values;
    }
    if (typeSchema.kind === "defined") {
        return decodeStruct(getDefinedTypeSchema(typeSchema.name), reader, label);
    }
    throw new Error("Unsupported type schema");
}

export function decodeStruct(
    structSchema: StructSchema,
    reader: BinaryReader,
    label = "struct",
): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (let index = 0, length = structSchema.fields.length; index < length; index++) {
        const field = structSchema.fields[index];
        if (field !== undefined) {
            values[field.name] = decodeType(field.type, reader, `${label}.${field.name}`);
        }
    }
    return values;
}

export function fieldSchemaByName(fields: readonly FieldSchema[], fieldName: string): FieldSchema {
    for (let index = 0, length = fields.length; index < length; index++) {
        const field = fields[index];
        if (field?.name === fieldName) {
            return field;
        }
    }
    throw new Error(`Unknown field: ${fieldName}`);
}

export function bytesToHex(bytes: Uint8Array): string {
    let hexadecimal = "";
    for (let index = 0, length = bytes.length; index < length; index++) {
        hexadecimal += (bytes[index] ?? 0).toString(16).padStart(2, "0");
    }
    return hexadecimal;
}

export function chanceryJsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Uint8Array) {
        return `0x${bytesToHex(value)}`;
    }
    return value;
}
