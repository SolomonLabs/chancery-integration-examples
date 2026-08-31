#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const schemaPath = resolve(repositoryRoot, "typescript/chancery.schema.json");
const pythonSchemaPath = resolve(repositoryRoot, "python/chancery_reference/chancery.schema.json");
const sourceManifestPath = resolve(scriptDirectory, "CHANCERY-PROGRAM-SOURCE.sha256");
const outputPath = resolve(repositoryRoot, "BUILD-COMPATIBILITY.json");

const schemaBytes = await readFile(schemaPath);
const pythonSchemaBytes = await readFile(pythonSchemaPath);
if (!schemaBytes.equals(pythonSchemaBytes)) {
    throw new Error("TypeScript and Python Chancery schemas differ");
}
const schema = JSON.parse(schemaBytes.toString("utf8"));
const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceBindingLines = sourceManifestBytes.toString("utf8").split("\n").filter(Boolean);
const sourceTreeMatch = /^([0-9a-f]{64})  chancery-program-source$/.exec(sourceBindingLines[0] ?? "");
const sourceCountMatch = /^([0-9]+)  files$/.exec(sourceBindingLines[1] ?? "");
if (sourceTreeMatch === null || sourceCountMatch === null || sourceBindingLines.length !== 2) {
    throw new Error("Chancery program source binding is invalid");
}

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

function hashBytes(value) {
    return createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value) {
    return hashBytes(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function entryCount(value) {
    if (Array.isArray(value)) {
        return value.length;
    }
    if (value !== null && typeof value === "object") {
        return Object.keys(value).length;
    }
    return 0;
}

const compatibility = {
    format: "chancery-build-compatibility",
    program: {
        name: schema.program.name,
        programId: schema.program.address,
        declaredVersion: schema.program.version,
    },
    schema: {
        sha256: hashBytes(schemaBytes),
        wireSha256: hashCanonical(schema.wire),
        knownPdasSha256: hashCanonical(schema.known_pdas),
        instructionsSha256: hashCanonical(schema.instructions),
        accountsSha256: hashCanonical(schema.accounts),
        eventsSha256: hashCanonical(schema.events),
        typesSha256: hashCanonical(schema.types),
        constantsSha256: hashCanonical(schema.constants),
        errorsSha256: hashCanonical(schema.errors),
        instructionCount: entryCount(schema.instructions),
        accountCount: entryCount(schema.accounts),
        eventCount: entryCount(schema.events),
        typeCount: entryCount(schema.types),
        constantCount: entryCount(schema.constants),
        errorCount: entryCount(schema.errors),
    },
    programSource: {
        bindingPath: "compatibility/CHANCERY-PROGRAM-SOURCE.sha256",
        bindingSha256: hashBytes(sourceManifestBytes),
        treeSha256: sourceTreeMatch[1],
        fileCount: Number(sourceCountMatch[1]),
    },
    programBinary: {
        sha256: null,
        verificationRequiredForDeployment: true,
        verifierPath: "compatibility/VerifyProgramData.mjs",
    },
};

await writeFile(outputPath, `${JSON.stringify(compatibility, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
