import { normalizePublicKey } from "../Base58Codec.js";
import type {
    SolanaInstruction,
    SolanaInstructionAccountMeta,
} from "../SolanaTransaction.js";
import {
    concatenateBytes,
    encodeBoolean,
    encodeByteVector,
    encodeOptionalString,
    encodeU8,
    encodeU64,
    type UnsignedIntegerInput,
} from "./SquadsCodec.js";
import {
    SOLANA_SYSTEM_PROGRAM_ADDRESS,
    SQUADS_INSTRUCTION_DISCRIMINATORS,
    SQUADS_MULTISIG_PROGRAM_ADDRESS,
} from "./SquadsProgram.js";

export interface SquadsVaultTransactionCreateRequest {
    readonly multisigAddress: string | Uint8Array;
    readonly transactionAddress: string | Uint8Array;
    readonly creatorAddress: string | Uint8Array;
    readonly rentPayerAddress?: string | Uint8Array;
    readonly vaultIndex: UnsignedIntegerInput;
    readonly ephemeralSignerCount?: UnsignedIntegerInput;
    readonly transactionMessageBytes: Uint8Array;
    readonly memo?: string | null;
    readonly programAddress?: string | Uint8Array;
}

export interface SquadsProposalCreateRequest {
    readonly multisigAddress: string | Uint8Array;
    readonly proposalAddress: string | Uint8Array;
    readonly creatorAddress: string | Uint8Array;
    readonly rentPayerAddress?: string | Uint8Array;
    readonly transactionIndex: UnsignedIntegerInput;
    readonly draft?: boolean;
    readonly programAddress?: string | Uint8Array;
}

export interface SquadsProposalMemberRequest {
    readonly multisigAddress: string | Uint8Array;
    readonly proposalAddress: string | Uint8Array;
    readonly memberAddress: string | Uint8Array;
    readonly programAddress?: string | Uint8Array;
}

export interface SquadsProposalApproveRequest extends SquadsProposalMemberRequest {
    readonly memo?: string | null;
}

export interface SquadsVaultTransactionExecuteRequest {
    readonly multisigAddress: string | Uint8Array;
    readonly proposalAddress: string | Uint8Array;
    readonly transactionAddress: string | Uint8Array;
    readonly memberAddress: string | Uint8Array;
    readonly remainingAccounts: readonly SolanaInstructionAccountMeta[];
    readonly programAddress?: string | Uint8Array;
}

function accountMeta(
    name: string,
    address: string | Uint8Array,
    isSigner: boolean,
    isWritable: boolean,
): SolanaInstructionAccountMeta {
    return {
        name,
        address: normalizePublicKey(address),
        isSigner,
        isWritable,
    };
}

function programAddress(value: string | Uint8Array | undefined): string {
    return normalizePublicKey(value ?? SQUADS_MULTISIG_PROGRAM_ADDRESS);
}

export function buildSquadsVaultTransactionCreateInstruction(
    request: SquadsVaultTransactionCreateRequest,
): SolanaInstruction {
    const creatorAddress = normalizePublicKey(request.creatorAddress);
    const rentPayerAddress = request.rentPayerAddress === undefined
        ? creatorAddress
        : normalizePublicKey(request.rentPayerAddress);
    return {
        programAddress: programAddress(request.programAddress),
        accounts: [
            accountMeta("multisig", request.multisigAddress, false, true),
            accountMeta("transaction", request.transactionAddress, false, true),
            accountMeta("creator", creatorAddress, true, false),
            accountMeta("rent_payer", rentPayerAddress, true, true),
            accountMeta("system_program", SOLANA_SYSTEM_PROGRAM_ADDRESS, false, false),
        ],
        data: concatenateBytes([
            new Uint8Array(SQUADS_INSTRUCTION_DISCRIMINATORS.vaultTransactionCreate),
            encodeU8(request.vaultIndex, "vaultIndex"),
            encodeU8(request.ephemeralSignerCount ?? 0, "ephemeralSignerCount"),
            encodeByteVector(request.transactionMessageBytes, "transactionMessageBytes"),
            encodeOptionalString(request.memo, "memo"),
        ]),
    };
}

export function buildSquadsProposalCreateInstruction(
    request: SquadsProposalCreateRequest,
): SolanaInstruction {
    const creatorAddress = normalizePublicKey(request.creatorAddress);
    const rentPayerAddress = request.rentPayerAddress === undefined
        ? creatorAddress
        : normalizePublicKey(request.rentPayerAddress);
    return {
        programAddress: programAddress(request.programAddress),
        accounts: [
            accountMeta("multisig", request.multisigAddress, false, false),
            accountMeta("proposal", request.proposalAddress, false, true),
            accountMeta("creator", creatorAddress, true, false),
            accountMeta("rent_payer", rentPayerAddress, true, true),
            accountMeta("system_program", SOLANA_SYSTEM_PROGRAM_ADDRESS, false, false),
        ],
        data: concatenateBytes([
            new Uint8Array(SQUADS_INSTRUCTION_DISCRIMINATORS.proposalCreate),
            encodeU64(request.transactionIndex, "transactionIndex"),
            encodeBoolean(request.draft ?? false),
        ]),
    };
}

export function buildSquadsProposalActivateInstruction(
    request: SquadsProposalMemberRequest,
): SolanaInstruction {
    return {
        programAddress: programAddress(request.programAddress),
        accounts: [
            accountMeta("multisig", request.multisigAddress, false, false),
            accountMeta("member", request.memberAddress, true, true),
            accountMeta("proposal", request.proposalAddress, false, true),
        ],
        data: new Uint8Array(SQUADS_INSTRUCTION_DISCRIMINATORS.proposalActivate),
    };
}

export function buildSquadsProposalApproveInstruction(
    request: SquadsProposalApproveRequest,
): SolanaInstruction {
    return {
        programAddress: programAddress(request.programAddress),
        accounts: [
            accountMeta("multisig", request.multisigAddress, false, false),
            accountMeta("member", request.memberAddress, true, true),
            accountMeta("proposal", request.proposalAddress, false, true),
        ],
        data: concatenateBytes([
            new Uint8Array(SQUADS_INSTRUCTION_DISCRIMINATORS.proposalApprove),
            encodeOptionalString(request.memo, "memo"),
        ]),
    };
}

export function buildSquadsVaultTransactionExecuteInstruction(
    request: SquadsVaultTransactionExecuteRequest,
): SolanaInstruction {
    return {
        programAddress: programAddress(request.programAddress),
        accounts: [
            accountMeta("multisig", request.multisigAddress, false, false),
            accountMeta("proposal", request.proposalAddress, false, true),
            accountMeta("transaction", request.transactionAddress, false, false),
            accountMeta("member", request.memberAddress, true, false),
            ...request.remainingAccounts,
        ],
        data: new Uint8Array(SQUADS_INSTRUCTION_DISCRIMINATORS.vaultTransactionExecute),
    };
}
