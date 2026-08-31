import chancerySchemaValue from "../chancery.schema.json" with { type: "json" };

export type PrimitiveTypeName =
    | "u8"
    | "u16"
    | "u32"
    | "u64"
    | "u128"
    | "i64"
    | "i128"
    | "bool"
    | "pubkey";

export interface ArrayTypeSchema {
    readonly kind: "array";
    readonly item: TypeSchema;
    readonly length: number;
}

export interface OptionTypeSchema {
    readonly kind: "option";
    readonly item: TypeSchema;
}

export interface VectorTypeSchema {
    readonly kind: "vector";
    readonly item: TypeSchema;
}

export interface DefinedTypeSchema {
    readonly kind: "defined";
    readonly name: string;
}

export type TypeSchema =
    | PrimitiveTypeName
    | ArrayTypeSchema
    | OptionTypeSchema
    | VectorTypeSchema
    | DefinedTypeSchema;

export interface FieldSchema {
    readonly name: string;
    readonly type: TypeSchema;
}

export interface StructSchema {
    readonly fields: readonly FieldSchema[];
}

export interface PdaConstSeedSchema {
    readonly kind: "const";
    readonly bytes: readonly number[];
}

export interface PdaArgumentSeedSchema {
    readonly kind: "argument";
    readonly name: string;
}

export interface PdaAccountSeedSchema {
    readonly kind: "account";
    readonly name: string;
}

export type PdaSeedSchema =
    | PdaConstSeedSchema
    | PdaArgumentSeedSchema
    | PdaAccountSeedSchema;

export interface PdaSchema {
    readonly seeds: readonly PdaSeedSchema[];
}

export interface InstructionAccountDefaultSchema {
    readonly kind: "known_pda" | "program_address" | "system_program" | "zero_address";
    readonly name?: string;
}

export interface InstructionAccountSchema {
    readonly name: string;
    readonly writable: boolean;
    readonly signer: boolean;
    readonly optional: boolean;
    readonly relations?: readonly string[];
    readonly pda?: PdaSchema;
    readonly default?: InstructionAccountDefaultSchema;
}

export interface InstructionSchema {
    readonly discriminator: readonly number[];
    readonly accounts: readonly InstructionAccountSchema[];
    readonly args: readonly FieldSchema[];
}

export interface AccountSchema extends StructSchema {
    readonly discriminator: readonly number[];
    readonly size: number;
}

export interface EventSchema extends StructSchema {
    readonly discriminator: readonly number[];
}

export interface KnownPdaSchema {
    readonly seeds: readonly (readonly number[])[];
    readonly address: string;
}

export interface ConstantSchema {
    readonly name: string;
    readonly type: TypeSchema;
    readonly value: string;
}

export interface ProgramErrorSchema {
    readonly name: string;
    readonly message: string;
}

export interface ChancerySchema {
    readonly schema_version: number;
    readonly program: {
        readonly name: string;
        readonly version: string;
        readonly address: string;
        readonly description: string;
    };
    readonly wire: {
        readonly byte_order: "little_endian";
        readonly instruction_discriminator_bytes: number;
        readonly account_discriminator_bytes: number;
        readonly event_discriminator_bytes: number;
        readonly event_cpi_prefix: readonly number[];
        readonly public_key_bytes: number;
        readonly zero_address: string;
        readonly system_program: string;
    };
    readonly known_pdas: Readonly<Record<string, KnownPdaSchema>>;
    readonly instructions: Readonly<Record<string, InstructionSchema>>;
    readonly accounts: Readonly<Record<string, AccountSchema>>;
    readonly events: Readonly<Record<string, EventSchema>>;
    readonly types: Readonly<Record<string, StructSchema>>;
    readonly constants: readonly ConstantSchema[];
    readonly errors: Readonly<Record<string, ProgramErrorSchema>>;
}

function loadSchema(): ChancerySchema {
    const schemaValue: unknown = chancerySchemaValue;
    if (typeof schemaValue !== "object" || schemaValue === null) {
        throw new Error("Chancery schema root must be an object");
    }
    return schemaValue as ChancerySchema;
}

export const CHANCERY_SCHEMA = loadSchema();
export const CHANCERY_PROGRAM_ADDRESS = CHANCERY_SCHEMA.program.address;
export const ZERO_ADDRESS = CHANCERY_SCHEMA.wire.zero_address;
export const SYSTEM_PROGRAM_ADDRESS = CHANCERY_SCHEMA.wire.system_program;

export function getInstructionSchema(instructionName: string): InstructionSchema {
    const instructionSchema = CHANCERY_SCHEMA.instructions[instructionName];
    if (instructionSchema === undefined) {
        throw new Error(`Unknown Chancery instruction: ${instructionName}`);
    }
    return instructionSchema;
}

export function getAccountSchema(accountName: string): AccountSchema {
    const accountSchema = CHANCERY_SCHEMA.accounts[accountName];
    if (accountSchema === undefined) {
        throw new Error(`Unknown Chancery account: ${accountName}`);
    }
    return accountSchema;
}

export function getEventSchema(eventName: string): EventSchema {
    const eventSchema = CHANCERY_SCHEMA.events[eventName];
    if (eventSchema === undefined) {
        throw new Error(`Unknown Chancery event: ${eventName}`);
    }
    return eventSchema;
}

export function getDefinedTypeSchema(typeName: string): StructSchema {
    const typeSchema = CHANCERY_SCHEMA.types[typeName];
    if (typeSchema === undefined) {
        throw new Error(`Unknown Chancery defined type: ${typeName}`);
    }
    return typeSchema;
}

export function getChanceryConstant(constantName: string): ConstantSchema {
    for (let index = 0, length = CHANCERY_SCHEMA.constants.length; index < length; index++) {
        const constantSchema = CHANCERY_SCHEMA.constants[index];
        if (constantSchema?.name === constantName) {
            return constantSchema;
        }
    }
    throw new Error(`Unknown Chancery constant: ${constantName}`);
}
