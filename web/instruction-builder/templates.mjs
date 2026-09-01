import { SQUADS_VAULT_TOKEN } from "./squads.mjs";

const ZERO_BYTES_32 = "0x" + "00".repeat(32);

export const INSTRUCTION_TEMPLATES = [
    {
        id: "mint-direct",
        label: "Mint direct",
        description: "Build mint_direct with the Squads vault as the Chancery principal.",
        instructionName: "mint_direct",
        squads: true,
        arguments: {
            pathway_id: ZERO_BYTES_32,
            asset_amount: "0",
            minimum_issued_token_amount: "0",
        },
        accounts: { principal: SQUADS_VAULT_TOKEN },
    },
    {
        id: "mint-delegated",
        label: "Mint delegated",
        description: "Build mint_delegated with the Squads vault as the executor of an existing settlement intent.",
        instructionName: "mint_delegated",
        squads: true,
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { executor: SQUADS_VAULT_TOKEN },
    },
    {
        id: "mint-trilateral",
        label: "Mint trilateral",
        description: "Build mint_trilateral with the Squads vault as the executor; principal A and principal B co-sign.",
        instructionName: "mint_trilateral",
        squads: true,
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { executor: SQUADS_VAULT_TOKEN },
    },
    {
        id: "redeem-direct",
        label: "Redeem direct",
        description: "Build redeem_direct with the Squads vault as the Chancery principal.",
        instructionName: "redeem_direct",
        squads: true,
        arguments: {
            pathway_id: ZERO_BYTES_32,
            issued_token_amount: "0",
            minimum_asset_amount: "0",
        },
        accounts: { principal: SQUADS_VAULT_TOKEN },
    },
    {
        id: "redeem-delegated",
        label: "Redeem delegated",
        description: "Build redeem_delegated with the Squads vault as the executor of an existing settlement intent.",
        instructionName: "redeem_delegated",
        squads: true,
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { executor: SQUADS_VAULT_TOKEN },
    },
    {
        id: "redeem-trilateral",
        label: "Redeem trilateral",
        description: "Build redeem_trilateral with the Squads vault as the executor; principal A and principal B co-sign.",
        instructionName: "redeem_trilateral",
        squads: true,
        arguments: {
            intent_id: ZERO_BYTES_32,
            pathway_id: ZERO_BYTES_32,
        },
        accounts: { executor: SQUADS_VAULT_TOKEN },
    },
];
