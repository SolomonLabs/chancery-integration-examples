export function chanceryProgramIdForTarget(target: string = "mainnet"): string {
    switch (target) {
        case "mainnet": return "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz";
        case "devnet": return "3doMTb5u94mzTDoBbyJXbZscNE3suuQe75ybYmirKute";
        default: throw new Error("CHANCERY_TARGET must be mainnet or devnet");
    }
}
