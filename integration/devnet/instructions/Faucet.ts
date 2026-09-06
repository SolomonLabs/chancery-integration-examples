import { normalizePublicKey } from "../../../typescript/src/Base58Codec.js";
import { encodeType } from "../../../typescript/src/BinaryCodec.js";
import type { SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { assertSupportedTokenProgram } from "../../../typescript/src/SplToken.js";
import { FAUCET_PROGRAM_ADDRESS } from "../configuration/Deployment.js";
import { faucetAuthority } from "../controller/Authority.js";

export function mintTestAssetInstruction(mint: string, destination: string, tokenProgramAddress: string,
    amount: bigint, decimals: number): SolanaInstruction {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 15) throw new Error("Faucet mint decimals must be between 0 and 15");
    if (amount <= 0n || amount > 10_000n * 10n ** BigInt(decimals)) throw new Error("Faucet amount must be positive and at most 10,000 whole tokens");
    return {
        programAddress: FAUCET_PROGRAM_ADDRESS,
        accounts: [
            { address: normalizePublicKey(mint), isSigner: false, isWritable: true },
            { address: normalizePublicKey(destination), isSigner: false, isWritable: true },
            { address: faucetAuthority(), isSigner: false, isWritable: false },
            { address: assertSupportedTokenProgram(tokenProgramAddress), isSigner: false, isWritable: false },
        ],
        data: Uint8Array.from([0, ...encodeType("u64", amount, "amount")]),
    };
}
