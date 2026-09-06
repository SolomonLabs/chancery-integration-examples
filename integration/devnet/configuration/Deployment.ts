import { CHANCERY_DEVNET_PROGRAM_ADDRESS, CHANCERY_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "../../../typescript/src/SplToken.js";

export interface TestAsset {
    readonly symbol: string;
    readonly mint: string;
    readonly tokenProgramAddress: string;
}

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const FAUCET_PROGRAM_ADDRESS = "6JgE46kwvTqPpY7s2DDjFDvSqWdmfm9puoDBRqHubn85";
export const ISSUED_TOKEN_MINT = "FEA2m8pnzXLXdh3irYhJPKgmLhK23sdSgB1KjmXqyVqz";
export const TEST_ASSETS: readonly TestAsset[] = [
    { symbol: "USDC", mint: "A3wGiSTtQLaEBLnYMSDUUgrSzs3b9gQpyah1sVowHFce", tokenProgramAddress: SPL_TOKEN_PROGRAM_ADDRESS },
    { symbol: "USDT", mint: "G4WrQJD2nu61VuCVv3wpZt4FB92Hb3UJPMU4kMdvoTz7", tokenProgramAddress: SPL_TOKEN_PROGRAM_ADDRESS },
    { symbol: "USDG", mint: "4y7HzfopqgJp87S6uyuMaMy3TB6ME1oqQkFpZZoRvtnj", tokenProgramAddress: TOKEN_2022_PROGRAM_ADDRESS },
    { symbol: "PYUSD", mint: "BLCaBUQ591XkddMF7HZVwpFayutrW5wfdYBxkvL3w2r8", tokenProgramAddress: TOKEN_2022_PROGRAM_ADDRESS },
];

export function requireDevnetTarget(): void {
    if (process.env.CHANCERY_TARGET !== "devnet" || CHANCERY_PROGRAM_ADDRESS !== CHANCERY_DEVNET_PROGRAM_ADDRESS) {
        throw new Error("Devnet tooling requires CHANCERY_TARGET=devnet before the process starts");
    }
}

export function testAssetForSymbol(symbol: string): TestAsset {
    const asset = TEST_ASSETS.find((candidate) => candidate.symbol === symbol);
    if (asset === undefined) throw new Error("--symbol must be USDC, USDT, USDG, or PYUSD");
    return asset;
}
