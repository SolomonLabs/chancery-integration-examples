import { decodePublicKey } from "../Base58Codec.js";
import { findProgramAddress, type ProgramAddressResult } from "../ProgramAddress.js";
import { encodeU8, encodeU64, type UnsignedIntegerInput } from "./SquadsCodec.js";
import { SQUADS_MULTISIG_PROGRAM_ADDRESS } from "./SquadsProgram.js";

const TEXT_ENCODER = new TextEncoder();
const SEED_PREFIX = TEXT_ENCODER.encode("multisig");
const SEED_VAULT = TEXT_ENCODER.encode("vault");
const SEED_TRANSACTION = TEXT_ENCODER.encode("transaction");
const SEED_PROPOSAL = TEXT_ENCODER.encode("proposal");
const SEED_EPHEMERAL_SIGNER = TEXT_ENCODER.encode("ephemeral_signer");

export function deriveSquadsVaultAddress(
    multisigAddress: string | Uint8Array,
    vaultIndex: UnsignedIntegerInput,
    programAddress: string | Uint8Array = SQUADS_MULTISIG_PROGRAM_ADDRESS,
): ProgramAddressResult {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_VAULT,
        encodeU8(vaultIndex, "vaultIndex"),
    ], programAddress);
}

export function deriveSquadsTransactionAddress(
    multisigAddress: string | Uint8Array,
    transactionIndex: UnsignedIntegerInput,
    programAddress: string | Uint8Array = SQUADS_MULTISIG_PROGRAM_ADDRESS,
): ProgramAddressResult {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_TRANSACTION,
        encodeU64(transactionIndex, "transactionIndex"),
    ], programAddress);
}

export function deriveSquadsProposalAddress(
    multisigAddress: string | Uint8Array,
    transactionIndex: UnsignedIntegerInput,
    programAddress: string | Uint8Array = SQUADS_MULTISIG_PROGRAM_ADDRESS,
): ProgramAddressResult {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(multisigAddress),
        SEED_TRANSACTION,
        encodeU64(transactionIndex, "transactionIndex"),
        SEED_PROPOSAL,
    ], programAddress);
}

export function deriveSquadsEphemeralSignerAddress(
    transactionAddress: string | Uint8Array,
    ephemeralSignerIndex: UnsignedIntegerInput,
    programAddress: string | Uint8Array = SQUADS_MULTISIG_PROGRAM_ADDRESS,
): ProgramAddressResult {
    return findProgramAddress([
        SEED_PREFIX,
        decodePublicKey(transactionAddress),
        SEED_EPHEMERAL_SIGNER,
        encodeU8(ephemeralSignerIndex, "ephemeralSignerIndex"),
    ], programAddress);
}
