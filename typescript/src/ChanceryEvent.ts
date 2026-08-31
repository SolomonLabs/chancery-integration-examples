import { decodeBase58, normalizePublicKey } from "./Base58Codec.js";
import {
    BinaryReader,
    decodeStruct,
    encodeStruct,
    type StructValues,
} from "./BinaryCodec.js";
import {
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    getEventSchema,
    type EventSchema,
} from "./ChancerySchema.js";

export interface DecodedChanceryEvent {
    readonly name: string;
    readonly values: Record<string, unknown>;
    readonly data: Uint8Array;
}

export interface ChanceryInnerInstruction {
    readonly programAddress: string;
    readonly accountAddresses: readonly string[];
    readonly data: Uint8Array;
    readonly parentInstructionIndex: number;
    readonly innerInstructionIndex: number;
    readonly stackHeight: number | null;
}

export interface ChanceryEventOccurrence {
    readonly event: DecodedChanceryEvent;
    readonly eventAuthority: string;
    readonly parentInstructionIndex: number;
    readonly innerInstructionIndex: number;
    readonly stackHeight: number | null;
}

function discriminatorEquals(
    data: Uint8Array,
    offset: number,
    discriminator: readonly number[],
): boolean {
    if (offset < 0 || data.length < offset + discriminator.length) {
        return false;
    }
    for (let index = 0, length = discriminator.length; index < length; index++) {
        if (data[offset + index] !== discriminator[index]) {
            return false;
        }
    }
    return true;
}

function eventPayloadOffset(data: Uint8Array): number {
    const prefix = CHANCERY_SCHEMA.wire.event_cpi_prefix;
    if (data.length < prefix.length) {
        return 0;
    }
    for (let index = 0, length = prefix.length; index < length; index++) {
        if (data[index] !== prefix[index]) {
            return 0;
        }
    }
    return prefix.length;
}

function isEventCpiData(data: Uint8Array): boolean {
    return eventPayloadOffset(data) === CHANCERY_SCHEMA.wire.event_cpi_prefix.length;
}

function findEventSchema(data: Uint8Array, discriminatorOffset: number): [string, EventSchema] {
    const eventNames = Object.keys(CHANCERY_SCHEMA.events);
    for (let index = 0, length = eventNames.length; index < length; index++) {
        const eventName = eventNames[index];
        if (eventName === undefined) {
            continue;
        }
        const eventSchema = CHANCERY_SCHEMA.events[eventName];
        if (
            eventSchema !== undefined &&
            discriminatorEquals(data, discriminatorOffset, eventSchema.discriminator)
        ) {
            return [eventName, eventSchema];
        }
    }
    throw new Error("Unknown Chancery event discriminator");
}

function recordFromUnknown(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function safeUnsignedInteger(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a safe unsigned integer`);
    }
    return value;
}

function rpcPublicKey(value: unknown, label: string): string {
    if (typeof value === "string") {
        return normalizePublicKey(value);
    }
    const record = recordFromUnknown(value, label);
    if (typeof record.pubkey !== "string") {
        throw new Error(`${label} must be a public-key string or object with a public-key field`);
    }
    return normalizePublicKey(record.pubkey);
}

function appendRpcPublicKeys(
    destination: string[],
    source: unknown,
    label: string,
): void {
    if (!Array.isArray(source)) {
        throw new Error(`${label} must be an array`);
    }
    for (let index = 0, length = source.length; index < length; index++) {
        destination.push(rpcPublicKey(source[index], `${label}[${index}]`));
    }
}

function rpcAccountKeys(
    transactionRecord: Readonly<Record<string, unknown>>,
    metaRecord: Readonly<Record<string, unknown>>,
): readonly string[] {
    const transaction = recordFromUnknown(transactionRecord.transaction, "transaction");
    const message = recordFromUnknown(transaction.message, "transaction.message");
    const staticSource = Array.isArray(message.staticAccountKeys)
        ? message.staticAccountKeys
        : message.accountKeys;
    const accountKeys: string[] = [];
    appendRpcPublicKeys(accountKeys, staticSource, "transaction.message.accountKeys");

    if (metaRecord.loadedAddresses !== undefined && metaRecord.loadedAddresses !== null) {
        const loadedAddresses = recordFromUnknown(metaRecord.loadedAddresses, "meta.loadedAddresses");
        appendRpcPublicKeys(
            accountKeys,
            loadedAddresses.writable ?? [],
            "meta.loadedAddresses.writable",
        );
        appendRpcPublicKeys(
            accountKeys,
            loadedAddresses.readonly ?? [],
            "meta.loadedAddresses.readonly",
        );
    }
    return accountKeys;
}

function instructionAccountAddresses(
    accountIndexesValue: unknown,
    accountKeys: readonly string[],
    label: string,
): readonly string[] {
    if (!Array.isArray(accountIndexesValue)) {
        throw new Error(`${label} must be an array`);
    }
    const addresses: string[] = [];
    for (let index = 0, length = accountIndexesValue.length; index < length; index++) {
        const accountIndex = safeUnsignedInteger(accountIndexesValue[index], `${label}[${index}]`);
        const address = accountKeys[accountIndex];
        if (address === undefined) {
            throw new Error(`${label}[${index}] references an unavailable account key`);
        }
        addresses.push(address);
    }
    return addresses;
}

export function decodeChanceryEventData(data: Uint8Array): DecodedChanceryEvent {
    const discriminatorOffset = eventPayloadOffset(data);
    const [eventName, eventSchema] = findEventSchema(data, discriminatorOffset);
    const reader = new BinaryReader(
        data,
        discriminatorOffset + CHANCERY_SCHEMA.wire.event_discriminator_bytes,
    );
    const values = decodeStruct(eventSchema, reader, `events.${eventName}`);
    if (reader.remaining !== 0) {
        throw new Error(`${eventName} has ${reader.remaining} trailing bytes`);
    }
    return {
        name: eventName,
        values,
        data: new Uint8Array(data),
    };
}

export function encodeChanceryEventData(
    eventName: string,
    values: StructValues,
    includeCpiPrefix = true,
): Uint8Array {
    const eventSchema = getEventSchema(eventName);
    const payload = encodeStruct(eventSchema, values, `events.${eventName}`);
    const prefix = includeCpiPrefix
        ? new Uint8Array(CHANCERY_SCHEMA.wire.event_cpi_prefix)
        : new Uint8Array(0);
    const data = new Uint8Array(prefix.length + eventSchema.discriminator.length + payload.length);
    data.set(prefix, 0);
    data.set(eventSchema.discriminator, prefix.length);
    data.set(payload, prefix.length + eventSchema.discriminator.length);
    return data;
}

export function decodeChanceryEventsFromInnerInstructions(
    innerInstructions: readonly ChanceryInnerInstruction[],
): readonly ChanceryEventOccurrence[] {
    const canonicalEventAuthority = CHANCERY_SCHEMA.known_pdas.event_authority?.address;
    if (canonicalEventAuthority === undefined) {
        throw new Error("Chancery event-authority metadata is unavailable");
    }

    const events: ChanceryEventOccurrence[] = [];
    for (let index = 0, length = innerInstructions.length; index < length; index++) {
        const innerInstruction = innerInstructions[index];
        if (
            innerInstruction === undefined ||
            normalizePublicKey(innerInstruction.programAddress) !== CHANCERY_PROGRAM_ADDRESS ||
            !isEventCpiData(innerInstruction.data)
        ) {
            continue;
        }
        const eventAuthorityInput: string | undefined = innerInstruction.accountAddresses[0];
        if (
            eventAuthorityInput === undefined ||
            normalizePublicKey(eventAuthorityInput) !== canonicalEventAuthority
        ) {
            continue;
        }
        try {
            events.push({
                event: decodeChanceryEventData(innerInstruction.data),
                eventAuthority: canonicalEventAuthority,
                parentInstructionIndex: innerInstruction.parentInstructionIndex,
                innerInstructionIndex: innerInstruction.innerInstructionIndex,
                stackHeight: innerInstruction.stackHeight,
            });
        } catch (error: unknown) {
            if (!(error instanceof Error) || !error.message.startsWith("Unknown Chancery event discriminator")) {
                throw error;
            }
        }
    }
    return events;
}

export function extractChanceryInnerInstructionsFromRpcTransaction(
    result: unknown,
): readonly ChanceryInnerInstruction[] {
    const resultRecord = recordFromUnknown(result, "getTransaction result");
    const metaRecord = recordFromUnknown(resultRecord.meta, "getTransaction result.meta");
    if (metaRecord.err !== undefined && metaRecord.err !== null) {
        throw new Error("Cannot extract canonical Chancery events from a failed transaction");
    }
    if (metaRecord.innerInstructions === undefined || metaRecord.innerInstructions === null) {
        return [];
    }
    if (!Array.isArray(metaRecord.innerInstructions)) {
        throw new Error("getTransaction result.meta.innerInstructions must be an array or null");
    }

    const accountKeys = rpcAccountKeys(resultRecord, metaRecord);
    const innerInstructions: ChanceryInnerInstruction[] = [];
    for (
        let groupIndex = 0, groupLength = metaRecord.innerInstructions.length;
        groupIndex < groupLength;
        groupIndex++
    ) {
        const group = recordFromUnknown(
            metaRecord.innerInstructions[groupIndex],
            `meta.innerInstructions[${groupIndex}]`,
        );
        const parentInstructionIndex = safeUnsignedInteger(
            group.index,
            `meta.innerInstructions[${groupIndex}].index`,
        );
        if (!Array.isArray(group.instructions)) {
            throw new Error(`meta.innerInstructions[${groupIndex}].instructions must be an array`);
        }
        for (
            let instructionIndex = 0, instructionLength = group.instructions.length;
            instructionIndex < instructionLength;
            instructionIndex++
        ) {
            const instruction = recordFromUnknown(
                group.instructions[instructionIndex],
                `meta.innerInstructions[${groupIndex}].instructions[${instructionIndex}]`,
            );
            const programIdIndex = safeUnsignedInteger(
                instruction.programIdIndex,
                `meta.innerInstructions[${groupIndex}].instructions[${instructionIndex}].programIdIndex`,
            );
            const programAddress = accountKeys[programIdIndex];
            if (programAddress === undefined) {
                throw new Error("Inner instruction programIdIndex references an unavailable account key");
            }
            if (programAddress !== CHANCERY_PROGRAM_ADDRESS) {
                continue;
            }
            if (typeof instruction.data !== "string") {
                throw new Error("Chancery inner instruction data must be a base58 string");
            }
            let stackHeight: number | null = null;
            if (instruction.stackHeight !== undefined && instruction.stackHeight !== null) {
                stackHeight = safeUnsignedInteger(
                    instruction.stackHeight,
                    `meta.innerInstructions[${groupIndex}].instructions[${instructionIndex}].stackHeight`,
                );
            }
            innerInstructions.push({
                programAddress,
                accountAddresses: instructionAccountAddresses(
                    instruction.accounts,
                    accountKeys,
                    `meta.innerInstructions[${groupIndex}].instructions[${instructionIndex}].accounts`,
                ),
                data: decodeBase58(instruction.data),
                parentInstructionIndex,
                innerInstructionIndex: instructionIndex,
                stackHeight,
            });
        }
    }
    return innerInstructions;
}

export function decodeChanceryEventsFromRpcTransaction(
    result: unknown,
): readonly ChanceryEventOccurrence[] {
    return decodeChanceryEventsFromInnerInstructions(
        extractChanceryInnerInstructionsFromRpcTransaction(result),
    );
}
