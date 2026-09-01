export const SQUADS_MULTISIG_PROGRAM_ADDRESS = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const SOLANA_SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

export const SQUADS_INSTRUCTION_DISCRIMINATORS = {
    vaultTransactionCreate: [48, 250, 78, 168, 208, 226, 218, 211],
    vaultTransactionExecute: [194, 8, 161, 87, 153, 164, 25, 171],
    proposalCreate: [220, 60, 73, 224, 30, 108, 79, 159],
    proposalActivate: [11, 34, 92, 248, 154, 27, 51, 106],
    proposalApprove: [144, 37, 164, 136, 188, 216, 42, 248],
} as const;
