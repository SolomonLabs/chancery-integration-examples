import { findProgramAddress } from "../../../typescript/src/ProgramAddress.js";
import { FAUCET_PROGRAM_ADDRESS } from "../configuration/Deployment.js";

export type ControllerRole = 0 | 1 | 2 | 3 | 4;
export const CONTROLLER_ROLES: readonly ControllerRole[] = [0, 1, 2, 3, 4];

export function controllerAuthority(role: ControllerRole): string {
    return findProgramAddress([new TextEncoder().encode("chancery-authority"), Uint8Array.of(role)], FAUCET_PROGRAM_ADDRESS).address;
}

export function faucetAuthority(): string {
    return findProgramAddress([new TextEncoder().encode("faucet-authority")], FAUCET_PROGRAM_ADDRESS).address;
}
