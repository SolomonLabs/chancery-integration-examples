export const CHANCERY_MAINNET_PROGRAM_ADDRESS = "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz";
export const CHANCERY_DEVNET_PROGRAM_ADDRESS = "3doMTb5u94mzTDoBbyJXbZscNE3suuQe75ybYmirKute";

export function chanceryProgramAddressForTarget(target: string = "mainnet"): string {
    switch (target) {
        case "mainnet": return CHANCERY_MAINNET_PROGRAM_ADDRESS;
        case "devnet": return CHANCERY_DEVNET_PROGRAM_ADDRESS;
        default: throw new Error("CHANCERY_TARGET must be mainnet or devnet");
    }
}

export const CHANCERY_PROGRAM_ADDRESS = chanceryProgramAddressForTarget(process.env.CHANCERY_TARGET);
