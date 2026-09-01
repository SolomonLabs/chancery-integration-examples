import { ISSUED_TOKEN_MINT } from "./mints.mjs";

const ZERO_BYTES_32 = "0x" + "00".repeat(32);

export const INSTRUCTION_TEMPLATES = [
    {
        id: "mint-direct",
        label: "Mint direct",
        description: "Build mint_direct. When wrapped, the Squads vault is the Chancery principal.",
        instructionName: "mint_direct",
        arguments: {
            pathway_id: ZERO_BYTES_32,
            asset_amount: "0",
            minimum_issued_token_amount: "0",
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["principal"],
    },
    {
        id: "mint-delegated",
        label: "Mint delegated",
        description: "Build mint_delegated against an existing settlement intent. When wrapped, the Squads vault is the executor.",
        instructionName: "mint_delegated",
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["executor"],
    },
    {
        id: "mint-trilateral",
        label: "Mint trilateral",
        description: "Build mint_trilateral against an existing settlement intent; principal A and principal B co-sign. When wrapped, the Squads vault is the executor.",
        instructionName: "mint_trilateral",
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["executor"],
    },
    {
        id: "redeem-direct",
        label: "Redeem direct",
        description: "Build redeem_direct. When wrapped, the Squads vault is the Chancery principal.",
        instructionName: "redeem_direct",
        arguments: {
            pathway_id: ZERO_BYTES_32,
            issued_token_amount: "0",
            minimum_asset_amount: "0",
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["principal"],
    },
    {
        id: "redeem-delegated",
        label: "Redeem delegated",
        description: "Build redeem_delegated against an existing settlement intent. When wrapped, the Squads vault is the executor.",
        instructionName: "redeem_delegated",
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["executor"],
    },
    {
        id: "redeem-trilateral",
        label: "Redeem trilateral",
        description: "Build redeem_trilateral against an existing settlement intent; principal A and principal B co-sign. When wrapped, the Squads vault is the executor.",
        instructionName: "redeem_trilateral",
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { issued_token_mint: ISSUED_TOKEN_MINT },
        vaultAccounts: ["executor"],
    },
];
