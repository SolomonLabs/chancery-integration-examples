#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const CHANCERY_PROGRAM_ADDRESS = "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz";
const PROGRAM_DATA_ADDRESS = "11111111111111111111111111111111";
const ISSUED_TOKEN_MINT = "USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const buildRoot = resolve(repositoryRoot, "dist");

function runProcess(executable, argumentsList, environment = {}) {
    return new Promise((resolveResult, reject) => {
        const child = spawn(executable, argumentsList, {
            cwd: repositoryRoot,
            env: { ...process.env, ...environment },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (status) => {
            resolveResult({ status, stdout, stderr });
        });
    });
}

async function runSuccessfulNode(argumentsList, environment = {}) {
    const result = await runProcess(process.execPath, argumentsList, environment);
    if (result.status !== 0) {
        throw new Error([
            `Node command exited with status ${String(result.status)}: node ${argumentsList.join(" ")}`,
            result.stdout,
            result.stderr,
        ].filter((value) => value.length > 0).join("\n"));
    }
    return result.stdout;
}

function parseJsonOutput(output, label) {
    if (output.trim().length === 0) {
        throw new Error(`${label} returned no JSON`);
    }
    try {
        return JSON.parse(output);
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

function bashBlocks(markdown) {
    const blocks = [];
    const expression = /```bash\n([\s\S]*?)\n```/g;
    for (const match of markdown.matchAll(expression)) {
        blocks.push(match[1]);
    }
    return blocks;
}

async function verifyDocumentedCommands() {
    const packageDefinition = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
    const scriptNames = new Set(Object.keys(packageDefinition.scripts));
    for (const [scriptName, command] of Object.entries(packageDefinition.scripts)) {
        for (const match of command.matchAll(/\byarn ([A-Za-z0-9:_-]+)/g)) {
            const referencedScriptName = match[1];
            if (referencedScriptName !== "install" && !scriptNames.has(referencedScriptName)) {
                throw new Error(
                    `Package script ${scriptName} references missing Yarn script ${referencedScriptName}`,
                );
            }
        }
    }

    const documentationPaths = ["README.md", "VALIDATION.md", "integration/README.md"];
    for (const documentationPath of documentationPaths) {
        const markdown = await readFile(resolve(repositoryRoot, documentationPath), "utf8");
        for (const block of bashBlocks(markdown)) {
            if (/(?:^|\n)(?:tsc|tsx)(?:\s|$)/m.test(block)) {
                throw new Error(`${documentationPath} invokes a project development dependency outside Yarn`);
            }
            if (/(?:^|\s)<[^>\n]+>/.test(block)) {
                throw new Error(`${documentationPath} contains an unquoted shell redirection placeholder`);
            }
            for (const match of block.matchAll(/\byarn ([A-Za-z0-9:_-]+)/g)) {
                const commandName = match[1];
                if (commandName !== "install" && !scriptNames.has(commandName)) {
                    throw new Error(`${documentationPath} references missing Yarn script ${commandName}`);
                }
            }
            for (const match of block.matchAll(/(?:^|\n)node ([^\s\\]+)/g)) {
                const commandPath = match[1];
                if (!commandPath.startsWith("-") && !commandPath.startsWith("<")) {
                    await access(resolve(repositoryRoot, commandPath));
                }
            }
            for (const match of block.matchAll(/(?:^|\s)python(?:3)? ([^\s\\]+)/g)) {
                const commandPath = match[1];
                if (!commandPath.startsWith("-") && !commandPath.startsWith("<")) {
                    await access(resolve(repositoryRoot, commandPath));
                }
            }
        }
    }
}

async function verifyCommandHelp() {
    const cliOutput = await runSuccessfulNode([
        resolve(buildRoot, "typescript/src/client/cli.js"),
        "--help",
    ]);
    for (const expected of [
        "yarn cli:typescript discover",
        "yarn cli:typescript quote-mint",
        "--now-unix-timestamp",
        "--lookup-table",
    ]) {
        if (!cliOutput.includes(expected)) {
            throw new Error(`TypeScript CLI help omits ${expected}`);
        }
    }

    const programOutput = await runSuccessfulNode([
        resolve(repositoryRoot, "compatibility/VerifyProgramData.mjs"),
        "--help",
    ]);
    if (!programOutput.includes("--expected-sha256")) {
        throw new Error("ProgramData verifier help is incomplete");
    }

    const integrationOutput = await runSuccessfulNode([
        resolve(repositoryRoot, "integration/RunDirectSettlement.mjs"),
        "--help",
    ]);
    if (!integrationOutput.includes("<configuration.json>")) {
        throw new Error("Direct-settlement runner help is incomplete");
    }
}

async function verifyProgramDataCommand() {
    const binary = Buffer.from([1, 3, 3, 7, 9]);
    const expectedSha256 = createHash("sha256").update(binary).digest("hex");
    const programAccountData = Buffer.alloc(36);
    programAccountData.writeUInt32LE(2, 0);
    const programDataAccountData = Buffer.alloc(45 + binary.length);
    programDataAccountData.writeUInt32LE(3, 0);
    programDataAccountData.writeBigUInt64LE(72n, 4);
    binary.copy(programDataAccountData, 45);

    const server = createServer((request, response) => {
        let requestBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            requestBody += chunk;
        });
        request.on("end", () => {
            try {
                const payload = JSON.parse(requestBody);
                const address = payload.params?.[0];
                let data;
                let contextSlot;
                if (payload.method !== "getAccountInfo") {
                    throw new Error(`Unsupported method ${String(payload.method)}`);
                }
                if (address === CHANCERY_PROGRAM_ADDRESS) {
                    data = programAccountData;
                    contextSlot = 80;
                } else if (address === PROGRAM_DATA_ADDRESS) {
                    data = programDataAccountData;
                    contextSlot = 81;
                } else {
                    throw new Error(`Unsupported account ${String(address)}`);
                }
                response.writeHead(200, { "content-type": "application/json" });
                response.end(JSON.stringify({
                    jsonrpc: "2.0",
                    id: payload.id,
                    result: {
                        context: { slot: contextSlot },
                        value: {
                            data: [data.toString("base64"), "base64"],
                            executable: address === CHANCERY_PROGRAM_ADDRESS,
                            lamports: 1,
                            owner: BPF_UPGRADEABLE_LOADER,
                            rentEpoch: 0,
                            space: data.length,
                        },
                    },
                }));
            } catch (error) {
                response.writeHead(400, { "content-type": "application/json" });
                response.end(JSON.stringify({
                    jsonrpc: "2.0",
                    id: null,
                    error: { code: -32600, message: error instanceof Error ? error.message : String(error) },
                }));
            }
        });
    });

    await listen(server);
    try {
        const address = server.address();
        if (address === null || !("port" in address)) {
            throw new Error("ProgramData fixture server did not expose a TCP port");
        }
        const output = await runSuccessfulNode([
            resolve(repositoryRoot, "compatibility/VerifyProgramData.mjs"),
            "--rpc",
            `http://127.0.0.1:${String(address.port)}`,
            "--program",
            CHANCERY_PROGRAM_ADDRESS,
            "--expected-sha256",
            expectedSha256,
        ]);
        const verification = parseJsonOutput(output, "ProgramData verifier");
        if (
            verification.programId !== CHANCERY_PROGRAM_ADDRESS
            || verification.programDataAddress !== PROGRAM_DATA_ADDRESS
            || verification.binarySha256 !== expectedSha256
            || verification.matchesExpected !== true
        ) {
            throw new Error("ProgramData verifier returned an unexpected result");
        }
    } finally {
        await close(server);
    }
}

async function verifyCompatibilityCommand() {
    const output = await runSuccessfulNode([
        resolve(repositoryRoot, "compatibility/VerifyBuildCompatibility.mjs"),
    ]);
    const compatibility = parseJsonOutput(output, "Build compatibility verifier");
    if (
        compatibility.programId !== CHANCERY_PROGRAM_ADDRESS
        || compatibility.sourceVerified !== false
    ) {
        throw new Error("Build compatibility verifier returned an unexpected result");
    }
}

async function listen(server) {
    await new Promise((resolveListen, reject) => {
        const onError = (error) => {
            reject(error);
        };
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", onError);
            resolveListen();
        });
    });
}

async function close(server) {
    await new Promise((resolveClose, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolveClose();
            } else {
                reject(error);
            }
        });
    });
}

async function reserveTcpPort() {
    const server = createServer();
    await listen(server);
    const address = server.address();
    if (address === null || !("port" in address)) {
        await close(server);
        throw new Error("TCP port probe did not expose a port");
    }
    const port = address.port;
    await close(server);
    return port;
}

async function waitForServer(child, expectedOutput) {
    await new Promise((resolveReady, reject) => {
        let stdout = "";
        let stderr = "";
        const finish = (callback) => {
            clearTimeout(timeout);
            child.stdout.removeListener("data", onStdout);
            child.stderr.removeListener("data", onStderr);
            child.removeListener("error", onError);
            child.removeListener("close", onClose);
            callback();
        };
        const onStdout = (chunk) => {
            stdout += chunk;
            if (stdout.includes(expectedOutput)) {
                finish(resolveReady);
            }
        };
        const onStderr = (chunk) => {
            stderr += chunk;
        };
        const onError = (error) => {
            finish(() => reject(error));
        };
        const onClose = (status) => {
            finish(() => reject(new Error(
                `Instruction-builder server exited with status ${String(status)}\n${stdout}\n${stderr}`,
            )));
        };
        const timeout = setTimeout(() => {
            finish(() => reject(new Error(
                `Instruction-builder server did not start\n${stdout}\n${stderr}`,
            )));
        }, 5_000);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", onStdout);
        child.stderr.on("data", onStderr);
        child.once("error", onError);
        child.once("close", onClose);
    });
}

async function stopServerProcess(child) {
    if (child.exitCode !== null) {
        return;
    }
    await new Promise((resolveClose) => {
        const onClose = () => {
            resolveClose();
        };
        child.once("close", onClose);
        if (!child.kill("SIGTERM")) {
            child.removeListener("close", onClose);
            resolveClose();
        }
    });
}

async function verifyInstructionBuilderServer() {
    const port = await reserveTcpPort();
    const child = spawn(process.execPath, [
        resolve(repositoryRoot, "web/instruction-builder/serve.mjs"),
    ], {
        cwd: repositoryRoot,
        env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    try {
        await waitForServer(child, `http://127.0.0.1:${String(port)}`);
        for (const pathname of [
            "/",
            "/app.mjs",
            "/chancery.schema.json",
            "/squads_multisig_program.json",
        ]) {
            const response = await fetch(`http://127.0.0.1:${String(port)}${pathname}`);
            if (!response.ok) {
                throw new Error(
                    `Instruction-builder server returned ${String(response.status)} for ${pathname}`,
                );
            }
            await response.arrayBuffer();
        }
        const traversalResponse = await fetch(
            `http://127.0.0.1:${String(port)}/%2e%2e%2fREADME.md`,
        );
        if (traversalResponse.status !== 404) {
            throw new Error("Instruction-builder server did not reject a traversal request");
        }
    } finally {
        await stopServerProcess(child);
    }
}

async function verifyReadOnlyCommands() {
    const unknownAccountData = Buffer.alloc(8, 0xff).toString("base64");
    const server = createServer((request, response) => {
        let requestBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            requestBody += chunk;
        });
        request.on("end", () => {
            try {
                const payload = JSON.parse(requestBody);
                if (payload.method === "getProgramAccounts") {
                    response.writeHead(200, { "content-type": "application/json" });
                    response.end(
                        `{"jsonrpc":"2.0","id":${JSON.stringify(payload.id)},"result":[{"pubkey":"${PROGRAM_DATA_ADDRESS}","account":{"data":["${unknownAccountData}","base64"],"executable":false,"lamports":9007199254740993,"owner":"${CHANCERY_PROGRAM_ADDRESS}","rentEpoch":18446744073709551615,"space":8}}]}`,
                    );
                    return;
                }
                if (payload.method === "getTransaction") {
                    response.writeHead(200, { "content-type": "application/json" });
                    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: null }));
                    return;
                }
                response.writeHead(400, { "content-type": "application/json" });
                response.end(JSON.stringify({
                    jsonrpc: "2.0",
                    id: payload.id,
                    error: { code: -32601, message: `Unsupported method ${String(payload.method)}` },
                }));
            } catch (error) {
                response.writeHead(400, { "content-type": "application/json" });
                response.end(JSON.stringify({
                    jsonrpc: "2.0",
                    id: null,
                    error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
                }));
            }
        });
    });

    await listen(server);
    try {
        const address = server.address();
        if (address === null || !("port" in address)) {
            throw new Error("Read-only fixture server did not expose a TCP port");
        }
        const endpoint = `http://127.0.0.1:${String(address.port)}`;
        const discoveryOutput = await runSuccessfulNode([
            resolve(buildRoot, "typescript/src/client/cli.js"),
            "discover",
            "--rpc",
            endpoint,
            "--commitment",
            "confirmed",
        ]);
        const discovery = parseJsonOutput(discoveryOutput, "TypeScript discover command");
        if (
            discovery.programAddress !== CHANCERY_PROGRAM_ADDRESS
            || discovery.accountCount !== 1
            || !Array.isArray(discovery.unrecognizedAccounts)
            || discovery.unrecognizedAccounts.length !== 1
            || discovery.unrecognizedAccounts[0]?.discriminatorHex !== "0xffffffffffffffff"
        ) {
            throw new Error("TypeScript discover command returned an unexpected result");
        }

        const evidenceOutput = await runSuccessfulNode([
            resolve(buildRoot, "typescript/src/client/cli.js"),
            "decode-transaction",
            "--rpc",
            endpoint,
            "--signature",
            "fixture-signature",
        ]);
        if (evidenceOutput.trim() !== "null") {
            throw new Error("TypeScript decode-transaction command did not preserve a missing transaction");
        }

        const exampleOutput = await runSuccessfulNode([
            resolve(buildRoot, "typescript/examples/ReadOnlyIntegration.js"),
        ], { RPC_URL: endpoint });
        const summary = parseJsonOutput(exampleOutput, "TypeScript read-only example");
        if (
            summary.programAddress !== CHANCERY_PROGRAM_ADDRESS
            || summary.accountCount !== 1
            || summary.unrecognizedAccountCount !== 1
            || !Array.isArray(summary.assetMints)
            || !Array.isArray(summary.pathwayIds)
        ) {
            throw new Error("TypeScript read-only example returned an unexpected result");
        }
    } finally {
        await close(server);
    }
}

function requireProposalBundle(bundle, expectedInstructionCount, label) {
    if (
        bundle.addresses === undefined
        || bundle.transactionMessage === undefined
        || !Array.isArray(bundle.transactionMessage.instructions)
        || bundle.transactionMessage.instructions.length !== expectedInstructionCount
        || bundle.instructions === undefined
        || !Array.isArray(bundle.instructions.creation)
        || bundle.instructions.creation.length !== 2
        || bundle.instructions.approval === undefined
        || bundle.instructions.execution === undefined
    ) {
        throw new Error(`${label} returned an incomplete proposal bundle`);
    }
}

async function verifySquadsExamples() {
    const environment = {
        SQUADS_MULTISIG_ADDRESS: CHANCERY_PROGRAM_ADDRESS,
        SQUADS_CREATOR_ADDRESS: CHANCERY_PROGRAM_ADDRESS,
        SQUADS_TRANSACTION_INDEX: "1",
    };
    const singleOutput = await runSuccessfulNode([
        resolve(buildRoot, "typescript/examples/SquadsChanceryProposal.js"),
    ], environment);
    requireProposalBundle(
        parseJsonOutput(singleOutput, "Single-instruction Squads example"),
        1,
        "Single-instruction Squads example",
    );

    const batchOutput = await runSuccessfulNode([
        resolve(buildRoot, "typescript/examples/SquadsChanceryBatchProposal.js"),
    ], { ...environment, ASSET_MINT: ISSUED_TOKEN_MINT });
    requireProposalBundle(
        parseJsonOutput(batchOutput, "Batch Squads example"),
        2,
        "Batch Squads example",
    );
}

await verifyDocumentedCommands();
await verifyCommandHelp();
await verifyProgramDataCommand();
await verifyCompatibilityCommand();
await verifyInstructionBuilderServer();
await verifyReadOnlyCommands();
await verifySquadsExamples();
process.stdout.write("command and example checks passed\n");
