#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configArgument = process.argv[2];
if (configArgument === undefined || process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write([
        "Usage:",
        "  node integration/RunDirectSettlement.mjs <configuration.json>",
        "",
        "The configuration executes TypeScript mint/redeem and Python mint/redeem,",
        "then decodes each confirmed transaction with the other implementation.",
    ].join("\n") + "\n");
    process.exit(configArgument === undefined ? 1 : 0);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(configArgument);
const configDirectory = dirname(configPath);
const config = JSON.parse(readFileSync(configPath, "utf8"));

function requiredString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${label} must be a nonempty string`);
    }
    return value;
}

function optionalString(value, label) {
    if (value === undefined || value === null) {
        return undefined;
    }
    return requiredString(value, label);
}

function resolveConfigPath(value, label) {
    const pathValue = requiredString(value, label);
    return isAbsolute(pathValue) ? pathValue : resolve(configDirectory, pathValue);
}

function runJson(command, argumentsList, environment = {}) {
    const result = spawnSync(command, argumentsList, {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error([
            `Command failed with status ${result.status}: ${command} ${argumentsList.join(" ")}`,
            result.stdout,
            result.stderr,
        ].filter(Boolean).join("\n"));
    }
    const output = result.stdout.trim();
    if (output.length === 0) {
        throw new Error(`Command returned no JSON: ${command} ${argumentsList.join(" ")}`);
    }
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`Command returned invalid JSON: ${output}`, { cause: error });
    }
}

const rpc = requiredString(config.rpc, "rpc");
const commitment = optionalString(config.commitment, "commitment") ?? "confirmed";
const assetMint = requiredString(config.assetMint, "assetMint");
const principal = requiredString(config.principal, "principal");
const pathwayId = optionalString(config.pathwayId, "pathwayId");
const feePayer = optionalString(config.feePayer, "feePayer");
const signerPaths = Array.isArray(config.signers)
    ? config.signers.map((value, index) => resolveConfigPath(value, `signers[${index}]`))
    : [];
if (signerPaths.length === 0) {
    throw new Error("signers must contain at least one keypair path");
}
const lookupTables = Array.isArray(config.lookupTables)
    ? config.lookupTables.map((value, index) => requiredString(value, `lookupTables[${index}]`))
    : [];
const operations = config.operations;
if (!Array.isArray(operations) || operations.length !== 4) {
    throw new Error("operations must contain exactly four direct operations");
}
const expectedOperations = [
    ["typescript", "mint"],
    ["typescript", "redeem"],
    ["python", "mint"],
    ["python", "redeem"],
];

function commonOperationArguments(operation, action) {
    const amount = requiredString(operation.amount, `${action} amount`);
    if (!/^[0-9]+$/.test(amount)) {
        throw new Error(`${action} amount must be an unsigned decimal integer`);
    }
    const minimumOutput = optionalString(operation.minimumOutput, `${action} minimumOutput`);
    const argumentsList = [
        action,
        "--rpc", rpc,
        "--commitment", commitment,
        "--asset-mint", optionalString(operation.assetMint, "operation assetMint") ?? assetMint,
        "--principal", optionalString(operation.principal, "operation principal") ?? principal,
        "--mode", "direct",
        "--amount", amount,
    ];
    const operationPathwayId = optionalString(operation.pathwayId, "operation pathwayId") ?? pathwayId;
    if (operationPathwayId !== undefined) {
        argumentsList.push("--pathway-id", operationPathwayId);
    }
    if (minimumOutput !== undefined) {
        if (!/^[0-9]+$/.test(minimumOutput)) {
            throw new Error(`${action} minimumOutput must be an unsigned decimal integer`);
        }
        argumentsList.push("--minimum-output", minimumOutput);
    }
    if (feePayer !== undefined) {
        argumentsList.push("--fee-payer", feePayer);
    }
    for (const signerPath of signerPaths) {
        argumentsList.push("--signer", signerPath);
    }
    for (const lookupTable of lookupTables) {
        argumentsList.push("--lookup-table", lookupTable);
    }
    return argumentsList;
}

function runTypeScript(argumentsList) {
    const executable = optionalString(config.nodeExecutable, "nodeExecutable") ?? process.execPath;
    return runJson(executable, ["--import", "tsx", "typescript/src/client/cli.ts", ...argumentsList]);
}

function runPython(argumentsList) {
    const executable = optionalString(config.pythonExecutable, "pythonExecutable") ?? "python";
    return runJson(
        executable,
        ["-m", "chancery_reference.cli", ...argumentsList],
        { PYTHONPATH: resolve(repositoryRoot, "python") },
    );
}

function decodeWithTypeScript(signature) {
    return runTypeScript(["decode-transaction", "--rpc", rpc, "--commitment", commitment, "--signature", signature]);
}

function decodeWithPython(signature) {
    return runPython(["decode-transaction", "--rpc", rpc, "--commitment", commitment, "--signature", signature]);
}

const results = [];
for (let index = 0; index < expectedOperations.length; index++) {
    const operation = operations[index];
    const [expectedSubmitter, expectedAction] = expectedOperations[index];
    if (operation.submitter !== expectedSubmitter || operation.action !== expectedAction) {
        throw new Error(
            `operations[${index}] must be ${expectedSubmitter} ${expectedAction}`,
        );
    }
    const submissionArguments = commonOperationArguments(operation, expectedAction);
    const submitted = expectedSubmitter === "typescript"
        ? runTypeScript(submissionArguments)
        : runPython(submissionArguments);
    const signature = requiredString(submitted.signature, `operations[${index}] signature`);
    const evidence = expectedSubmitter === "typescript"
        ? decodeWithPython(signature)
        : decodeWithTypeScript(signature);
    if (!Array.isArray(evidence) || evidence.length === 0) {
        throw new Error(`No canonical Chancery self-CPI evidence decoded for ${signature}`);
    }
    results.push({
        submitter: expectedSubmitter,
        decoder: expectedSubmitter === "typescript" ? "python" : "typescript",
        action: expectedAction,
        signature,
        evidenceCount: evidence.length,
    });
}

process.stdout.write(`${JSON.stringify({
    rpc,
    commitment,
    programId: "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz",
    results,
}, null, 2)}\n`);
