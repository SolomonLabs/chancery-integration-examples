import type { InstructionDocument, InstructionSpec } from "./model.ts";

export function instructionToDocument(instruction: InstructionSpec): InstructionDocument {
    const data = Buffer.from(
        instruction.data.buffer,
        instruction.data.byteOffset,
        instruction.data.byteLength,
    );
    return {
        programId: instruction.programId,
        accounts: instruction.accounts,
        dataBase64: data.toString("base64"),
        dataHex: data.toString("hex"),
    };
}

export function serializeInstruction(instruction: InstructionSpec): string {
    return `${JSON.stringify(instructionToDocument(instruction), null, 2)}\n`;
}
