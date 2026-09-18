import { CHANCERY_DEVNET_PROGRAM_ADDRESS, CHANCERY_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { SPL_TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS } from "../../../typescript/src/SplToken.js";

export interface TestAsset {
    readonly symbol: string;
    readonly mint: string;
    readonly tokenProgramAddress: string;
}

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const FAUCET_PROGRAM_ADDRESS = "5Hk5sfd1LzMZP5bcEceep1bqnQvBwxBUXxqPAVkWNr5t";
export const ISSUED_TOKEN_MINT = "Wdek6QzQzHoT822HLPUHWowYrRHUcX4w5CRfRYQ5fh2";
export const TEST_ASSETS: readonly TestAsset[] = [
    { symbol: "USDC", mint: "BJQqgRMVL4skTdZrG84Jr9SVeRf3kDmrwxGprsxKXpWi", tokenProgramAddress: SPL_TOKEN_PROGRAM_ADDRESS },
    { symbol: "USDT", mint: "5UwxHbseoNMBPWhJF7b8L3W62HNqfvQMeqwSVb9DCX3J", tokenProgramAddress: SPL_TOKEN_PROGRAM_ADDRESS },
    { symbol: "USDG", mint: "Gudt7yXy3F2pijueq4HTD4SFNjTpcM1Uvj1iqgw7LA5E", tokenProgramAddress: TOKEN_2022_PROGRAM_ADDRESS },
    { symbol: "PYUSD", mint: "HHfaFx4QHomyZv75s2bVbnuGWAufAxfC1a8JAzozH3yk", tokenProgramAddress: TOKEN_2022_PROGRAM_ADDRESS },
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
