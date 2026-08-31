import { CHANCERY_SCHEMA, type ProgramErrorSchema } from "./ChancerySchema.js";

export interface ChanceryProgramError extends ProgramErrorSchema {
    readonly code: number;
}

export function lookupChanceryError(code: number): ChanceryProgramError | null {
    if (!Number.isInteger(code) || code < 0) {
        throw new Error("Program error code must be a non-negative integer");
    }
    const errorSchema = CHANCERY_SCHEMA.errors[String(code)];
    if (errorSchema === undefined) {
        return null;
    }
    return {
        code,
        name: errorSchema.name,
        message: errorSchema.message,
    };
}

export function parseChanceryProgramError(message: string): ChanceryProgramError | null {
    const hexadecimalMatch = /custom program error:\s*0x([0-9a-f]+)/i.exec(message);
    if (hexadecimalMatch?.[1] !== undefined) {
        return lookupChanceryError(Number.parseInt(hexadecimalMatch[1], 16));
    }
    const decimalMatch = /custom program error:\s*([0-9]+)/i.exec(message);
    if (decimalMatch?.[1] !== undefined) {
        return lookupChanceryError(Number.parseInt(decimalMatch[1], 10));
    }
    return null;
}
