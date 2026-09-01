import { buildChanceryInstruction, defaultInstructionAccountValue } from "./chancery.mjs";
import { INSTRUCTION_TEMPLATES } from "./templates.mjs";
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
    instructionSelect: document.querySelector("#instruction-select"),
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
    copyButton: document.querySelector("#copy-button"),
    generateButton: document.querySelector("#generate-button"),
    status: document.querySelector("#status"),
    output: document.querySelector("#output"),
};

let chancerySchema;
let squadsIdl;
let activeTemplate = INSTRUCTION_TEMPLATES[0];

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
        label.className = "field field-wide";
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

function renderSelectedInstruction(template) {
    const instructionName = elements.instructionSelect.value;
    const instruction = chancerySchema.instructions[instructionName];
    if (instruction === undefined) throw new Error("Unknown Chancery instruction " + instructionName);
    elements.templateDescription.textContent = template.description;
    renderArguments(instruction, template);
    renderAccounts(instruction, template);
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
    elements.instructionSelect.value = activeTemplate.instructionName;
    elements.wrapSquads.checked = activeTemplate.squads;
    setSquadsEnabled(activeTemplate.squads);
    renderSelectedInstruction(activeTemplate);
}

function applyCustomInstruction() {
    activeTemplate = templateById("custom");
    elements.templateSelect.value = activeTemplate.id;
    setSquadsEnabled(elements.wrapSquads.checked);
    renderSelectedInstruction(activeTemplate);
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

function transactionMessageForJson(message) {
    return {
        numSigners: message.numSigners,
        numWritableSigners: message.numWritableSigners,
        numWritableNonSigners: message.numWritableNonSigners,
        accountKeys: message.accountKeys,
        instructions: message.instructions.map((instruction) => ({
            programIdIndex: instruction.programIdIndex,
            accountIndexes: instruction.accountIndexes,
            dataHex: "0x" + bytesToHex(instruction.data),
            dataBase64: bytesToBase64(instruction.data),
        })),
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

async function generate() {
    elements.generateButton.disabled = true;
    elements.copyButton.disabled = true;
    setStatus("Generating deterministic instruction data.");
    try {
        const instructionName = elements.instructionSelect.value;
        const instructionSchema = chancerySchema.instructions[instructionName];
        if (instructionSchema === undefined) throw new Error("Unknown Chancery instruction " + instructionName);
        let squadsRequest;
        let vaultAddress;
        if (elements.wrapSquads.checked) {
            squadsRequest = readSquadsRequest();
            vaultAddress = (await deriveSquadsVaultAddress(
                squadsRequest.multisigAddress,
                squadsRequest.vaultIndex,
            )).address;
        }
        const argumentsValue = readArguments(instructionSchema, vaultAddress);
        const accounts = readAccounts(instructionSchema, vaultAddress);
        const chanceryInstruction = await buildChanceryInstruction(
            chancerySchema,
            instructionName,
            argumentsValue,
            accounts,
            elements.verifyPdas.checked,
        );
        let output;
        if (squadsRequest === undefined) {
            output = {
                kind: "chancery_instruction",
                instructionName,
                instruction: instructionForJson(chanceryInstruction),
            };
        } else {
            const squadsBundle = await buildSquadsProposal({
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
        elements.output.textContent = JSON.stringify(output, jsonReplacer, 2);
        setStatus("Instruction data generated.", "success");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, "error");
    } finally {
        elements.generateButton.disabled = false;
        elements.copyButton.disabled = false;
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
    clearChildren(elements.instructionSelect);
    for (const instructionName of Object.keys(chancerySchema.instructions)) {
        appendOption(elements.instructionSelect, instructionName, instructionName);
    }
}

async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load " + path + ": HTTP " + String(response.status));
    return response.json();
}

async function initialize() {
    setSquadsEnabled(false);
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

elements.templateSelect.addEventListener("change", () => {
    const template = templateById(elements.templateSelect.value);
    if (template.id === "custom") {
        activeTemplate = template;
        elements.templateDescription.textContent = template.description;
        renderSelectedInstruction(template);
        return;
    }
    applyTemplate(template.id);
});
elements.instructionSelect.addEventListener("change", applyCustomInstruction);
elements.wrapSquads.addEventListener("change", () => setSquadsEnabled(elements.wrapSquads.checked));
elements.generateButton.addEventListener("click", generate);
elements.copyButton.addEventListener("click", copyOutput);

initialize();
