export interface AccountMetaSpec {
    readonly name: string;
    readonly address: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
}

export interface InstructionSpec {
    readonly programId: string;
    readonly accounts: readonly AccountMetaSpec[];
    readonly data: Uint8Array;
}

export interface DirectSettlementPolicyAccountsInput {
    readonly feePolicy: string | null;
    readonly feeRecipientTokenAccount: string | null;
    readonly limitPolicy: string | null;
    readonly hourlyUsageWindow: string | null;
    readonly dailyUsageWindow: string | null;
    readonly weeklyUsageWindow: string | null;
    readonly monthlyUsageWindow: string | null;
    readonly evidencePolicy: string | null;
    readonly assetLimitPolicy: string | null;
    readonly assetDailyUsageWindow: string | null;
    readonly counterpartyLimitPolicy: string | null;
    readonly counterpartyDailyUsageWindow: string | null;
}

export interface MintDirectAccountsInput {
    readonly moduleActivationState: string;
    readonly chanceryConfig: string;
    readonly eventAuthority: string;
    readonly pauseState: string;
    readonly assetConfig: string;
    readonly pathwayPolicy: string;
    readonly permissionRecord: string;
    readonly sourceAssetTokenAccount: string;
    readonly reserveAssetTokenAccount: string;
    readonly destinationIssuedTokenAccount: string;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly mintAuthorityPda: string;
    readonly assetTokenProgram: string;
    readonly issuedTokenProgram: string;
    readonly principal: string;
    readonly assetPauseState: string;
    readonly issuedTokenControl: string;
    readonly policyAccounts: DirectSettlementPolicyAccountsInput;
}

export interface RedeemDirectAccountsInput {
    readonly moduleActivationState: string;
    readonly chanceryConfig: string;
    readonly eventAuthority: string;
    readonly pauseState: string;
    readonly assetConfig: string;
    readonly pathwayPolicy: string;
    readonly permissionRecord: string;
    readonly sourceIssuedTokenAccount: string;
    readonly reserveAssetTokenAccount: string;
    readonly destinationAssetTokenAccount: string;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly reserveAuthorityPda: string;
    readonly assetTokenProgram: string;
    readonly issuedTokenProgram: string;
    readonly principal: string;
    readonly assetPauseState: string;
    readonly issuedTokenControl: string;
    readonly policyAccounts: DirectSettlementPolicyAccountsInput;
}

export interface MintDirectOperationInput {
    readonly pathwayId: string;
    readonly amount: string;
    readonly minimumOutput: string;
    readonly accounts: MintDirectAccountsInput;
}

export interface RedeemDirectOperationInput {
    readonly pathwayId: string;
    readonly amount: string;
    readonly minimumOutput: string;
    readonly accounts: RedeemDirectAccountsInput;
}

export interface InstructionDocument {
    readonly programId: string;
    readonly accounts: readonly AccountMetaSpec[];
    readonly dataBase64: string;
    readonly dataHex: string;
}

export type MarketMakerSettlementAction = "mint" | "redeem";

export interface PreparedMarketMakerSettlement {
    readonly action: MarketMakerSettlementAction;
    readonly principal: string;
    readonly inputAmount: string;
    readonly minimumOutput: string;
    readonly instruction: InstructionSpec;
}

export interface PreparedMarketMakerSettlementDocument {
    readonly action: MarketMakerSettlementAction;
    readonly principal: string;
    readonly inputAmount: string;
    readonly minimumOutput: string;
    readonly instruction: InstructionDocument;
}

export type SettlementSimulationResult =
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: string };

export type SettlementConfirmationResult =
    | { readonly confirmed: true }
    | { readonly confirmed: false; readonly reason: string };

export interface MarketMakerSettlementExecutionPort<PreparedTransaction> {
    prepareTransaction(
        settlement: PreparedMarketMakerSettlement,
    ): Promise<PreparedTransaction>;
    simulate(
        transaction: PreparedTransaction,
        settlement: PreparedMarketMakerSettlement,
    ): Promise<SettlementSimulationResult>;
    submit(
        transaction: PreparedTransaction,
        settlement: PreparedMarketMakerSettlement,
    ): Promise<string>;
    confirm(
        signature: string,
        settlement: PreparedMarketMakerSettlement,
    ): Promise<SettlementConfirmationResult>;
    reconcile(
        signature: string,
        settlement: PreparedMarketMakerSettlement,
    ): Promise<void>;
}

export interface ExecutedMarketMakerSettlement {
    readonly action: MarketMakerSettlementAction;
    readonly signature: string;
}
