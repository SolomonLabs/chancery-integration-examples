import {
    loadRedeemDirectOperation,
    prepareMarketMakerRedeem,
    preparedSettlementToDocument,
} from "../src/index.ts";

const operationFile = process.argv[2];
if (operationFile === undefined) {
    throw new Error(
        "Usage: prepare_redeem_inventory.ts <direct-redeem.operation.json>",
    );
}

const operation = loadRedeemDirectOperation(operationFile);
const settlement = prepareMarketMakerRedeem(operation);
process.stdout.write(
    `${JSON.stringify(preparedSettlementToDocument(settlement), null, 2)}\n`,
);
