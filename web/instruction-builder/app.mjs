import { encodeBase58 } from "./base58.mjs";
import { buildChanceryInstruction, defaultInstructionAccountValue } from "./chancery.mjs";
import { INSTRUCTION_TEMPLATES } from "./templates.mjs";
import { compileUnversionedMessage, createUnsignedTransaction } from "./solana-transaction.mjs";
import {
    buildSquadsProposal,
    deriveSquadsVaultAddress,
    SQUADS_VAULT_TOKEN,
} from "./squads.mjs";
import {
    bytesToBase64,
    bytesToHex,
    initialInputValue,
    instructionForJson,
    jsonReplacer,
    parseInputValue,
    typeLabel,
} from "./wire.mjs";

const elements = {
    chanceryVersion: document.querySelector("#chancery-version"),
    squadsVersion: document.querySelector("#squads-version"),
    templateSelect: document.querySelector("#template-select"),
    templateDescription: document.querySelector("#template-description"),
    verifyPdas: document.querySelector("#verify-pdas"),
    argumentsFields: document.querySelector("#arguments-fields"),
    accountsFields: document.querySelector("#accounts-fields"),
    squadsPanel: document.querySelector(".squads-panel"),
    squadsFields: document.querySelector("#squads-fields"),
    wrapSquads: document.querySelector("#wrap-squads"),
    multisigAddress: document.querySelector("#multisig-address"),
    creatorAddress: document.querySelector("#creator-address"),
    rentPayerAddress: document.querySelector("#rent-payer-address"),
    transactionIndex: document.querySelector("#transaction-index"),
    vaultIndex: document.querySelector("#vault-index"),
    ephemeralSignerCount: document.querySelector("#ephemeral-signer-count"),
    proposalDraft: document.querySelector("#proposal-draft"),
    approvalMemberAddress: document.querySelector("#approval-member-address"),
    executorMemberAddress: document.querySelector("#executor-member-address"),
    proposalMemo: document.querySelector("#proposal-memo"),
    approvalMemo: document.querySelector("#approval-memo"),
    addressLookupTables: document.querySelector("#address-lookup-tables"),
    feePayerAddress: document.querySelector("#fee-payer-address"),
    recentBlockhash: document.querySelector("#recent-blockhash"),
    exportPhase: document.querySelector("#export-phase"),
    exportFormat: document.querySelector("#export-format"),
    exportButton: document.querySelector("#export-button"),
    copyButton: document.querySelector("#copy-button"),
    generateButton: document.querySelector("#generate-button"),
    status: document.querySelector("#status"),
    output: document.querySelector("#output"),
};

let chancerySchema;
let squadsIdl;
let activeTemplate = INSTRUCTION_TEMPLATES[0];
let generated = null;

function setStatus(message, kind) {
    elements.status.textContent = message;
    elements.status.className = "status" + (kind === undefined ? "" : " " + kind);
}

function clearChildren(element) {
    while (element.firstChild !== null) {
        element.removeChild(element.firstChild);
    }
}

function appendOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

function appendMetadata(container, labels) {
    const metadata = document.createElement("div");
    metadata.className = "field-metadata";
    for (const label of labels) {
        const chip = document.createElement("span");
        chip.className = "meta-chip";
        chip.textContent = label;
        metadata.appendChild(chip);
    }
    container.appendChild(metadata);
}

function inputText(value) {
    if (value === undefined || value === null) return "";
    if (value instanceof Uint8Array) return "0x" + bytesToHex(value);
    if (Array.isArray(value) || (value.constructor !== undefined && value.constructor === Object)) {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

function argumentUsesJson(type) {
    if (typeof type === "string") return false;
    if (type.kind === "option") return argumentUsesJson(type.item);
    return !(
        (type.kind === "array" || type.kind === "vector") &&
        type.item === "u8"
    );
}

function argumentControl(field, value) {
    let control;
    if (field.type === "bool") {
        control = document.createElement("select");
        appendOption(control, "false", "false");
        appendOption(control, "true", "true");
    } else if (
        typeof field.type !== "string" &&
        field.type.kind === "option" &&
        field.type.item === "bool"
    ) {
        control = document.createElement("select");
        appendOption(control, "", "null");
        appendOption(control, "false", "false");
        appendOption(control, "true", "true");
    } else if (argumentUsesJson(field.type)) {
        control = document.createElement("textarea");
        control.rows = 6;
        control.spellcheck = false;
    } else {
        control = document.createElement("input");
        control.autocomplete = "off";
        control.spellcheck = false;
    }
    control.dataset.argumentName = field.name;
    control.value = value;
    return control;
}

function renderArguments(instruction, template) {
    clearChildren(elements.argumentsFields);
    if (instruction.args.length === 0) {
        const empty = document.createElement("p");
        empty.className = "field-note";
        empty.textContent = "This instruction has no arguments.";
        elements.argumentsFields.appendChild(empty);
        return;
    }
    for (const field of instruction.args) {
        const label = document.createElement("label");
        label.className = "field";
        if (argumentUsesJson(field.type)) label.classList.add("field-full");
        const name = document.createElement("span");
        name.textContent = field.name;
        label.appendChild(name);
        const templateValue = template.arguments[field.name];
        const value = templateValue === undefined
            ? initialInputValue(chancerySchema, field.type)
            : inputText(templateValue);
        label.appendChild(argumentControl(field, value));
        appendMetadata(label, [typeLabel(field.type)]);
        elements.argumentsFields.appendChild(label);
    }
}

function renderAccounts(instruction, template) {
    clearChildren(elements.accountsFields);
    for (const account of instruction.accounts) {
        const label = document.createElement("label");
        label.className = "field";
        const name = document.createElement("span");
        name.textContent = account.name;
        label.appendChild(name);
        const input = document.createElement("input");
        input.autocomplete = "off";
        input.spellcheck = false;
        input.dataset.accountName = account.name;
        const templateValue = template.accounts[account.name];
        input.value = templateValue === undefined
            ? defaultInstructionAccountValue(chancerySchema, account)
            : inputText(templateValue);
        if (account.pda !== undefined) {
            input.placeholder = "Derived when all seed inputs are available";
        } else if (account.optional) {
            input.placeholder = "Optional account";
        } else {
            input.placeholder = "Required public key";
        }
        label.appendChild(input);
        const labels = [account.signer ? "signer" : "non-signer", account.writable ? "writable" : "read-only"];
        labels.push(account.optional ? "optional" : "required");
        if (account.pda !== undefined) labels.push("PDA");
        if (account.default !== undefined) labels.push("default");
        appendMetadata(label, labels);
        elements.accountsFields.appendChild(label);
    }
}

function templateById(templateId) {
    const template = INSTRUCTION_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (template === undefined) throw new Error("Unknown template " + templateId);
    return template;
}

function selectedInstructionSchema() {
    const instruction = chancerySchema.instructions[activeTemplate.instructionName];
    if (instruction === undefined) throw new Error("Unknown Chancery instruction " + activeTemplate.instructionName);
    return instruction;
}

function setSquadsEnabled(enabled) {
    elements.squadsPanel.dataset.disabled = enabled ? "false" : "true";
    for (const control of elements.squadsFields.querySelectorAll("input, textarea, select")) {
        control.disabled = !enabled;
    }
}

function applyTemplate(templateId) {
    activeTemplate = templateById(templateId);
    elements.templateSelect.value = activeTemplate.id;
    elements.templateDescription.textContent = activeTemplate.description;
    elements.wrapSquads.checked = activeTemplate.squads;
    setSquadsEnabled(activeTemplate.squads);
    const instruction = selectedInstructionSchema();
    renderArguments(instruction, activeTemplate);
    renderAccounts(instruction, activeTemplate);
}

function requiredValue(control, label) {
    const value = control.value.trim();
    if (value.length === 0) throw new Error(label + " is required");
    return value;
}

function unsignedDecimal(control, label, bitLength) {
    const rawValue = requiredValue(control, label);
    if (!/^[0-9]+$/.test(rawValue)) throw new Error(label + " must be an unsigned decimal integer");
    const value = BigInt(rawValue);
    const maximumValue = (1n << BigInt(bitLength)) - 1n;
    if (value > maximumValue) throw new Error(label + " exceeds the unsigned " + String(bitLength) + "-bit range");
    return value.toString();
}

function unsignedByte(control, label) {
    return Number(unsignedDecimal(control, label, 8));
}

function parseAddressLookupTables() {
    const source = elements.addressLookupTables.value.trim();
    if (source.length === 0) return [];
    const tables = JSON.parse(source);
    if (!Array.isArray(tables)) throw new Error("Address lookup tables must be a JSON array");
    return tables.map((table, tableIndex) => {
        if (table === null || Array.isArray(table) || typeof table !== "object") {
            throw new Error("Address lookup table " + String(tableIndex) + " must be an object");
        }
        if (typeof table.address !== "string" || table.address.length === 0) {
            throw new Error("Address lookup table " + String(tableIndex) + " requires address");
        }
        if (!Array.isArray(table.addresses)) {
            throw new Error("Address lookup table " + String(tableIndex) + " requires addresses[]");
        }
        for (let addressIndex = 0; addressIndex < table.addresses.length; addressIndex++) {
            if (typeof table.addresses[addressIndex] !== "string") {
                throw new Error(
                    "Address lookup table " + String(tableIndex) + ".addresses[" + String(addressIndex) + "] must be a public key string",
                );
            }
        }
        return { address: table.address, addresses: [...table.addresses] };
    });
}

function replaceVaultToken(source, vaultAddress) {
    if (!source.includes(SQUADS_VAULT_TOKEN)) return source;
    if (vaultAddress === undefined) {
        throw new Error(SQUADS_VAULT_TOKEN + " requires Squads wrapping and a multisig address");
    }
    return source.split(SQUADS_VAULT_TOKEN).join(vaultAddress);
}

function readArguments(instruction, vaultAddress) {
    const argumentsValue = {};
    for (const field of instruction.args) {
        const control = elements.argumentsFields.querySelector("[data-argument-name=\"" + field.name + "\"]");
        if (control === null) throw new Error("Missing argument control for " + field.name);
        const rawValue = replaceVaultToken(control.value, vaultAddress);
        argumentsValue[field.name] = parseInputValue(field.type, rawValue);
    }
    return argumentsValue;
}

function readAccounts(instruction, vaultAddress) {
    const accounts = {};
    for (const account of instruction.accounts) {
        const control = elements.accountsFields.querySelector("[data-account-name=\"" + account.name + "\"]");
        if (control === null) throw new Error("Missing account control for " + account.name);
        const rawValue = replaceVaultToken(control.value.trim(), vaultAddress);
        if (rawValue.length > 0) accounts[account.name] = rawValue;
    }
    return accounts;
}

function optionalValue(control) {
    const value = control.value.trim();
    return value.length === 0 ? undefined : value;
}

function readSquadsRequest() {
    return {
        multisigAddress: requiredValue(elements.multisigAddress, "Multisig address"),
        creatorAddress: requiredValue(elements.creatorAddress, "Creator member"),
        rentPayerAddress: optionalValue(elements.rentPayerAddress),
        transactionIndex: unsignedDecimal(elements.transactionIndex, "Transaction index", 64),
        vaultIndex: unsignedByte(elements.vaultIndex, "Vault index"),
        ephemeralSignerCount: unsignedByte(elements.ephemeralSignerCount, "Ephemeral signer count"),
        draft: elements.proposalDraft.checked,
        approvalMemberAddress: optionalValue(elements.approvalMemberAddress),
        executorMemberAddress: optionalValue(elements.executorMemberAddress),
        memo: optionalValue(elements.proposalMemo),
        approvalMemo: optionalValue(elements.approvalMemo),
        addressLookupTables: parseAddressLookupTables(),
    };
}

function readTransactionRequest() {
    const feePayerAddress = optionalValue(elements.feePayerAddress);
    if (feePayerAddress === undefined) return undefined;
    return {
        feePayerAddress,
        recentBlockhash: requiredValue(elements.recentBlockhash, "Recent blockhash"),
    };
}

function compiledInstructionForJson(instruction) {
    return {
        programIdIndex: instruction.programIdIndex,
        accountIndexes: instruction.accountIndexes,
        dataHex: "0x" + bytesToHex(instruction.data),
        dataBase64: bytesToBase64(instruction.data),
    };
}

function transactionMessageForJson(message) {
    return {
        numSigners: message.numSigners,
        numWritableSigners: message.numWritableSigners,
        numWritableNonSigners: message.numWritableNonSigners,
        accountKeys: message.accountKeys,
        instructions: message.instructions.map(compiledInstructionForJson),
        addressTableLookups: message.addressTableLookups,
    };
}

function squadsBundleForJson(bundle) {
    return {
        addresses: bundle.addresses,
        transactionMessage: transactionMessageForJson(bundle.transactionMessage),
        transactionMessageHex: "0x" + bytesToHex(bundle.transactionMessageBytes),
        transactionMessageBase64: bytesToBase64(bundle.transactionMessageBytes),
        instructions: {
            creation: bundle.instructions.creation.map(instructionForJson),
            activation: bundle.instructions.activation === null
                ? null
                : instructionForJson(bundle.instructions.activation),
            approval: instructionForJson(bundle.instructions.approval),
            execution: instructionForJson(bundle.instructions.execution),
        },
    };
}

function compileTransaction(instructions, transactionRequest) {
    const message = compileUnversionedMessage(
        instructions,
        transactionRequest.feePayerAddress,
        transactionRequest.recentBlockhash,
    );
    return {
        message,
        unsignedTransactionBytes: createUnsignedTransaction(message),
    };
}

function transactionForJson(transaction, transactionRequest) {
    return {
        feePayer: transactionRequest.feePayerAddress,
        recentBlockhash: transactionRequest.recentBlockhash,
        message: {
            version: transaction.message.version,
            numberOfRequiredSignatures: transaction.message.numberOfRequiredSignatures,
            numberOfReadonlySignedAccounts: transaction.message.numberOfReadonlySignedAccounts,
            numberOfReadonlyUnsignedAccounts: transaction.message.numberOfReadonlyUnsignedAccounts,
            accountKeys: transaction.message.accountKeys,
            signerAddresses: transaction.message.signerAddresses,
            instructions: transaction.message.instructions.map(compiledInstructionForJson),
            bytesHex: "0x" + bytesToHex(transaction.message.bytes),
            bytesBase64: bytesToBase64(transaction.message.bytes),
        },
        unsignedTransactionBase64: bytesToBase64(transaction.unsignedTransactionBytes),
        unsignedTransactionBase58: encodeBase58(transaction.unsignedTransactionBytes),
    };
}

function transactionPhases(chanceryInstruction, squadsBundle) {
    if (squadsBundle === undefined) {
        return [{ phase: "chancery", instructions: [chanceryInstruction] }];
    }
    const phases = [{ phase: "creation", instructions: squadsBundle.instructions.creation }];
    if (squadsBundle.instructions.activation !== null) {
        phases.push({ phase: "activation", instructions: [squadsBundle.instructions.activation] });
    }
    phases.push({ phase: "approval", instructions: [squadsBundle.instructions.approval] });
    phases.push({ phase: "execution", instructions: [squadsBundle.instructions.execution] });
    return phases;
}

function compileTransactions(phases, transactionRequest) {
    const transactions = new Map();
    for (const { phase, instructions } of phases) {
        transactions.set(phase, compileTransaction(instructions, transactionRequest));
    }
    return transactions;
}

function transactionsForJson(transactions, transactionRequest) {
    const value = {};
    for (const [phase, transaction] of transactions) {
        value[phase] = transactionForJson(transaction, transactionRequest);
    }
    return value;
}

function renderExportPhases(phases) {
    clearChildren(elements.exportPhase);
    for (const phase of phases) {
        appendOption(elements.exportPhase, phase, phase);
    }
    elements.exportPhase.disabled = phases.length <= 1;
}

async function generate() {
    elements.generateButton.disabled = true;
    elements.copyButton.disabled = true;
    elements.exportButton.disabled = true;
    setStatus("Generating deterministic instruction data.");
    try {
        const instructionName = activeTemplate.instructionName;
        const instructionSchema = selectedInstructionSchema();
        let squadsRequest;
        let vaultAddress;
        if (elements.wrapSquads.checked) {
            squadsRequest = readSquadsRequest();
            vaultAddress = (await deriveSquadsVaultAddress(
                squadsRequest.multisigAddress,
                squadsRequest.vaultIndex,
            )).address;
        }
        const transactionRequest = readTransactionRequest();
        const argumentsValue = readArguments(instructionSchema, vaultAddress);
        const accounts = readAccounts(instructionSchema, vaultAddress);
        const chanceryInstruction = await buildChanceryInstruction(
            chancerySchema,
            instructionName,
            argumentsValue,
            accounts,
            elements.verifyPdas.checked,
        );
        let squadsBundle;
        let output;
        if (squadsRequest === undefined) {
            output = {
                kind: "chancery_instruction",
                instructionName,
                instruction: instructionForJson(chanceryInstruction),
            };
        } else {
            squadsBundle = await buildSquadsProposal({
                ...squadsRequest,
                instructions: [chanceryInstruction],
            });
            output = {
                kind: "squads_vault_proposal",
                instructionName,
                chanceryInstructions: [instructionForJson(chanceryInstruction)],
                squads: squadsBundleForJson(squadsBundle),
            };
        }
        const phases = transactionPhases(chanceryInstruction, squadsBundle);
        const transactions = transactionRequest === undefined
            ? new Map()
            : compileTransactions(phases, transactionRequest);
        output.transactions = transactionRequest === undefined
            ? null
            : transactionsForJson(transactions, transactionRequest);
        const outputText = JSON.stringify(output, jsonReplacer, 2);
        generated = { instructionName, outputText, transactions };
        renderExportPhases(phases.map((entry) => entry.phase));
        elements.output.textContent = outputText;
        setStatus(
            transactionRequest === undefined
                ? "Instruction data generated; supply a fee payer to compile transactions."
                : "Instruction data and unsigned transactions generated.",
            "success",
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, "error");
    } finally {
        elements.generateButton.disabled = false;
        elements.copyButton.disabled = false;
        elements.exportButton.disabled = false;
    }
}

function downloadText(fileName, text, contentType) {
    const url = URL.createObjectURL(new Blob([text], { type: contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function exportOutput() {
    try {
        if (generated === null) throw new Error("Generate output before exporting");
        const format = elements.exportFormat.value;
        if (format === "json") {
            downloadText(generated.instructionName + ".json", generated.outputText, "application/json");
            setStatus("Exported JSON.", "success");
            return;
        }
        const phase = elements.exportPhase.value;
        const transaction = generated.transactions.get(phase);
        if (transaction === undefined) {
            throw new Error("Fee payer is required for transaction export; regenerate with a fee payer");
        }
        const bytes = transaction.unsignedTransactionBytes;
        let text;
        if (format === "base64") {
            text = bytesToBase64(bytes);
        } else if (format === "base58") {
            text = encodeBase58(bytes);
        } else {
            throw new Error("Unknown export format " + format);
        }
        downloadText(generated.instructionName + "-" + phase + "." + format + ".txt", text + "\n", "text/plain");
        setStatus("Exported " + phase + " transaction as " + format + ".", "success");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, "error");
    }
}

async function copyOutput() {
    const value = elements.output.textContent;
    try {
        if (navigator.clipboard === undefined) {
            elements.output.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(elements.output);
            selection.removeAllRanges();
            selection.addRange(range);
            setStatus("Clipboard API unavailable; output selected for manual copy.");
            return;
        }
        await navigator.clipboard.writeText(value);
        setStatus("Generated JSON copied.", "success");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus("Copy failed: " + message, "error");
    }
}

function populateSelectors() {
    clearChildren(elements.templateSelect);
    for (const template of INSTRUCTION_TEMPLATES) {
        appendOption(elements.templateSelect, template.id, template.label);
    }
}

async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load " + path + ": HTTP " + String(response.status));
    return response.json();
}

async function initialize() {
    setSquadsEnabled(false);
    renderExportPhases([]);
    setStatus("Loading checked-in program interfaces.");
    try {
        [chancerySchema, squadsIdl] = await Promise.all([
            loadJson("./chancery.schema.json"),
            loadJson("./squads_multisig_program.json"),
        ]);
        elements.chanceryVersion.textContent = chancerySchema.program.name + " " + chancerySchema.program.version;
        elements.squadsVersion.textContent = squadsIdl.name + " " + squadsIdl.version;
        populateSelectors();
        applyTemplate(INSTRUCTION_TEMPLATES[0].id);
        setStatus("Interfaces loaded.", "success");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, "error");
        elements.generateButton.disabled = true;
    }
}

elements.templateSelect.addEventListener("change", () => applyTemplate(elements.templateSelect.value));
elements.wrapSquads.addEventListener("change", () => setSquadsEnabled(elements.wrapSquads.checked));
elements.generateButton.addEventListener("click", generate);
elements.exportButton.addEventListener("click", exportOutput);
elements.copyButton.addEventListener("click", copyOutput);

initialize();
