import {
    ChanceryClient,
    loadSolanaKeypairFile,
    type SettlementOperationRequest,
    type SettlementTransactionRequest,
    type SettlementAction,
    type SettlementMode,
} from "../src/index.js";

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
}

function parseAction(value: string): SettlementAction {
    if (value === "mint" || value === "redeem") {
        return value;
    }
    throw new Error("ACTION must be mint or redeem");
}

function parseMode(value: string): SettlementMode {
    if (value === "direct" || value === "delegated" || value === "trilateral") {
        return value;
    }
    throw new Error("MODE must be direct, delegated, or trilateral");
}

function parseUnsignedInteger(value: string, name: string): bigint {
    if (!/^[0-9]+$/.test(value)) {
        throw new Error(`${name} must be a raw unsigned integer`);
    }
    return BigInt(value);
}

function commaSeparatedValues(value: string | undefined): readonly string[] {
    if (value === undefined || value.trim().length === 0) {
        return [];
    }
    return value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

async function main(): Promise<void> {
    const rpcEndpoint = requiredEnvironmentVariable("RPC_URL");
    const chanceryClient = new ChanceryClient(rpcEndpoint, "confirmed");

    const action = parseAction(requiredEnvironmentVariable("ACTION"));
    const mode = parseMode(process.env.MODE ?? "direct");
    const assetMint = requiredEnvironmentVariable("ASSET_MINT");
    const principal = requiredEnvironmentVariable("PRINCIPAL");
    const signerPaths = commaSeparatedValues(requiredEnvironmentVariable("KEYPAIR_PATHS"));
    const keypairs = signerPaths.map((path) => loadSolanaKeypairFile(path));
    const firstKeypair = keypairs[0];
    if (firstKeypair === undefined) {
        throw new Error("KEYPAIR_PATHS did not contain a keypair path");
    }

    const commonRequest = {
        action,
        mode,
        assetMint,
        principal,
        ...(process.env.PATHWAY_ID === undefined ? {} : { pathwayId: process.env.PATHWAY_ID }),
        ...(process.env.MINIMUM_OUTPUT === undefined
            ? {}
            : { minimumOutput: parseUnsignedInteger(process.env.MINIMUM_OUTPUT, "MINIMUM_OUTPUT") }),
        ...(process.env.EXECUTOR === undefined ? {} : { executor: process.env.EXECUTOR }),
        ...(process.env.PRINCIPAL_B === undefined ? {} : { principalB: process.env.PRINCIPAL_B }),
        ...(process.env.SOURCE_TOKEN_ACCOUNT === undefined
            ? {}
            : { sourceTokenAccount: process.env.SOURCE_TOKEN_ACCOUNT }),
        ...(process.env.DESTINATION_TOKEN_ACCOUNT === undefined
            ? {}
            : { destinationTokenAccount: process.env.DESTINATION_TOKEN_ACCOUNT }),
        ...(process.env.FEE_RECIPIENT_TOKEN_ACCOUNT === undefined
            ? {}
            : { feeRecipientTokenAccount: process.env.FEE_RECIPIENT_TOKEN_ACCOUNT }),
    };
    const request: SettlementOperationRequest = mode === "direct"
        ? {
            ...commonRequest,
            amount: parseUnsignedInteger(requiredEnvironmentVariable("AMOUNT"), "AMOUNT"),
        }
        : {
            ...commonRequest,
            intentId: requiredEnvironmentVariable("INTENT_ID"),
        };

    const inspection = await chanceryClient.inspect(request);
    process.stdout.write(`${ChanceryClient.stringify(inspection)}\n`);
    if (!inspection.ready) {
        process.exitCode = 2;
        return;
    }

    const lookupTableAddresses = commaSeparatedValues(process.env.LOOKUP_TABLES);
    const transactionRequest: SettlementTransactionRequest = {
        feePayer: process.env.FEE_PAYER ?? firstKeypair.publicKey,
        keypairs,
        commitment: "confirmed",
        ...(lookupTableAddresses.length === 0 ? {} : { addressLookupTableAddresses: lookupTableAddresses }),
    };
    const simulation = await chanceryClient.simulateTransaction(inspection, transactionRequest);
    process.stdout.write(`${ChanceryClient.stringify(simulation)}\n`);

    if (process.env.SUBMIT === "true" && simulation.simulation.err === null) {
        const submitted = await chanceryClient.submitTransaction(inspection, transactionRequest);
        process.stdout.write(`${ChanceryClient.stringify(submitted)}\n`);
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
