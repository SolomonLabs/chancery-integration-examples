import { decodePublicKey, normalizePublicKey } from "./base58.mjs";
import { findProgramAddress } from "./program-address.mjs";
import { compileSquadsVaultMessage } from "./solana-message.mjs";
import {
    concatenateBytes,
    encodeUnsignedInteger,
    textBytes,
} from "./wire.mjs";

export const SQUADS_MULTISIG_PROGRAM_ADDRESS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const SOLANA_SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
export const SQUADS_VAULT_TOKEN = "$SQUADS_VAULT";

const DISCRIMINATORS = {
    vaultTransactionCreate: [48, 250, 78, 168, 208, 226, 218, 211],
    vaultTransactionExecute: [194, 8, 161, 87, 153, 164, 25, 171],
    proposalCreate: [220, 60, 73, 224, 30, 108, 79, 159],
    proposalActivate: [11, 34, 92, 248, 154, 27, 51, 106],
    proposalApprove: [144, 37, 164, 136, 188, 216, 42, 248],
};
const SEED_PREFIX = textBytes("multisig");
const SEED_VAULT = textBytes("vault");
const SEED_TRANSACTION = textBytes("transaction");
const SEED_PROPOSAL = textBytes("proposal");
const SEED_EPHEMERAL_SIGNER = textBytes("ephemeral_signer");
const TEXT_ENCODER = new TextEncoder();

function encodeU8(value, label) {
    return encodeUnsignedInteger(value, 1, label);
}

function encodeU16(value, label) {
    return encodeUnsignedInteger(value, 2, label);
}

function encodeU32(value, label) {
    return encodeUnsignedInteger(value, 4, label);
}

function encodeU64(value, label) {
    return encodeUnsignedInteger(value, 8, label);
}

function encodeOptionalString(value) {
    if (value === undefined || value === null) return new Uint8Array([0]);
    const bytes = TEXT_ENCODER.encode(value);
    return concatenateBytes([new Uint8Array([1]), encodeU32(bytes.length, "string.length"), bytes]);
}

function encodeByteVector(bytes) {
    return concatenateBytes([encodeU32(bytes.length, "bytes.length"), bytes]);
}

function instructionAccount(name, address, isSigner, isWritable) {
    return { name, address: normalizePublicKey(address), isSigner, isWritable };
}

export async function deriveSquadsVaultAddress(multisigAddress, vaultIndex, programAddress = SQUADS_MULTISIG_PROGRAM_ADDRESS) {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_VAULT,
        encodeU8(vaultIndex, "vaultIndex"),
    ], programAddress);
}

export async function deriveSquadsTransactionAddress(
    multisigAddress,
    transactionIndex,
    programAddress = SQUADS_MULTISIG_PROGRAM_ADDRESS,
) {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_TRANSACTION,
        encodeU64(transactionIndex, "transactionIndex"),
    ], programAddress);
}

export async function deriveSquadsProposalAddress(
    multisigAddress,
    transactionIndex,
    programAddress = SQUADS_MULTISIG_PROGRAM_ADDRESS,
) {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_TRANSACTION,
        encodeU64(transactionIndex, "transactionIndex"),
        SEED_PROPOSAL,
    ], programAddress);
}

export async function deriveSquadsEphemeralSignerAddress(
    transactionAddress,
    ephemeralSignerIndex,
    programAddress = SQUADS_MULTISIG_PROGRAM_ADDRESS,
) {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(transactionAddress),
        SEED_EPHEMERAL_SIGNER,
        encodeU8(ephemeralSignerIndex, "ephemeralSignerIndex"),
    ], programAddress);
}

export function encodeSquadsVaultMessage(message) {
    const parts = [
        encodeU8(message.numSigners, "message.numSigners"),
        encodeU8(message.numWritableSigners, "message.numWritableSigners"),
        encodeU8(message.numWritableNonSigners, "message.numWritableNonSigners"),
        encodeU8(message.accountKeys.length, "message.accountKeys.length"),
    ];
    for (const accountKey of message.accountKeys) {
        parts.push(decodePublicKey(accountKey));
    }
    parts.push(encodeU8(message.instructions.length, "message.instructions.length"));
    for (const instruction of message.instructions) {
        parts.push(encodeU8(instruction.programIdIndex, "instruction.programIdIndex"));
        parts.push(encodeU8(instruction.accountIndexes.length, "instruction.accountIndexes.length"));
        parts.push(new Uint8Array(instruction.accountIndexes));
        parts.push(encodeU16(instruction.data.length, "instruction.data.length"));
        parts.push(instruction.data);
    }
    parts.push(encodeU8(message.addressTableLookups.length, "message.addressTableLookups.length"));
    for (const lookup of message.addressTableLookups) {
        parts.push(decodePublicKey(lookup.accountKey));
        parts.push(encodeU8(lookup.writableIndexes.length, "lookup.writableIndexes.length"));
        parts.push(new Uint8Array(lookup.writableIndexes));
        parts.push(encodeU8(lookup.readonlyIndexes.length, "lookup.readonlyIndexes.length"));
        parts.push(new Uint8Array(lookup.readonlyIndexes));
    }
    return concatenateBytes(parts);
}

function buildVaultTransactionCreate(request) {
    return {
        programAddress: SQUADS_MULTISIG_PROGRAM_ADDRESS,
        accounts: [
            instructionAccount("multisig", request.multisigAddress, false, true),
            instructionAccount("transaction", request.transactionAddress, false, true),
            instructionAccount("creator", request.creatorAddress, true, false),
            instructionAccount("rent_payer", request.rentPayerAddress, true, true),
            instructionAccount("system_program", SOLANA_SYSTEM_PROGRAM_ADDRESS, false, false),
        ],
        data: concatenateBytes([
            new Uint8Array(DISCRIMINATORS.vaultTransactionCreate),
            encodeU8(request.vaultIndex, "vaultIndex"),
            encodeU8(request.ephemeralSignerCount, "ephemeralSignerCount"),
            encodeByteVector(request.transactionMessageBytes),
            encodeOptionalString(request.memo),
        ]),
    };
}

function buildProposalCreate(request) {
    return {
        programAddress: SQUADS_MULTISIG_PROGRAM_ADDRESS,
        accounts: [
            instructionAccount("multisig", request.multisigAddress, false, false),
            instructionAccount("proposal", request.proposalAddress, false, true),
            instructionAccount("creator", request.creatorAddress, true, false),
            instructionAccount("rent_payer", request.rentPayerAddress, true, true),
            instructionAccount("system_program", SOLANA_SYSTEM_PROGRAM_ADDRESS, false, false),
        ],
        data: concatenateBytes([
            new Uint8Array(DISCRIMINATORS.proposalCreate),
            encodeU64(request.transactionIndex, "transactionIndex"),
            new Uint8Array([request.draft ? 1 : 0]),
        ]),
    };
}

function buildProposalActivate(request) {
    return {
        programAddress: SQUADS_MULTISIG_PROGRAM_ADDRESS,
        accounts: [
            instructionAccount("multisig", request.multisigAddress, false, false),
            instructionAccount("member", request.memberAddress, true, true),
            instructionAccount("proposal", request.proposalAddress, false, true),
        ],
        data: new Uint8Array(DISCRIMINATORS.proposalActivate),
    };
}

function buildProposalApprove(request) {
    return {
        programAddress: SQUADS_MULTISIG_PROGRAM_ADDRESS,
        accounts: [
            instructionAccount("multisig", request.multisigAddress, false, false),
            instructionAccount("member", request.memberAddress, true, true),
            instructionAccount("proposal", request.proposalAddress, false, true),
        ],
        data: concatenateBytes([
            new Uint8Array(DISCRIMINATORS.proposalApprove),
            encodeOptionalString(request.memo),
        ]),
    };
}

async function resolveExecutionAccounts(request) {
    const programSignerAddresses = new Set([request.vaultAddress]);
    for (let index = 0; index < request.ephemeralSignerCount; index++) {
        programSignerAddresses.add((await deriveSquadsEphemeralSignerAddress(
            request.transactionAddress,
            index,
        )).address);
    }
    const lookupTableByAddress = new Map();
    for (const table of request.addressLookupTables) {
        lookupTableByAddress.set(normalizePublicKey(table.address), table);
    }
    const accounts = request.message.addressTableLookups.map((lookup, index) => ({
        name: "address_lookup_table_" + String(index),
        address: normalizePublicKey(lookup.accountKey),
        isSigner: false,
        isWritable: false,
    }));
    request.message.accountKeys.forEach((accountAddress, index) => {
        accounts.push({
            name: "static_account_" + String(index),
            address: accountAddress,
            isSigner: index < request.message.numSigners && !programSignerAddresses.has(accountAddress),
            isWritable: index < request.message.numWritableSigners || (
                index >= request.message.numSigners &&
                index < request.message.numSigners + request.message.numWritableNonSigners
            ),
        });
    });
    for (let lookupIndex = 0; lookupIndex < request.message.addressTableLookups.length; lookupIndex++) {
        const lookup = request.message.addressTableLookups[lookupIndex];
        const table = lookupTableByAddress.get(normalizePublicKey(lookup.accountKey));
        if (table === undefined) {
            throw new Error("Missing address lookup table contents for " + lookup.accountKey);
        }
        for (let index = 0; index < lookup.writableIndexes.length; index++) {
            const address = table.addresses[lookup.writableIndexes[index]];
            if (address === undefined) throw new Error("Writable lookup index is outside its table");
            accounts.push({
                name: "writable_lookup_" + String(lookupIndex) + "_" + String(index),
                address: normalizePublicKey(address),
                isSigner: false,
                isWritable: true,
            });
        }
        for (let index = 0; index < lookup.readonlyIndexes.length; index++) {
            const address = table.addresses[lookup.readonlyIndexes[index]];
            if (address === undefined) throw new Error("Readonly lookup index is outside its table");
            accounts.push({
                name: "readonly_lookup_" + String(lookupIndex) + "_" + String(index),
                address: normalizePublicKey(address),
                isSigner: false,
                isWritable: false,
            });
        }
    }
    return accounts;
}

function buildVaultTransactionExecute(request) {
    return {
        programAddress: SQUADS_MULTISIG_PROGRAM_ADDRESS,
        accounts: [
            instructionAccount("multisig", request.multisigAddress, false, false),
            instructionAccount("proposal", request.proposalAddress, false, true),
            instructionAccount("transaction", request.transactionAddress, false, false),
            instructionAccount("member", request.memberAddress, true, false),
            ...request.remainingAccounts,
        ],
        data: new Uint8Array(DISCRIMINATORS.vaultTransactionExecute),
    };
}

export async function buildSquadsProposal(request) {
    const vaultIndex = request.vaultIndex ?? 0;
    const ephemeralSignerCount = request.ephemeralSignerCount ?? 0;
    const addressLookupTables = request.addressLookupTables ?? [];
    const rentPayerAddress = request.rentPayerAddress ?? request.creatorAddress;
    const approvalMemberAddress = request.approvalMemberAddress ?? request.creatorAddress;
    const executorMemberAddress = request.executorMemberAddress ?? request.creatorAddress;
    const draft = request.draft ?? false;
    const vault = await deriveSquadsVaultAddress(request.multisigAddress, vaultIndex);
    const transaction = await deriveSquadsTransactionAddress(request.multisigAddress, request.transactionIndex);
    const proposal = await deriveSquadsProposalAddress(request.multisigAddress, request.transactionIndex);
    const transactionMessage = compileSquadsVaultMessage(
        request.instructions,
        vault.address,
        addressLookupTables,
    );
    if (transactionMessage.accountKeys[0] !== vault.address) {
        throw new Error("Squads vault is not the message payer");
    }
    const transactionMessageBytes = encodeSquadsVaultMessage(transactionMessage);
    const creation = [
        buildVaultTransactionCreate({
            multisigAddress: request.multisigAddress,
            transactionAddress: transaction.address,
            creatorAddress: request.creatorAddress,
            rentPayerAddress,
            vaultIndex,
            ephemeralSignerCount,
            transactionMessageBytes,
            memo: request.memo,
        }),
        buildProposalCreate({
            multisigAddress: request.multisigAddress,
            proposalAddress: proposal.address,
            creatorAddress: request.creatorAddress,
            rentPayerAddress,
            transactionIndex: request.transactionIndex,
            draft,
        }),
    ];
    const activation = draft ? buildProposalActivate({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        memberAddress: request.creatorAddress,
    }) : null;
    const approval = buildProposalApprove({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        memberAddress: approvalMemberAddress,
        memo: request.approvalMemo,
    });
    const remainingAccounts = await resolveExecutionAccounts({
        message: transactionMessage,
        vaultAddress: vault.address,
        transactionAddress: transaction.address,
        ephemeralSignerCount,
        addressLookupTables,
    });
    const execution = buildVaultTransactionExecute({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        transactionAddress: transaction.address,
        memberAddress: executorMemberAddress,
        remainingAccounts,
    });
    return {
        addresses: { vault, transaction, proposal },
        transactionMessage,
        transactionMessageBytes,
        instructions: { creation, activation, approval, execution },
    };
}
