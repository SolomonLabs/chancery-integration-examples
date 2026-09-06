import { parseArgs } from "node:util";
import { DEVNET_RPC_URL } from "../configuration/Deployment.js";

export type DevnetCommand = "wallet" | "fund" | "setup" | "faucet" | "pathway" | "grant" | "operation" | "admin" | "addresses";

export interface DevnetArguments {
    readonly command: DevnetCommand;
    readonly keypair: string;
    readonly rpc: string;
    readonly symbol: string;
    readonly amount?: bigint;
    readonly lamports: bigint;
    readonly skipAirdrop: boolean;
    readonly subject?: string;
    readonly pathwayId?: string;
    readonly roles: readonly string[];
    readonly scopeKind: number;
    readonly scopeKey?: string;
    readonly expiry?: bigint;
    readonly action: "mint" | "redeem";
    readonly minimumOutput?: bigint;
    readonly output?: string;
    readonly instruction?: string;
    readonly argumentsFile?: string;
    readonly accountsFile?: string;
    readonly schedule: boolean;
}

const COMMAND_OPTIONS: Readonly<Record<DevnetCommand, readonly string[]>> = {
    wallet: ["keypair"],
    fund: ["keypair", "rpc", "lamports", "skip-airdrop"],
    setup: ["keypair", "rpc", "symbol", "amount", "pathway-id"],
    faucet: ["keypair", "rpc", "symbol", "amount", "subject"],
    pathway: ["keypair", "rpc", "symbol", "pathway-id"],
    grant: ["keypair", "rpc", "symbol", "pathway-id", "subject", "roles", "scope-kind", "scope-key", "expiry"],
    operation: ["keypair", "rpc", "symbol", "amount", "pathway-id", "action", "minimum-output", "output"],
    admin: ["keypair", "rpc", "instruction", "arguments", "accounts", "schedule"],
    addresses: ["keypair", "rpc"],
};

function unsignedOption(value: string, name: string): bigint {
    if (!/^[0-9]+$/.test(value)) throw new Error("--" + name + " must be an unsigned decimal integer");
    const number = BigInt(value);
    if (number > (1n << 64n) - 1n) throw new Error("--" + name + " exceeds u64");
    return number;
}

export function parseDevnetArguments(argumentsList: readonly string[]): DevnetArguments {
    const command = argumentsList[0];
    switch (command) {
        case "wallet": case "fund": case "setup": case "faucet": case "pathway": case "grant": case "operation": case "admin": case "addresses": break;
        default: throw new Error("Expected wallet, fund, setup, faucet, pathway, grant, operation, admin, or addresses");
    }
    const parsed = parseArgs({ args: argumentsList.slice(1), strict: true, allowPositionals: false, tokens: true, options: {
        keypair: { type: "string" }, rpc: { type: "string" }, symbol: { type: "string" }, amount: { type: "string" },
        lamports: { type: "string" }, "skip-airdrop": { type: "boolean" }, subject: { type: "string" }, "pathway-id": { type: "string" },
        roles: { type: "string" }, "scope-kind": { type: "string" }, "scope-key": { type: "string" }, expiry: { type: "string" },
        action: { type: "string" }, "minimum-output": { type: "string" }, output: { type: "string" },
        instruction: { type: "string" }, arguments: { type: "string" }, accounts: { type: "string" }, schedule: { type: "boolean" },
    } });
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
        if (token.kind !== "option") continue;
        if (!COMMAND_OPTIONS[command].includes(token.name)) throw new Error("Option --" + token.name + " does not apply to " + command);
        if (seen.has(token.name)) throw new Error("Option --" + token.name + " may be supplied only once");
        seen.add(token.name);
    }
    const values = parsed.values;
    const action = values.action ?? "mint";
    if (action !== "mint" && action !== "redeem") throw new Error("--action must be mint or redeem");
    const scopeKind = unsignedOption(values["scope-kind"] ?? "2", "scope-kind");
    if (scopeKind > 255n) throw new Error("--scope-kind exceeds u8");
    if (command === "operation" && values.amount === undefined) throw new Error("operation requires --amount in base units");
    if (command === "admin" && (values.instruction === undefined || values.arguments === undefined || values.accounts === undefined)) {
        throw new Error("admin requires --instruction, --arguments, and --accounts");
    }
    const amount = values.amount === undefined ? undefined : unsignedOption(values.amount, "amount");
    if (amount === 0n) throw new Error("--amount must be positive");
    return {
        command, keypair: values.keypair ?? ".devnet/tester/keypair.json", rpc: values.rpc ?? process.env.RPC_URL ?? DEVNET_RPC_URL,
        symbol: values.symbol ?? "USDC", lamports: unsignedOption(values.lamports ?? "100000000", "lamports"),
        skipAirdrop: values["skip-airdrop"] ?? false, roles: (values.roles ?? "CAN_MINT_DIRECT,CAN_REDEEM_DIRECT").split(","),
        scopeKind: Number(scopeKind), action, schedule: values.schedule ?? false,
        ...(amount === undefined ? {} : { amount }), ...(values.subject === undefined ? {} : { subject: values.subject }),
        ...(values["pathway-id"] === undefined ? {} : { pathwayId: values["pathway-id"] }),
        ...(values["scope-key"] === undefined ? {} : { scopeKey: values["scope-key"] }),
        ...(values.expiry === undefined ? {} : { expiry: unsignedOption(values.expiry, "expiry") }),
        ...(values["minimum-output"] === undefined ? {} : { minimumOutput: unsignedOption(values["minimum-output"], "minimum-output") }),
        ...(values.output === undefined ? {} : { output: values.output }),
        ...(values.instruction === undefined ? {} : { instruction: values.instruction }),
        ...(values.arguments === undefined ? {} : { argumentsFile: values.arguments }),
        ...(values.accounts === undefined ? {} : { accountsFile: values.accounts }),
    };
}
