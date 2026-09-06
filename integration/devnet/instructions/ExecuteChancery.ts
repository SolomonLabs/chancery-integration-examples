import { normalizePublicKey } from "../../../typescript/src/Base58Codec.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import type { SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { FAUCET_PROGRAM_ADDRESS } from "../configuration/Deployment.js";
import { CONTROLLER_ROLES, controllerAuthority } from "../controller/Authority.js";

export function executeChanceryInstruction(caller: string, instruction: SolanaInstruction): SolanaInstruction {
    if (instruction.programAddress !== CHANCERY_DEVNET_PROGRAM_ADDRESS || instruction.data.length < 2) {
        throw new Error("Controller instructions must target the configured devnet Chancery program");
    }
    const normalizedCaller = normalizePublicKey(caller);
    let roleMask = 0;
    const authorities = new Set<string>();
    for (const role of CONTROLLER_ROLES) {
        const authority = controllerAuthority(role);
        if (instruction.accounts.some((account) => account.isSigner && account.address === authority)) {
            roleMask |= 1 << role;
            authorities.add(authority);
        }
    }
    if (roleMask === 0) throw new Error("Chancery administration requires at least one controller authority signer");
    const accounts = instruction.accounts.map((account) => {
        if (account.isSigner && !authorities.has(account.address) && account.address !== normalizedCaller) {
            throw new Error("Additional signer required: " + account.address);
        }
        return { ...account, isSigner: account.isSigner && !authorities.has(account.address) };
    });
    return {
        programAddress: FAUCET_PROGRAM_ADDRESS,
        accounts: [
            { address: normalizedCaller, isSigner: true, isWritable: false },
            { address: instruction.programAddress, isSigner: false, isWritable: false },
            ...accounts,
        ],
        data: Uint8Array.from([1, roleMask, ...instruction.data]),
    };
}
