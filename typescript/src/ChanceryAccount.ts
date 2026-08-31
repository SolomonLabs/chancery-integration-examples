import {
    BinaryReader,
    decodeBase64,
    decodeStruct,
    encodeStruct,
    type StructValues,
} from "./BinaryCodec.js";
import {
    CHANCERY_SCHEMA,
    getAccountSchema,
    type AccountSchema,
} from "./ChancerySchema.js";

export interface DecodedChanceryAccount {
    readonly name: string;
    readonly values: Record<string, unknown>;
}

function discriminatorEquals(data: Uint8Array, discriminator: readonly number[]): boolean {
    if (data.length < discriminator.length) {
        return false;
    }
    for (let index = 0, length = discriminator.length; index < length; index++) {
        if (data[index] !== discriminator[index]) {
            return false;
        }
    }
    return true;
}

function findAccountSchema(data: Uint8Array): [string, AccountSchema] {
    const accountNames = Object.keys(CHANCERY_SCHEMA.accounts);
    for (let index = 0, length = accountNames.length; index < length; index++) {
        const accountName = accountNames[index];
        if (accountName === undefined) {
            continue;
        }
        const accountSchema = CHANCERY_SCHEMA.accounts[accountName];
        if (accountSchema !== undefined && discriminatorEquals(data, accountSchema.discriminator)) {
            return [accountName, accountSchema];
        }
    }
    throw new Error("Unknown Chancery account discriminator");
}

export function identifyChanceryAccount(data: Uint8Array): string {
    return findAccountSchema(data)[0];
}

export function decodeChanceryAccount(data: Uint8Array): DecodedChanceryAccount {
    const [accountName, accountSchema] = findAccountSchema(data);
    if (data.length !== accountSchema.size) {
        throw new Error(
            `${accountName} requires exactly ${accountSchema.size} bytes; received ${data.length}`,
        );
    }
    const reader = new BinaryReader(data, CHANCERY_SCHEMA.wire.account_discriminator_bytes);
    const values = decodeStruct(accountSchema, reader, `accounts.${accountName}`);
    if (reader.remaining !== 0) {
        throw new Error(`${accountName} has ${reader.remaining} trailing bytes`);
    }
    return {
        name: accountName,
        values,
    };
}

export function decodeChanceryAccountBase64(encoded: string): DecodedChanceryAccount {
    return decodeChanceryAccount(decodeBase64(encoded));
}

export function encodeChanceryAccount(accountName: string, values: StructValues): Uint8Array {
    const accountSchema = getAccountSchema(accountName);
    const payload = encodeStruct(accountSchema, values, `accounts.${accountName}`, true);
    const data = new Uint8Array(accountSchema.discriminator.length + payload.length);
    data.set(accountSchema.discriminator, 0);
    data.set(payload, accountSchema.discriminator.length);
    if (data.length !== accountSchema.size) {
        throw new Error(
            `${accountName} encoded to ${data.length} bytes; expected ${accountSchema.size}`,
        );
    }
    return data;
}
