import { buildChanceryInstruction } from "../../../typescript/src/ChanceryInstruction.js";
import { ZERO_ADDRESS } from "../../../typescript/src/ChancerySchema.js";
import { bytes32Hex } from "../../../typescript/src/client/ChanceryProtocol.js";
import type { MintDirectOperationInput, RedeemDirectOperationInput } from "../../typescript/src/model.js";
import type { DirectOperationInspection } from "./Types.js";

export function directOperationDocument(inspection: DirectOperationInspection): MintDirectOperationInput | RedeemDirectOperationInput {
    if (!inspection.ready || inspection.request.mode !== "direct") {
        throw new Error("Operation requires a ready direct settlement inspection: " + inspection.blockingIssues.join("; "));
    }
    if (inspection.instructionName !== inspection.request.action + "_direct") {
        throw new Error("Inspection instruction differs from its direct settlement action");
    }
    const instruction = buildChanceryInstruction(
        inspection.instructionName, inspection.instructionArguments, inspection.instructionAccounts, true,
    );
    const address = (name: string): string => {
        const account = instruction.accounts.find((candidate) => candidate.name === name);
        if (account === undefined) throw new Error("Resolved operation account is missing: " + name);
        return account.address;
    };
    const policyAddress = (name: string): string | null => {
        const value = address(name);
        return value === ZERO_ADDRESS ? null : value;
    };
    const accounts = {
        moduleActivationState: address("module_activation_state"),
        chanceryConfig: address("chancery_config"),
        eventAuthority: address("event_authority"),
        pauseState: address("pause_state"),
        assetConfig: address("asset_config"),
        pathwayPolicy: address("pathway_policy"),
        permissionRecord: address("permission_record"),
        reserveAssetTokenAccount: address("reserve_asset_token_account"),
        assetMint: address("asset_mint"),
        issuedTokenMint: address("issued_token_mint"),
        assetTokenProgram: address("asset_token_program"),
        issuedTokenProgram: address("issued_token_program"),
        principal: address("principal"),
        assetPauseState: address("asset_pause_state"),
        issuedTokenControl: address("issued_token_control"),
        policyAccounts: {
            feePolicy: policyAddress("fee_policy"),
            feeRecipientTokenAccount: policyAddress("fee_recipient_token_account"),
            limitPolicy: policyAddress("limit_policy"),
            hourlyUsageWindow: policyAddress("hourly_usage_window"),
            dailyUsageWindow: policyAddress("daily_usage_window"),
            weeklyUsageWindow: policyAddress("weekly_usage_window"),
            monthlyUsageWindow: policyAddress("monthly_usage_window"),
            evidencePolicy: policyAddress("evidence_policy"),
            assetLimitPolicy: policyAddress("asset_limit_policy"),
            assetDailyUsageWindow: policyAddress("asset_daily_usage_window"),
            counterpartyLimitPolicy: policyAddress("counterparty_limit_policy"),
            counterpartyDailyUsageWindow: policyAddress("counterparty_daily_usage_window"),
        },
    };
    const operation = {
        pathwayId: bytes32Hex(inspection.instructionArguments.pathway_id, "pathway id"),
        amount: inspection.amounts.inputAmount.toString(),
        minimumOutput: inspection.amounts.minimumOutput.toString(),
    };
    if (inspection.request.action === "mint") {
        return { ...operation, accounts: {
            ...accounts,
            sourceAssetTokenAccount: address("source_asset_token_account"),
            destinationIssuedTokenAccount: address("destination_issued_token_account"),
            mintAuthorityPda: address("mint_authority_pda"),
        } };
    }
    return { ...operation, accounts: {
        ...accounts,
        sourceIssuedTokenAccount: address("source_issued_token_account"),
        destinationAssetTokenAccount: address("destination_asset_token_account"),
        reserveAuthorityPda: address("reserve_authority_pda"),
    } };
}
