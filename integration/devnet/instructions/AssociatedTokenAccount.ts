import { normalizePublicKey } from "../../../typescript/src/Base58Codec.js";
import { SYSTEM_PROGRAM_ADDRESS } from "../../../typescript/src/ChancerySchema.js";
import type { SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, assertSupportedTokenProgram, deriveAssociatedTokenAddress } from "../../../typescript/src/SplToken.js";

export function createAssociatedTokenAccountInstruction(payer: string, owner: string, mint: string,
    tokenProgramAddress: string): SolanaInstruction {
    const tokenProgram = assertSupportedTokenProgram(tokenProgramAddress);
    return {
        programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
        accounts: [
            { address: normalizePublicKey(payer), isSigner: true, isWritable: true },
            { address: deriveAssociatedTokenAddress(owner, mint, tokenProgram).address, isSigner: false, isWritable: true },
            { address: normalizePublicKey(owner), isSigner: false, isWritable: false },
            { address: normalizePublicKey(mint), isSigner: false, isWritable: false },
            { address: SYSTEM_PROGRAM_ADDRESS, isSigner: false, isWritable: false },
            { address: tokenProgram, isSigner: false, isWritable: false },
        ],
        data: Uint8Array.of(1),
    };
}
