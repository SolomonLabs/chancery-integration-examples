import {
    buildMintDirectInstruction,
    loadMintDirectOperation,
    serializeInstruction,
} from "../src/index.ts";

const operationFile = process.argv[2];
if (operationFile === undefined) {
    throw new Error("Usage: build_mint.ts <direct-mint.operation.json>");
}

const operation = loadMintDirectOperation(operationFile);
const instruction = buildMintDirectInstruction(operation);
process.stdout.write(serializeInstruction(instruction));
