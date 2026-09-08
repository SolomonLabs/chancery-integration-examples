import { ChanceryClient } from "../../../typescript/src/index.js";
import { buildOracleSnapshot } from "../src/OracleSnapshot.js";

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
}

async function main(): Promise<void> {
    const client = new ChanceryClient(
        requiredEnvironmentVariable("RPC_URL"),
        "confirmed",
    );
    const discovery = await client.discover();
    process.stdout.write(
        `${ChanceryClient.stringify(buildOracleSnapshot(discovery))}\n`,
    );
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});