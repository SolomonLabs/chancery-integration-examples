#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAM_VARIANT = 2;
const PROGRAM_DATA_VARIANT = 3;
const PROGRAM_DATA_BYTES_OFFSET = 45;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0) {
        return undefined;
    }
    const value = process.argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} requires a value`);
    }
    return value;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write([
        "Usage:",
        "  node compatibility/VerifyProgramData.mjs --rpc <url> [--program <address>] [--expected-sha256 <hash>]",
        "",
        "The expected binary hash may also be set in BUILD-COMPATIBILITY.json.",
    ].join("\n") + "\n");
    process.exit(0);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const compatibility = JSON.parse(await readFile(resolve(repositoryRoot, "BUILD-COMPATIBILITY.json"), "utf8"));
const rpcEndpoint = option("rpc");
if (rpcEndpoint === undefined) {
    throw new Error("--rpc is required");
}
const programId = option("program") ?? compatibility.program.programId;
const expectedSha256 = option("expected-sha256") ?? compatibility.programBinary.sha256;
if (expectedSha256 !== null && !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("Expected program binary SHA-256 must be 64 lowercase hexadecimal characters");
}

let requestIdentifier = 1;
async function rpc(method, params) {
    const response = await fetch(rpcEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestIdentifier++, method, params }),
    });
    if (!response.ok) {
        throw new Error(`RPC ${method} returned HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body.error !== undefined) {
        throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
    }
    return body.result;
}

async function getAccountInfo(address) {
    const result = await rpc("getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }]);
    if (result.value === null) {
        throw new Error(`Account ${address} does not exist`);
    }
    const encodedData = result.value.data;
    if (!Array.isArray(encodedData) || typeof encodedData[0] !== "string") {
        throw new Error(`Account ${address} did not return base64 data`);
    }
    return {
        contextSlot: BigInt(result.context.slot),
        owner: result.value.owner,
        data: Buffer.from(encodedData[0], "base64"),
    };
}

function readVariant(data, label) {
    if (data.length < 4) {
        throw new Error(`${label} account data is shorter than four bytes`);
    }
    return data.readUInt32LE(0);
}

function encodeBase58(bytes) {
    if (bytes.length === 0) {
        return "";
    }
    const digits = [0];
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
        let carry = bytes[byteIndex];
        for (let digitIndex = 0; digitIndex < digits.length; digitIndex++) {
            carry += digits[digitIndex] * 256;
            digits[digitIndex] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    let zeroCount = 0;
    while (zeroCount < bytes.length && bytes[zeroCount] === 0) {
        zeroCount++;
    }
    let encoded = "1".repeat(zeroCount);
    for (let index = digits.length - 1; index >= 0; index--) {
        if (index === digits.length - 1 && digits[index] === 0 && zeroCount > 0) {
            continue;
        }
        encoded += BASE58_ALPHABET[digits[index]];
    }
    return encoded;
}

const programAccount = await getAccountInfo(programId);
if (programAccount.owner !== BPF_UPGRADEABLE_LOADER) {
    throw new Error(`Program account owner is ${programAccount.owner}, not ${BPF_UPGRADEABLE_LOADER}`);
}
if (readVariant(programAccount.data, "Program") !== PROGRAM_VARIANT || programAccount.data.length < 36) {
    throw new Error("Program account is not an upgradeable-loader Program state");
}
const programDataAddress = encodeBase58(programAccount.data.subarray(4, 36));
const programDataAccount = await getAccountInfo(programDataAddress);
if (programDataAccount.owner !== BPF_UPGRADEABLE_LOADER) {
    throw new Error(`ProgramData account owner is ${programDataAccount.owner}, not ${BPF_UPGRADEABLE_LOADER}`);
}
if (
    readVariant(programDataAccount.data, "ProgramData") !== PROGRAM_DATA_VARIANT
    || programDataAccount.data.length <= PROGRAM_DATA_BYTES_OFFSET
) {
    throw new Error("ProgramData account is not an upgradeable-loader ProgramData state");
}
const deploymentSlot = programDataAccount.data.readBigUInt64LE(4);
const binary = programDataAccount.data.subarray(PROGRAM_DATA_BYTES_OFFSET);
const observedSha256 = createHash("sha256").update(binary).digest("hex");
if (expectedSha256 !== null && observedSha256 !== expectedSha256) {
    throw new Error(`Program binary SHA-256 mismatch: expected ${expectedSha256}, received ${observedSha256}`);
}

process.stdout.write(`${JSON.stringify({
    programId,
    programDataAddress,
    programAccountContextSlot: programAccount.contextSlot.toString(),
    programDataContextSlot: programDataAccount.contextSlot.toString(),
    deploymentSlot: deploymentSlot.toString(),
    binaryLength: binary.length,
    binarySha256: observedSha256,
    expectedSha256,
    matchesExpected: expectedSha256 === null ? null : observedSha256 === expectedSha256,
}, null, 2)}\n`);
