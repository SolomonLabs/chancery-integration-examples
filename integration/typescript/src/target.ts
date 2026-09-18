export function chanceryProgramIdForTarget(target: string = "mainnet"): string {
    switch (target) {
        case "mainnet": return "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz";
        case "devnet": return "GD9qamyghF32gG21KEkbp6quBsd2tU771tFcRVu1SPKs";
        default: throw new Error("CHANCERY_TARGET must be mainnet or devnet");
    }
}
