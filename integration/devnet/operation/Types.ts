import type { SettlementInspection } from "../../../typescript/src/client/ChanceryClient.js";

export type DirectOperationInspection = Pick<SettlementInspection,
    "ready" | "blockingIssues" | "instructionName" | "instructionArguments" | "instructionAccounts"
> & {
    readonly request: Pick<SettlementInspection["request"], "mode" | "action">;
    readonly amounts: Pick<SettlementInspection["amounts"], "inputAmount" | "minimumOutput">;
};
