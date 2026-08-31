import {
    ChanceryClient,
    type ChanceryEventOccurrence,
    type ChanceryStateDiscovery,
} from "../src/index.js";

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
}

function commaSeparatedValues(value: string | undefined): readonly string[] {
    if (value === undefined || value.trim().length === 0) {
        return [];
    }
    return value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

function summarizeDeployment(discovery: ChanceryStateDiscovery): Readonly<Record<string, unknown>> {
    const accountCountsByType: Record<string, number> = {};
    const typeNames = Object.keys(discovery.accountsByType);
    for (let index = 0, length = typeNames.length; index < length; index++) {
        const typeName = typeNames[index];
        if (typeName !== undefined) {
            accountCountsByType[typeName] = discovery.accountsByType[typeName]?.length ?? 0;
        }
    }
    return {
        programAddress: discovery.programAddress,
        commitment: discovery.commitment,
        accountCount: discovery.accountCount,
        accountCountsByType,
        unrecognizedAccountCount: discovery.unrecognizedAccounts.length,
        assetMints: discovery.assets.map((asset) => asset.assetMint),
        pathwayIds: discovery.pathways.map((pathway) => pathway.pathwayId),
    };
}

function summarizeEvidence(
    signature: string,
    occurrences: readonly ChanceryEventOccurrence[] | null,
): Readonly<Record<string, unknown>> {
    if (occurrences === null) {
        return { signature, evidence: null };
    }
    return {
        signature,
        eventCount: occurrences.length,
        events: occurrences.map((occurrence) => ({
            name: occurrence.event.name,
            parentInstructionIndex: occurrence.parentInstructionIndex,
            innerInstructionIndex: occurrence.innerInstructionIndex,
            values: occurrence.event.values,
        })),
    };
}

async function main(): Promise<void> {
    const rpcEndpoint = requiredEnvironmentVariable("RPC_URL");
    const client = new ChanceryClient(rpcEndpoint, "confirmed");

    const discovery = await client.discover();
    process.stdout.write(`${ChanceryClient.stringify(summarizeDeployment(discovery))}\n`);

    if (process.env.FULL_DISCOVERY === "true") {
        process.stdout.write(`${ChanceryClient.stringify(discovery)}\n`);
    }

    const signatures = commaSeparatedValues(process.env.TRANSACTION_SIGNATURES);
    for (let index = 0, length = signatures.length; index < length; index++) {
        const signature = signatures[index];
        if (signature === undefined) {
            continue;
        }
        const occurrences = await client.decodeTransactionEvidence(signature);
        process.stdout.write(`${ChanceryClient.stringify(summarizeEvidence(signature, occurrences))}\n`);
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
