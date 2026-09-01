import type {
    AddressLookupTable,
    SolanaInstruction,
} from "../SolanaTransaction.js";
import type { ProgramAddressResult } from "../ProgramAddress.js";
import type { UnsignedIntegerInput } from "./SquadsCodec.js";
import {
    buildSquadsProposalActivateInstruction,
    buildSquadsProposalApproveInstruction,
    buildSquadsProposalCreateInstruction,
    buildSquadsVaultTransactionCreateInstruction,
    buildSquadsVaultTransactionExecuteInstruction,
} from "./SquadsInstruction.js";
import {
    deriveSquadsProposalAddress,
    deriveSquadsTransactionAddress,
    deriveSquadsVaultAddress,
} from "./SquadsPda.js";
import { SQUADS_MULTISIG_PROGRAM_ADDRESS } from "./SquadsProgram.js";
import {
    compileSquadsVaultTransactionMessage,
    encodeSquadsVaultTransactionMessage,
    resolveSquadsVaultTransactionExecuteAccounts,
    type SquadsVaultTransactionMessage,
} from "./SquadsVaultMessage.js";

export interface BuildSquadsProposalRequest {
    readonly multisigAddress: string | Uint8Array;
    readonly creatorAddress: string | Uint8Array;
    readonly transactionIndex: UnsignedIntegerInput;
    readonly instructions: readonly SolanaInstruction[];
    readonly vaultIndex?: UnsignedIntegerInput;
    readonly rentPayerAddress?: string | Uint8Array;
    readonly approvalMemberAddress?: string | Uint8Array;
    readonly executorMemberAddress?: string | Uint8Array;
    readonly draft?: boolean;
    readonly memo?: string | null;
    readonly approvalMemo?: string | null;
    readonly ephemeralSignerCount?: number;
    readonly addressLookupTables?: readonly AddressLookupTable[];
    readonly programAddress?: string | Uint8Array;
}

export interface SquadsProposalAddresses {
    readonly vault: ProgramAddressResult;
    readonly transaction: ProgramAddressResult;
    readonly proposal: ProgramAddressResult;
}

export interface SquadsProposalInstructions {
    readonly creation: readonly [SolanaInstruction, SolanaInstruction];
    readonly activation: SolanaInstruction | null;
    readonly approval: SolanaInstruction;
    readonly execution: SolanaInstruction;
}

export interface SquadsProposalBundle {
    readonly addresses: SquadsProposalAddresses;
    readonly transactionMessage: SquadsVaultTransactionMessage;
    readonly transactionMessageBytes: Uint8Array;
    readonly instructions: SquadsProposalInstructions;
}

export function buildSquadsProposalBundle(request: BuildSquadsProposalRequest): SquadsProposalBundle {
    const vaultIndex = request.vaultIndex ?? 0;
    const programAddress = request.programAddress ?? SQUADS_MULTISIG_PROGRAM_ADDRESS;
    const addressLookupTables = request.addressLookupTables ?? [];
    const ephemeralSignerCount = request.ephemeralSignerCount ?? 0;
    const approvalMemberAddress = request.approvalMemberAddress ?? request.creatorAddress;
    const executorMemberAddress = request.executorMemberAddress ?? request.creatorAddress;
    const draft = request.draft ?? false;

    const vault = deriveSquadsVaultAddress(request.multisigAddress, vaultIndex, programAddress);
    const transaction = deriveSquadsTransactionAddress(
        request.multisigAddress,
        request.transactionIndex,
        programAddress,
    );
    const proposal = deriveSquadsProposalAddress(
        request.multisigAddress,
        request.transactionIndex,
        programAddress,
    );
    const transactionMessage = compileSquadsVaultTransactionMessage(
        request.instructions,
        vault.address,
        addressLookupTables,
    );
    const transactionMessageBytes = encodeSquadsVaultTransactionMessage(transactionMessage);

    const createTransactionInstruction = buildSquadsVaultTransactionCreateInstruction({
        multisigAddress: request.multisigAddress,
        transactionAddress: transaction.address,
        creatorAddress: request.creatorAddress,
        ...(request.rentPayerAddress === undefined ? {} : { rentPayerAddress: request.rentPayerAddress }),
        vaultIndex,
        ephemeralSignerCount,
        transactionMessageBytes,
        ...(request.memo === undefined ? {} : { memo: request.memo }),
        programAddress,
    });
    const createProposalInstruction = buildSquadsProposalCreateInstruction({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        creatorAddress: request.creatorAddress,
        ...(request.rentPayerAddress === undefined ? {} : { rentPayerAddress: request.rentPayerAddress }),
        transactionIndex: request.transactionIndex,
        draft,
        programAddress,
    });
    const activationInstruction = draft
        ? buildSquadsProposalActivateInstruction({
            multisigAddress: request.multisigAddress,
            proposalAddress: proposal.address,
            memberAddress: request.creatorAddress,
            programAddress,
        })
        : null;
    const approvalInstruction = buildSquadsProposalApproveInstruction({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        memberAddress: approvalMemberAddress,
        ...(request.approvalMemo === undefined ? {} : { memo: request.approvalMemo }),
        programAddress,
    });
    const executionAccounts = resolveSquadsVaultTransactionExecuteAccounts({
        message: transactionMessage,
        vaultAddress: vault.address,
        transactionAddress: transaction.address,
        ephemeralSignerCount,
        addressLookupTables,
        programAddress,
    });
    const executionInstruction = buildSquadsVaultTransactionExecuteInstruction({
        multisigAddress: request.multisigAddress,
        proposalAddress: proposal.address,
        transactionAddress: transaction.address,
        memberAddress: executorMemberAddress,
        remainingAccounts: executionAccounts,
        programAddress,
    });

    return {
        addresses: { vault, transaction, proposal },
        transactionMessage,
        transactionMessageBytes,
        instructions: {
            creation: [createTransactionInstruction, createProposalInstruction],
            activation: activationInstruction,
            approval: approvalInstruction,
            execution: executionInstruction,
        },
    };
}
