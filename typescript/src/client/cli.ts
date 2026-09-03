#!/usr/bin/env node
import { loadSolanaKeypairFile, type SolanaKeypair } from "../SolanaTransaction.js";
import {
    ChanceryClient,
    type SettlementOperationRequest,
    type SettlementTransactionRequest,
} from "./ChanceryClient.js";
import type { RpcCommitment } from "../ChanceryRpc.js";
import type { SettlementAction, SettlementMode } from "./ChanceryProtocol.js";

type OperationCommand = "inspect" | "quote-mint" | "mint" | "quote-redeem" | "redeem";
type Command = "discover" | "decode-transaction" | OperationCommand;

interface ParsedCommandLine {
    readonly command: Command;
    readonly options: ReadonlyMap<string, readonly string[]>;
}

async function main(): Promise<void> {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.length === 0 || argumentsList.includes("--help") || argumentsList.includes("-h")) {
        process.stdout.write(`${usageText()}\n`);
        return;
    }
    const parsed = parseCommandLine(argumentsList);
    const rpcEndpoint = requiredOption(parsed.options, "rpc");
    const commitment = parseCommitment(singleOption(parsed.options, "commitment") ?? "confirmed");
    const client = new ChanceryClient(rpcEndpoint, commitment);
    if (parsed.command === "discover") {
        const discovery = await client.discover();
        process.stdout.write(`${ChanceryClient.stringify(discovery)}\n`);
        return;
    }
    if (parsed.command === "decode-transaction") {
        const signature = requiredOption(parsed.options, "signature");
        const events = await client.decodeTransactionEvidence(signature);
        process.stdout.write(`${ChanceryClient.stringify(events)}\n`);
        return;
    }
    const action = commandAction(parsed.command, parsed.options);
    const mode = parseMode(singleOption(parsed.options, "mode") ?? "direct");
    const operationRequest = buildOperationRequest(parsed.options, action, mode);
    const inspection = await client.inspect(operationRequest);

    if (parsed.command === "inspect") {
        process.stdout.write(`${ChanceryClient.stringify(inspection)}\n`);
        if (!inspection.ready) {
            process.exitCode = 2;
        }
        return;
    }

    if (!inspection.ready) {
        process.stdout.write(`${ChanceryClient.stringify(inspection)}\n`);
        process.exitCode = 2;
        return;
    }

    const transactionRequest = buildTransactionRequest(parsed.options, commitment);
    if (parsed.command === "quote-mint" || parsed.command === "quote-redeem") {
        const quoted = await client.simulateTransaction(inspection, transactionRequest);
        process.stdout.write(`${ChanceryClient.stringify(quoted)}\n`);
        if (quoted.simulation.err !== null) {
            process.exitCode = 3;
        }
        return;
    }

    const submitted = await client.submitTransaction(inspection, transactionRequest);
    process.stdout.write(`${ChanceryClient.stringify(submitted)}\n`);
}

function parseCommandLine(argumentsList: readonly string[]): ParsedCommandLine {
    const commandValue = argumentsList[0];
    if (
        commandValue !== "discover"
        && commandValue !== "decode-transaction"
        && commandValue !== "inspect"
        && commandValue !== "quote-mint"
        && commandValue !== "mint"
        && commandValue !== "quote-redeem"
        && commandValue !== "redeem"
    ) {
        throw new Error(usageText());
    }
    const options = new Map<string, string[]>();
    for (let index = 1, length = argumentsList.length; index < length; index++) {
        const token = argumentsList[index];
        if (token === undefined || !token.startsWith("--") || token.length === 2) {
            throw new Error(`Expected --name value at argument ${index + 1}\n\n${usageText()}`);
        }
        const equalsIndex = token.indexOf("=");
        let name: string;
        let value: string;
        if (equalsIndex >= 0) {
            name = token.slice(2, equalsIndex);
            value = token.slice(equalsIndex + 1);
        } else {
            name = token.slice(2);
            const next = argumentsList[index + 1];
            if (next === undefined || next.startsWith("--")) {
                throw new Error(`Option --${name} requires a value`);
            }
            value = next;
            index++;
        }
        const existing = options.get(name);
        if (existing === undefined) {
            options.set(name, [value]);
        } else {
            existing.push(value);
        }
    }
    return { command: commandValue, options };
}

function commandAction(
    command: OperationCommand,
    options: ReadonlyMap<string, readonly string[]>,
): SettlementAction {
    if (command === "quote-mint" || command === "mint") {
        return "mint";
    }
    if (command === "quote-redeem" || command === "redeem") {
        return "redeem";
    }
    const action = requiredOption(options, "action");
    if (action !== "mint" && action !== "redeem") {
        throw new Error("--action must be mint or redeem");
    }
    return action;
}

function buildOperationRequest(
    options: ReadonlyMap<string, readonly string[]>,
    action: SettlementAction,
    mode: SettlementMode,
): SettlementOperationRequest {
    const request: {
        action: SettlementAction;
        mode: SettlementMode;
        assetMint: string;
        principal: string;
        amount?: bigint;
        minimumOutput?: bigint;
        pathwayId?: string;
        intentId?: string;
        executor?: string;
        principalB?: string;
        sourceTokenAccount?: string;
        destinationTokenAccount?: string;
        feeRecipientTokenAccount?: string;
        rentRefundRecipient?: string;
        nowUnixTimestamp?: bigint;
    } = {
        action,
        mode,
        assetMint: requiredOption(options, "asset-mint"),
        principal: requiredOption(options, "principal"),
    };
    assignBigIntegerOption(request, "amount", options, "amount");
    assignBigIntegerOption(request, "minimumOutput", options, "minimum-output");
    assignBigIntegerOption(request, "nowUnixTimestamp", options, "now-unix-timestamp");
    assignStringOption(request, "pathwayId", options, "pathway-id");
    assignStringOption(request, "intentId", options, "intent-id");
    assignStringOption(request, "executor", options, "executor");
    assignStringOption(request, "principalB", options, "principal-b");
    assignStringOption(request, "sourceTokenAccount", options, "source-token-account");
    assignStringOption(request, "destinationTokenAccount", options, "destination-token-account");
    assignStringOption(request, "feeRecipientTokenAccount", options, "fee-recipient-token-account");
    assignStringOption(request, "rentRefundRecipient", options, "rent-refund-recipient");
    return request;
}

function buildTransactionRequest(
    options: ReadonlyMap<string, readonly string[]>,
    commitment: RpcCommitment,
): SettlementTransactionRequest {
    const signerPaths = repeatedOption(options, "signer");
    if (signerPaths.length === 0) {
        throw new Error("At least one --signer <keypair.json> is required");
    }
    const keypairs: SolanaKeypair[] = [];
    for (let index = 0, length = signerPaths.length; index < length; index++) {
        const signerPath = signerPaths[index];
        if (signerPath !== undefined) {
            keypairs.push(loadSolanaKeypairFile(signerPath));
        }
    }
    const firstKeypair = keypairs[0];
    if (firstKeypair === undefined) {
        throw new Error("No signer keypairs were loaded");
    }
    const request: {
        feePayer: string;
        keypairs: readonly SolanaKeypair[];
        commitment: RpcCommitment;
        addressLookupTableAddresses?: readonly string[];
    } = {
        feePayer: singleOption(options, "fee-payer") ?? firstKeypair.publicKey,
        keypairs,
        commitment,
    };
    const lookupTables = repeatedOption(options, "lookup-table");
    if (lookupTables.length > 0) {
        request.addressLookupTableAddresses = lookupTables;
    }
    return request;
}

function assignStringOption<Target extends Record<string, unknown>>(
    target: Target,
    propertyName: keyof Target,
    options: ReadonlyMap<string, readonly string[]>,
    optionName: string,
): void {
    const value = singleOption(options, optionName);
    if (value !== undefined) {
        Object.defineProperty(target, propertyName, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
}

function assignBigIntegerOption<Target extends Record<string, unknown>>(
    target: Target,
    propertyName: keyof Target,
    options: ReadonlyMap<string, readonly string[]>,
    optionName: string,
): void {
    const value = singleOption(options, optionName);
    if (value !== undefined) {
        if (!/^[0-9]+$/.test(value)) {
            throw new Error(`--${optionName} must be an unsigned decimal integer`);
        }
        Object.defineProperty(target, propertyName, {
            value: BigInt(value),
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
}

function parseMode(value: string): SettlementMode {
    if (value === "direct" || value === "delegated" || value === "trilateral") {
        return value;
    }
    throw new Error("--mode must be direct, delegated, or trilateral");
}

function parseCommitment(value: string): RpcCommitment {
    if (value === "processed" || value === "confirmed" || value === "finalized") {
        return value;
    }
    throw new Error("--commitment must be processed, confirmed, or finalized");
}

function requiredOption(options: ReadonlyMap<string, readonly string[]>, name: string): string {
    const value = singleOption(options, name);
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing required option --${name}`);
    }
    return value;
}

function singleOption(
    options: ReadonlyMap<string, readonly string[]>,
    name: string,
): string | undefined {
    const values = options.get(name);
    if (values === undefined || values.length === 0) {
        return undefined;
    }
    if (values.length !== 1) {
        throw new Error(`Option --${name} may be supplied only once`);
    }
    return values[0];
}

function repeatedOption(
    options: ReadonlyMap<string, readonly string[]>,
    name: string,
): readonly string[] {
    return options.get(name) ?? [];
}

function usageText(): string {
    return [
        "Usage:",
        "  yarn cli:typescript discover --rpc <url>",
        "  yarn cli:typescript decode-transaction --rpc <url> --signature <signature>",
        "  yarn cli:typescript inspect --action mint|redeem ...",
        "  yarn cli:typescript quote-mint ...",
        "  yarn cli:typescript mint ...",
        "  yarn cli:typescript quote-redeem ...",
        "  yarn cli:typescript redeem ...",
        "",
        "Common options:",
        "  --rpc <url>",
        "  --commitment processed|confirmed|finalized",
        "  --signature <transaction-signature>  required by decode-transaction",
        "",
        "Operation options:",
        "  --action mint|redeem                  required by inspect",
        "  --asset-mint <public-key>",
        "  --principal <public-key>",
        "  --mode direct|delegated|trilateral   defaults to direct",
        "  --amount <raw-integer>                required for direct mode",
        "  --intent-id <32-byte-id>             required for delegated/trilateral mode",
        "",
        "Selection and account overrides:",
        "  --pathway-id <32-byte-id>",
        "  --minimum-output <raw-integer>",
        "  --executor <public-key>",
        "  --principal-b <public-key>",
        "  --source-token-account <public-key>",
        "  --destination-token-account <public-key>",
        "  --fee-recipient-token-account <public-key>",
        "  --rent-refund-recipient <public-key>",
        "  --now-unix-timestamp <raw-integer>",
        "",
        "Transaction options:",
        "  --signer <keypair.json>                repeat for every required signer",
        "  --fee-payer <public-key>               defaults to first signer",
        "  --lookup-table <public-key>            repeat for version-zero messages",
    ].join("\n");
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
