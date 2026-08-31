#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const compatibility = JSON.parse(
    await readFile(resolve(repositoryRoot, "BUILD-COMPATIBILITY.json"), "utf8"),
);
const schemaBytes = await readFile(resolve(repositoryRoot, "typescript/chancery.schema.json"));
const pythonSchemaBytes = await readFile(
    resolve(repositoryRoot, "python/chancery_reference/chancery.schema.json"),
);
const schema = JSON.parse(schemaBytes.toString("utf8"));

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value !== null && typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) {
            result[key] = canonicalize(value[key]);
        }
        return result;
    }
    return value;
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value) {
    return sha256(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function entryCount(value) {
    return Array.isArray(value) ? value.length : Object.keys(value ?? {}).length;
}

function requireEqual(label, actual, expected) {
    if (actual !== expected) {
        throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
    }
}

async function collectFiles(directory) {
    const files = [];
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(path));
        } else if (entry.isFile()) {
            files.push(path);
        } else {
            throw new Error(`Unsupported source-tree entry: ${path}`);
        }
    }
    return files;
}

async function calculateSourceTree(sourceRoot) {
    const fixedFiles = [
        resolve(sourceRoot, "Cargo.lock"),
        resolve(sourceRoot, "Cargo.toml"),
        resolve(sourceRoot, "programs/chancery/Cargo.toml"),
    ];
    const sourceFiles = await collectFiles(resolve(sourceRoot, "programs/chancery/src"));
    const files = [...fixedFiles, ...sourceFiles].sort((left, right) => {
        const leftRelative = relative(sourceRoot, left).split(sep).join("/");
        const rightRelative = relative(sourceRoot, right).split(sep).join("/");
        if (leftRelative < rightRelative) {
            return -1;
        }
        if (leftRelative > rightRelative) {
            return 1;
        }
        return 0;
    });
    const manifestParts = [];
    for (const file of files) {
        const relativePath = relative(sourceRoot, file).split(sep).join("/");
        manifestParts.push(`${sha256(await readFile(file))}  ${relativePath}\n`);
    }
    const manifestBytes = Buffer.from(manifestParts.join(""), "utf8");
    return {
        fileCount: files.length,
        treeSha256: sha256(manifestBytes),
    };
}

if (!schemaBytes.equals(pythonSchemaBytes)) {
    throw new Error("TypeScript and Python Chancery schemas differ");
}
requireEqual("program id", schema.program.address, compatibility.program.programId);
requireEqual("schema sha256", sha256(schemaBytes), compatibility.schema.sha256);
for (const [field, schemaField] of [
    ["wireSha256", "wire"],
    ["knownPdasSha256", "known_pdas"],
    ["instructionsSha256", "instructions"],
    ["accountsSha256", "accounts"],
    ["eventsSha256", "events"],
    ["typesSha256", "types"],
    ["constantsSha256", "constants"],
    ["errorsSha256", "errors"],
]) {
    requireEqual(field, canonicalHash(schema[schemaField]), compatibility.schema[field]);
}
for (const [field, schemaField] of [
    ["instructionCount", "instructions"],
    ["accountCount", "accounts"],
    ["eventCount", "events"],
    ["typeCount", "types"],
    ["constantCount", "constants"],
    ["errorCount", "errors"],
]) {
    requireEqual(field, entryCount(schema[schemaField]), compatibility.schema[field]);
}

const sourceBindingPath = resolve(repositoryRoot, compatibility.programSource.bindingPath);
const sourceBindingBytes = await readFile(sourceBindingPath);
requireEqual(
    "source binding sha256",
    sha256(sourceBindingBytes),
    compatibility.programSource.bindingSha256,
);
const sourceBindingLines = sourceBindingBytes.toString("utf8").split("\n").filter(Boolean);
const treeMatch = /^([0-9a-f]{64})  chancery-program-source$/.exec(sourceBindingLines[0] ?? "");
const countMatch = /^([0-9]+)  files$/.exec(sourceBindingLines[1] ?? "");
if (treeMatch === null || countMatch === null || sourceBindingLines.length !== 2) {
    throw new Error("Chancery program source binding is invalid");
}
requireEqual("source tree sha256", treeMatch[1], compatibility.programSource.treeSha256);
requireEqual("source file count", Number(countMatch[1]), compatibility.programSource.fileCount);

const sourceRootArgumentIndex = process.argv.indexOf("--source-root");
let sourceVerified = false;
if (sourceRootArgumentIndex >= 0) {
    const sourceRootValue = process.argv[sourceRootArgumentIndex + 1];
    if (sourceRootValue === undefined) {
        throw new Error("--source-root requires a path");
    }
    const sourceObservation = await calculateSourceTree(resolve(sourceRootValue));
    requireEqual(
        "source tree sha256",
        sourceObservation.treeSha256,
        compatibility.programSource.treeSha256,
    );
    requireEqual(
        "source file count",
        sourceObservation.fileCount,
        compatibility.programSource.fileCount,
    );
    sourceVerified = true;
}

process.stdout.write(`${JSON.stringify({
    programId: compatibility.program.programId,
    schemaSha256: compatibility.schema.sha256,
    sourceTreeSha256: compatibility.programSource.treeSha256,
    sourceVerified,
}, null, 2)}\n`);
