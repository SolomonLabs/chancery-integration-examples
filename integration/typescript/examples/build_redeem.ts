import {
    buildRedeemDirectInstruction,
    loadRedeemDirectOperation,
    serializeInstruction,
} from "../src/index.ts";

const operationFile = process.argv[2];
if (operationFile === undefined) {
    throw new Error("Usage: build_redeem.ts <direct-redeem.operation.json>");
}

const operation = loadRedeemDirectOperation(operationFile);
const instruction = buildRedeemDirectInstruction(operation);
process.stdout.write(serializeInstruction(instruction));
