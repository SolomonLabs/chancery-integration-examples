import assert from "node:assert/strict";
import pythonChancerySchemaValue from "../../python/chancery_reference/chancery.schema.json" with { type: "json" };
import test from "node:test";

import {
    CHANCERY_SCHEMA,
    decodeChanceryAccount,
    decodeChanceryEventData,
    decodeChanceryInstructionData,
    encodeChanceryAccount,
    encodeChanceryEventData,
    encodeChanceryInstructionData,
    getChanceryConstant,
    identifyChanceryAccount,
    lookupChanceryError,
    parseChanceryProgramError,
    resolveChanceryInstructionAccounts,
    ZERO_ADDRESS,
    zeroValueForType,
    type FieldSchema,
    type InstructionAccountInputs,
    type InstructionAccountSchema,
} from "../src/index.js";

function zeroStructValues(fields: readonly FieldSchema[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (let index = 0, length = fields.length; index < length; index++) {
        const field = fields[index];
        if (field !== undefined) {
            values[field.name] = zeroValueForType(field.type);
        }
    }
    return values;
}

function zeroAccountInputs(accounts: readonly InstructionAccountSchema[]): InstructionAccountInputs {
    const inputs: Record<string, string> = {};
    for (let index = 0, length = accounts.length; index < length; index++) {
        const account = accounts[index];
        if (account !== undefined && account.pda === undefined && account.default === undefined) {
            inputs[account.name] = ZERO_ADDRESS;
        }
    }
    return inputs;
}

test("the TypeScript and Python packages carry the same Chancery schema", () => {
    const pythonSchema: unknown = pythonChancerySchemaValue;
    assert.deepEqual(CHANCERY_SCHEMA, pythonSchema);
    assert.deepEqual(
        {
            instructions: Object.keys(CHANCERY_SCHEMA.instructions).length,
            accounts: Object.keys(CHANCERY_SCHEMA.accounts).length,
            events: Object.keys(CHANCERY_SCHEMA.events).length,
            types: Object.keys(CHANCERY_SCHEMA.types).length,
            constants: CHANCERY_SCHEMA.constants.length,
            errors: Object.keys(CHANCERY_SCHEMA.errors).length,
        },
        {
            instructions: 68,
            accounts: 22,
            events: 52,
            types: 1,
            constants: 390,
            errors: 219,
        },
    );
});

interface DiscriminatorSchema {
    readonly discriminator: readonly number[];
}

function assertUniqueDiscriminators(
    groupName: string,
    expectedLength: number,
    schemas: Readonly<Record<string, DiscriminatorSchema>>,
): void {
    const seen = new Set<string>();
    const schemaNames = Object.keys(schemas);
    for (let index = 0, length = schemaNames.length; index < length; index++) {
        const schemaName = schemaNames[index];
        if (schemaName === undefined) {
            continue;
        }
        const schema: DiscriminatorSchema | undefined = schemas[schemaName];
        assert.ok(schema !== undefined);
        assert.equal(schema.discriminator.length, expectedLength, `${groupName}.${schemaName}`);
        const key = schema.discriminator.join(":");
        assert.equal(seen.has(key), false, `${groupName} discriminator collision: ${schemaName}`);
        seen.add(key);
    }
}

test("wire discriminators are unique and have their declared lengths", () => {
    assertUniqueDiscriminators(
        "instruction",
        CHANCERY_SCHEMA.wire.instruction_discriminator_bytes,
        CHANCERY_SCHEMA.instructions,
    );
    assertUniqueDiscriminators(
        "account",
        CHANCERY_SCHEMA.wire.account_discriminator_bytes,
        CHANCERY_SCHEMA.accounts,
    );
    assertUniqueDiscriminators(
        "event",
        CHANCERY_SCHEMA.wire.event_discriminator_bytes,
        CHANCERY_SCHEMA.events,
    );
});

test("every Chancery instruction schema round-trips through the binary codec", () => {
    const instructionNames = Object.keys(CHANCERY_SCHEMA.instructions);
    for (let index = 0, length = instructionNames.length; index < length; index++) {
        const instructionName = instructionNames[index];
        if (instructionName === undefined) {
            continue;
        }
        const instructionSchema = CHANCERY_SCHEMA.instructions[instructionName];
        assert.ok(instructionSchema !== undefined);
        const encoded = encodeChanceryInstructionData(
            instructionName,
            zeroStructValues(instructionSchema.args),
        );
        const decoded = decodeChanceryInstructionData(encoded);
        assert.equal(decoded.name, instructionName);
        assert.deepEqual(
            encodeChanceryInstructionData(instructionName, decoded.arguments),
            encoded,
            instructionName,
        );
    }
});

test("every Chancery instruction resolves its complete ordered account-meta list", () => {
    const instructionNames = Object.keys(CHANCERY_SCHEMA.instructions);
    for (let index = 0, length = instructionNames.length; index < length; index++) {
        const instructionName = instructionNames[index];
        if (instructionName === undefined) {
            continue;
        }
        const instructionSchema = CHANCERY_SCHEMA.instructions[instructionName];
        assert.ok(instructionSchema !== undefined);
        const accountMetas = resolveChanceryInstructionAccounts(
            instructionName,
            zeroStructValues(instructionSchema.args),
            zeroAccountInputs(instructionSchema.accounts),
        );
        assert.equal(accountMetas.length, instructionSchema.accounts.length, instructionName);
        for (let accountIndex = 0, accountLength = accountMetas.length; accountIndex < accountLength; accountIndex++) {
            const accountMeta = accountMetas[accountIndex];
            const accountSchema: InstructionAccountSchema | undefined = instructionSchema.accounts[accountIndex];
            assert.ok(accountMeta !== undefined && accountSchema !== undefined);
            assert.equal(accountMeta.name, accountSchema.name, `${instructionName}[${accountIndex}].name`);
            assert.equal(accountMeta.isSigner, accountSchema.signer, `${instructionName}.${accountMeta.name}.signer`);
            assert.equal(
                accountMeta.isWritable,
                accountSchema.writable,
                `${instructionName}.${accountMeta.name}.writable`,
            );
            assert.notEqual(accountMeta.address.length, 0, `${instructionName}.${accountMeta.name}.address`);
        }
    }
});

test("every Chancery constant and program error is addressable", () => {
    for (let index = 0, length = CHANCERY_SCHEMA.constants.length; index < length; index++) {
        const constantSchema = CHANCERY_SCHEMA.constants[index];
        assert.ok(constantSchema !== undefined);
        assert.deepEqual(getChanceryConstant(constantSchema.name), constantSchema);
    }

    const errorCodes = Object.keys(CHANCERY_SCHEMA.errors);
    for (let index = 0, length = errorCodes.length; index < length; index++) {
        const encodedCode = errorCodes[index];
        assert.ok(encodedCode !== undefined);
        const errorSchema = CHANCERY_SCHEMA.errors[encodedCode];
        assert.ok(errorSchema !== undefined);
        const code = Number.parseInt(encodedCode, 10);
        const expected = {
            code,
            name: errorSchema.name,
            message: errorSchema.message,
        };
        assert.deepEqual(lookupChanceryError(code), expected);
        assert.deepEqual(parseChanceryProgramError(`custom program error: ${code}`), expected);
        assert.deepEqual(parseChanceryProgramError(`custom program error: 0x${code.toString(16)}`), expected);
    }
});

test("every Chancery account layout round-trips at its exact fixed size", () => {
    const accountNames = Object.keys(CHANCERY_SCHEMA.accounts);
    for (let index = 0, length = accountNames.length; index < length; index++) {
        const accountName = accountNames[index];
        if (accountName === undefined) {
            continue;
        }
        const accountSchema = CHANCERY_SCHEMA.accounts[accountName];
        assert.ok(accountSchema !== undefined);
        const encoded = encodeChanceryAccount(accountName, zeroStructValues(accountSchema.fields));
        assert.equal(encoded.length, accountSchema.size, accountName);
        assert.equal(identifyChanceryAccount(encoded), accountName);
        const decoded = decodeChanceryAccount(encoded);
        assert.equal(decoded.name, accountName);
        assert.deepEqual(encodeChanceryAccount(accountName, decoded.values), encoded, accountName);
    }
});

test("every Chancery event layout round-trips with and without its CPI prefix", () => {
    const eventNames = Object.keys(CHANCERY_SCHEMA.events);
    for (let index = 0, length = eventNames.length; index < length; index++) {
        const eventName = eventNames[index];
        if (eventName === undefined) {
            continue;
        }
        const eventSchema = CHANCERY_SCHEMA.events[eventName];
        assert.ok(eventSchema !== undefined);
        const values = zeroStructValues(eventSchema.fields);
        const prefixed = encodeChanceryEventData(eventName, values, true);
        const bare = encodeChanceryEventData(eventName, values, false);
        assert.equal(decodeChanceryEventData(prefixed).name, eventName);
        assert.equal(decodeChanceryEventData(bare).name, eventName);
        assert.deepEqual(
            encodeChanceryEventData(eventName, decodeChanceryEventData(prefixed).values, true),
            prefixed,
            eventName,
        );
    }
});
