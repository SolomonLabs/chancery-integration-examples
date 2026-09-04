import {
    loadMintDirectOperation,
    prepareMarketMakerMint,
    preparedSettlementToDocument,
} from "../src/index.ts";

const operationFile = process.argv[2];
if (operationFile === undefined) {
    throw new Error(
        "Usage: prepare_mint_inventory.ts <direct-mint.operation.json>",
    );
}

const operation = loadMintDirectOperation(operationFile);
const settlement = prepareMarketMakerMint(operation);
process.stdout.write(
    `${JSON.stringify(preparedSettlementToDocument(settlement), null, 2)}\n`,
);
