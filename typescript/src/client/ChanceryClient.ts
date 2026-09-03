import { encodeBase58, normalizePublicKey } from "../Base58Codec.js";
import { chanceryJsonReplacer, type StructValues } from "../BinaryCodec.js";
import type { ChanceryEventOccurrence } from "../ChanceryEvent.js";
import { decodeChanceryAccount } from "../ChanceryAccount.js";
import {
    buildChanceryInstruction,
    type ChanceryInstruction,
    type InstructionAccountInputs,
} from "../ChanceryInstruction.js";
import {
    CHANCERY_PROGRAM_ADDRESS,
    getAccountSchema,
    ZERO_ADDRESS,
} from "../ChancerySchema.js";
import {
    ChanceryRpc,
    type RpcAccountInfo,
    type RpcCommitment,
    type RpcSimulationResult,
    type RpcSignatureStatus,
} from "../ChanceryRpc.js";
import {
    compileUnversionedMessage,
    compileVersionZeroMessage,
    parseAddressLookupTableAccount,
    signSolanaTransaction,
    type AddressLookupTable,
    type SignedSolanaTransaction,
    type SolanaInstruction,
    type SolanaKeypair,
} from "../SolanaTransaction.js";
import {
    assertSupportedTokenProgram,
    assertTokenAccountBinding,
    calculateTokenTransferFee,
    decodeTokenAccount,
    decodeTokenMint,
    deriveAssociatedTokenAddress,
    type DecodedTokenAccount,
    type DecodedTokenMint,
    type TokenTransferFeeCalculation,
} from "../SplToken.js";
import {
    bytes32FromInput,
    bytes32Hex,
    computeFeeQuote,
    computeSettlementGrossOutput,
    deriveAssetConfigAddress,
    deriveAssetPauseStateAddress,
    deriveEvidencePolicyAddress,
    deriveFeePolicyAddress,
    deriveLimitPolicyAddress,
    derivePathwayPolicyAddress,
    derivePermissionRecordAddress,
    deriveSettlementIntentAddress,
    deriveSettlementPolicyAddress,
    deriveSingletonAddress,
    deriveUsageWindowAddress,
    dimensionScopeHash,
    isZeroBytes32,
    knownPdaAddress,
    observeLimitPolicy,
    observeSettlementPolicy,
    PATHWAY_KIND_VALUE,
    pathwayIsActive,
    permissionObservation,
    policyScopeHash,
    requireBigIntField,
    requireBigIntArrayField,
    requireBytes,
    requireNumberField,
    requirePublicKeyField,
    requiredPrincipalRole,
    ROLE,
    SCOPE,
    SETTLEMENT_ACTION_VALUE,
    SETTLEMENT_MODE_VALUE,
    settlementInstructionName,
    STATUS_FLAG,
    WINDOW_KIND,
    type FeeQuote,
    type LimitObservation,
    type NamedProgramAddress,
    type PermissionObservation,
    type SettlementPolicyObservation,
    type SettlementAction,
    type SettlementMode,
} from "./ChanceryProtocol.js";
import {
    discoverChanceryState,
    type ChanceryStateDiscovery,
} from "./ChanceryDiscovery.js";

const SETTLEMENT_MODULE_ID = 4;
const MODULE_STATUS_ACTIVE = 2;
const ASSET_MODE_ACTIVE = 0;
const ASSET_MODE_WIND_DOWN = 1;
const COLLATERAL_TRANSFER_HOOK_EXTENSION = 1n << 0n;
const ISSUED_TOKEN_READY_FOR_SETTLEMENT = 1n << 63n;
const SETTLEMENT_EVIDENCE_SUPPORTED_FIELD_MASK = (1n << 19n) - 1n;
const OBSERVATION_VALIDITY_SLOTS = 64n;

export interface SettlementOperationRequest {
    readonly action: SettlementAction;
    readonly mode: SettlementMode;
    readonly assetMint: string;
    readonly principal: string;
    readonly amount?: bigint;
    readonly minimumOutput?: bigint;
    readonly pathwayId?: string | Uint8Array;
    readonly intentId?: string | Uint8Array;
    readonly executor?: string;
    readonly principalB?: string;
    readonly sourceTokenAccount?: string;
    readonly destinationTokenAccount?: string;
    readonly feeRecipientTokenAccount?: string;
    readonly rentRefundRecipient?: string;
    readonly nowUnixTimestamp?: bigint;
}

export interface NormalizedSettlementOperationRequest {
    readonly action: SettlementAction;
    readonly mode: SettlementMode;
    readonly assetMint: string;
    readonly principal: string;
    readonly amount: bigint | null;
    readonly minimumOutput: bigint | null;
    readonly pathwayId: Uint8Array | null;
    readonly intentId: Uint8Array | null;
    readonly executor: string | null;
    readonly principalB: string | null;
    readonly sourceTokenAccount: string | null;
    readonly destinationTokenAccount: string | null;
    readonly feeRecipientTokenAccount: string | null;
    readonly rentRefundRecipient: string | null;
    readonly nowUnixTimestamp: bigint;
}

export interface ChanceryStateSnapshot {
    readonly address: string;
    readonly expectedName: string;
    readonly exists: boolean;
    readonly owner: string | null;
    readonly lamports: bigint | null;
    readonly dataLength: number;
    readonly values: Readonly<Record<string, unknown>> | null;
}

export interface TokenMintSnapshot {
    readonly address: string;
    readonly tokenProgramAddress: string;
    readonly exists: boolean;
    readonly values: DecodedTokenMint | null;
}

export interface TokenAccountSnapshot {
    readonly address: string;
    readonly tokenProgramAddress: string;
    readonly selection: "override" | "associated_token_account" | "unique_owner_account" | "derived_missing";
    readonly exists: boolean;
    readonly values: DecodedTokenAccount | null;
}

export interface PathwayCandidate {
    readonly address: string;
    readonly pathwayId: string;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly pathwayKind: number;
    readonly designatedExecutor: string;
    readonly active: boolean;
    readonly matchesRequestedAsset: boolean;
    readonly matchesIssuedToken: boolean;
    readonly matchesMode: boolean;
    readonly matchesRequestedPathwayId: boolean;
    readonly canonicalPda: boolean;
}

export interface ResolvedPermission {
    readonly label: string;
    readonly address: string;
    readonly requiredRole: bigint;
    readonly snapshot: ChanceryStateSnapshot;
    readonly observation: PermissionObservation | null;
}

export interface ResolvedLimitDimension {
    readonly label: "pathway" | "asset" | "counterparty" | "counterparty_a" | "counterparty_b" | "executor";
    readonly policy: ChanceryStateSnapshot | null;
    readonly scopeHash: Uint8Array | null;
    readonly windows: Readonly<Record<string, ChanceryStateSnapshot | null>>;
    readonly observation: LimitObservation | null;
    readonly validationIssues: readonly string[];
}

export interface SettlementAmountResolution {
    readonly inputAmount: bigint;
    readonly grossOutput: bigint;
    readonly minimumOutput: bigint;
    readonly limitNotional: bigint;
    readonly sourceBalance: bigint | null;
    readonly reserveBalance: bigint | null;
}

export interface SettlementEffectiveQuote {
    readonly action: SettlementAction;
    readonly currentEpoch: bigint;
    readonly configuredRateE9: bigint;
    readonly configuredGrossOutputFromRequestedInput: bigint;
    readonly rateInputAmount: bigint;
    readonly grossOutput: bigint;
    readonly inputAssetTransfer: TokenTransferFeeCalculation;
    readonly chanceryFeeAmount: bigint;
    readonly chanceryFeeBasisPoints: bigint | null;
    readonly outputBeforePrincipalTransfer: bigint;
    readonly principalAssetTransfer: TokenTransferFeeCalculation;
    readonly principalReceivedAmount: bigint;
    readonly routedFeeTransfer: TokenTransferFeeCalculation | null;
    readonly feeRecipientReceivedAmount: bigint;
    readonly allInOutputReduction: bigint;
    readonly allInFeeBasisPoints: bigint | null;
    readonly effectiveOutputRateE9: bigint | null;
    readonly requiresSimulationForExactAmount: boolean;
    readonly observations: readonly string[];
}

export interface SettlementPauseObservation {
    readonly currentSlot: bigint;
    readonly globalPaused: boolean;
    readonly assetPaused: boolean;
    readonly pathwayPaused: boolean;
}

export interface ChanceryObservationContext {
    readonly contextSlot: bigint;
    readonly blockUnixTimestamp: bigint;
    readonly epoch: bigint;
    readonly commitment: RpcCommitment;
    readonly expiresAfterSlot: bigint;
    readonly timestampSource: "clock_sysvar" | "request_override";
}

export interface SettlementInspection {
    readonly request: NormalizedSettlementOperationRequest;
    readonly observation: ChanceryObservationContext;
    readonly instructionName: string;
    readonly pathwayCandidates: readonly PathwayCandidate[];
    readonly pathway: ChanceryStateSnapshot;
    readonly intent: ChanceryStateSnapshot | null;
    readonly coreAccounts: Readonly<Record<string, ChanceryStateSnapshot>>;
    readonly policies: Readonly<Record<string, ChanceryStateSnapshot | null>>;
    readonly permissions: readonly ResolvedPermission[];
    readonly limits: readonly ResolvedLimitDimension[];
    readonly pdas: readonly NamedProgramAddress[];
    readonly tokenMints: Readonly<Record<string, TokenMintSnapshot>>;
    readonly tokenAccounts: Readonly<Record<string, TokenAccountSnapshot>>;
    readonly reserveDestinations: readonly ChanceryStateSnapshot[];
    readonly feeQuote: FeeQuote;
    readonly effectiveQuote: SettlementEffectiveQuote;
    readonly settlementPolicyObservation: SettlementPolicyObservation | null;
    readonly amounts: SettlementAmountResolution;
    readonly pauses: SettlementPauseObservation;
    readonly instructionArguments: StructValues;
    readonly instructionAccounts: InstructionAccountInputs;
    readonly blockingIssues: readonly string[];
    readonly ready: boolean;
}

export interface SettlementTransactionRequest {
    readonly feePayer: string;
    readonly keypairs: readonly SolanaKeypair[];
    readonly addressLookupTableAddresses?: readonly string[];
    readonly commitment?: RpcCommitment;
}

export interface PreparedSettlementTransaction {
    readonly inspection: SettlementInspection;
    readonly instruction: ChanceryInstruction;
    readonly transaction: SignedSolanaTransaction;
    readonly recentBlockhash: string;
    readonly lastValidBlockHeight: bigint;
    readonly lookupTables: readonly AddressLookupTable[];
}

export interface SubmittedSettlementTransaction {
    readonly prepared: PreparedSettlementTransaction;
    readonly simulation: RpcSimulationResult;
    readonly signature: string;
    readonly status: RpcSignatureStatus;
    readonly transaction: unknown | null;
    readonly events: unknown;
}

interface PolicyResolution {
    readonly snapshot: ChanceryStateSnapshot | null;
    readonly pda: NamedProgramAddress | null;
}

interface OperationIdentity {
    readonly principalA: string;
    readonly principalB: string;
    readonly executor: string;
    readonly intentId: Uint8Array | null;
    readonly pathwayIdConstraint: Uint8Array | null;
    readonly inputAmount: bigint;
    readonly intentMinimumOutput: bigint | null;
    readonly intent: ChanceryStateSnapshot | null;
    readonly settlementPolicy: PolicyResolution;
    readonly rentRefundRecipient: string;
}

interface TokenAccountResolutionInput {
    readonly label: string;
    readonly owner: string;
    readonly mint: string;
    readonly tokenProgramAddress: string;
    readonly overrideAddress: string | null;
    readonly allowMissing: boolean;
}

export class ChanceryClient {
    readonly #rpc: ChanceryRpc;
    readonly #commitment: RpcCommitment;

    constructor(rpcEndpointOrClient: string | ChanceryRpc, commitment: RpcCommitment = "confirmed") {
        this.#rpc = typeof rpcEndpointOrClient === "string"
            ? new ChanceryRpc(rpcEndpointOrClient)
            : rpcEndpointOrClient;
        this.#commitment = commitment;
    }

    async discover(): Promise<ChanceryStateDiscovery> {
        return discoverChanceryState(this.#rpc, this.#commitment);
    }

    async decodeTransactionEvidence(signature: string): Promise<readonly ChanceryEventOccurrence[] | null> {
        return this.#rpc.getChanceryEvents(signature, this.#commitment);
    }

    async inspect(requestInput: SettlementOperationRequest): Promise<SettlementInspection> {
        const initialContextSlot = await this.#rpc.getSlot(this.#commitment);
        this.#rpc.setMinimumContextSlot(initialContextSlot);
        const clock = await this.#rpc.getClock(this.#commitment);
        this.#rpc.setMinimumContextSlot(clock.slot);
        const currentSlot = clock.slot;
        const currentEpoch = clock.epoch;
        const blockUnixTimestamp = requestInput.nowUnixTimestamp ?? clock.unixTimestamp;
        const request = normalizeRequest(requestInput, blockUnixTimestamp);
        const observation: ChanceryObservationContext = {
            contextSlot: currentSlot,
            blockUnixTimestamp,
            epoch: currentEpoch,
            commitment: this.#commitment,
            expiresAfterSlot: currentSlot + OBSERVATION_VALIDITY_SLOTS,
            timestampSource: requestInput.nowUnixTimestamp === undefined
                ? "clock_sysvar"
                : "request_override",
        };
        const blockingIssues: string[] = [];
        const pdas: NamedProgramAddress[] = [];

        const coreAccounts: Record<string, ChanceryStateSnapshot> = {};
        const moduleActivationStateAddress = knownPdaAddress("module_activation_state");
        const chanceryConfigAddress = knownPdaAddress("chancery_config");
        const pauseStateAddress = knownPdaAddress("pause_state");
        const issuedTokenControlAddress = knownPdaAddress("issued_token_control");
        const assetConfigPda = deriveAssetConfigAddress(request.assetMint);
        const assetPauseStatePda = deriveAssetPauseStateAddress(request.assetMint);
        const mintAuthorityPda = deriveSingletonAddress("mint_authority_pda", "mint-authority");
        const reserveAuthorityPda = deriveSingletonAddress("reserve_authority_pda", "reserve-authority");
        pdas.push(assetConfigPda, assetPauseStatePda, mintAuthorityPda, reserveAuthorityPda);

        coreAccounts.module_activation_state = await this.#loadChanceryState(
            moduleActivationStateAddress,
            "ModuleActivationState",
            false,
        );
        coreAccounts.chancery_config = await this.#loadChanceryState(
            chanceryConfigAddress,
            "ChanceryConfig",
            false,
        );
        coreAccounts.pause_state = await this.#loadChanceryState(pauseStateAddress, "PauseState", false);
        coreAccounts.asset_config = await this.#loadChanceryState(assetConfigPda.address, "AssetConfig", false);
        coreAccounts.asset_pause_state = await this.#loadChanceryState(
            assetPauseStatePda.address,
            "AssetPauseState",
            true,
        );
        coreAccounts.issued_token_control = await this.#loadChanceryState(
            issuedTokenControlAddress,
            "IssuedTokenControl",
            false,
        );

        const configValues = requireSnapshotValues(coreAccounts.chancery_config);
        const assetValues = requireSnapshotValues(coreAccounts.asset_config);
        const issuedTokenControlValues = requireSnapshotValues(coreAccounts.issued_token_control);
        const issuedTokenMint = requirePublicKeyField(configValues, "issued_token_mint");
        const issuedTokenProgram = assertSupportedTokenProgram(requirePublicKeyField(configValues, "issued_token_program"));
        const assetTokenProgram = assertSupportedTokenProgram(requirePublicKeyField(assetValues, "asset_token_program"));

        const [assetMintSnapshot, issuedTokenMintSnapshot] = await Promise.all([
            this.#loadTokenMint(request.assetMint, assetTokenProgram),
            this.#loadTokenMint(issuedTokenMint, issuedTokenProgram),
        ]);
        if (!assetMintSnapshot.exists || assetMintSnapshot.values === null) {
            blockingIssues.push(`Asset mint ${request.assetMint} does not exist`);
        } else if (!assetMintSnapshot.values.initialized) {
            blockingIssues.push(`Asset mint ${request.assetMint} is not initialized`);
        }
        if (!issuedTokenMintSnapshot.exists || issuedTokenMintSnapshot.values === null) {
            blockingIssues.push(`Issued-token mint ${issuedTokenMint} does not exist`);
        } else if (!issuedTokenMintSnapshot.values.initialized) {
            blockingIssues.push(`Issued-token mint ${issuedTokenMint} is not initialized`);
        }

        if (requirePublicKeyField(assetValues, "asset_mint") !== request.assetMint) {
            blockingIssues.push("AssetConfig asset mint does not match the requested asset mint");
        }
        if (requirePublicKeyField(issuedTokenControlValues, "issued_token_mint") !== issuedTokenMint) {
            blockingIssues.push("IssuedTokenControl does not bind the ChanceryConfig issued token mint");
        }
        if (requirePublicKeyField(issuedTokenControlValues, "issued_token_program") !== issuedTokenProgram) {
            blockingIssues.push("IssuedTokenControl does not bind the ChanceryConfig issued token program");
        }
        if (requirePublicKeyField(configValues, "mint_authority_pda") !== mintAuthorityPda.address) {
            blockingIssues.push("ChanceryConfig mint authority does not match the canonical mint-authority PDA");
        }

        const operationIdentity = await this.#resolveOperationIdentity(request, pdas);
        const pathwayDiscovery = await this.#discoverPathways(
            request,
            operationIdentity.pathwayIdConstraint,
            issuedTokenMint,
        );
        const selectedCandidate = selectPathwayCandidate(pathwayDiscovery.candidates);
        const pathway = await this.#loadChanceryState(selectedCandidate.address, "PathwayPolicy", false);
        const pathwayValues = requireSnapshotValues(pathway);
        pdas.push(derivePathwayPolicyAddress(requireBytes(pathwayValues.pathway_id, "pathway_id", 32)));

        if (!pathwayIsActive(pathwayValues)) {
            blockingIssues.push("Selected pathway is not active");
        }
        if (requireBigIntField(pathwayValues, "source_account_policy") !== 0n) {
            blockingIssues.push("Selected pathway has a nonzero source-account policy unsupported by the settlement runtime");
        }
        if (requireBigIntField(pathwayValues, "destination_account_policy") !== 0n) {
            blockingIssues.push("Selected pathway has a nonzero destination-account policy unsupported by the settlement runtime");
        }
        const designatedExecutor = requirePublicKeyField(pathwayValues, "designated_executor");
        if (
            request.mode !== "direct" &&
            designatedExecutor !== ZERO_ADDRESS &&
            designatedExecutor !== operationIdentity.executor
        ) {
            blockingIssues.push("Selected pathway designates a different executor");
        }

        validateIntentAgainstPathway(
            request,
            operationIdentity,
            pathwayValues,
            issuedTokenMint,
            blockingIssues,
        );

        const feePolicy = await this.#resolvePolicyFromIdentifier(
            pathwayValues.fee_policy_id,
            "FeePolicy",
            deriveFeePolicyAddress,
            pdas,
        );
        const pathwayLimitPolicy = await this.#resolvePolicyFromIdentifier(
            pathwayValues.limit_policy_id,
            "LimitPolicy",
            deriveLimitPolicyAddress,
            pdas,
        );
        const evidencePolicy = await this.#resolvePolicyFromIdentifier(
            pathwayValues.evidence_policy_id,
            "EvidencePolicy",
            deriveEvidencePolicyAddress,
            pdas,
        );
        validateCoreSettlementGates(
            request.action,
            currentSlot,
            requireSnapshotValues(coreAccounts.module_activation_state),
            assetValues,
            issuedTokenControlValues,
            pathwayValues,
            evidencePolicy.snapshot?.values ?? null,
            blockingIssues,
        );
        const assetLimitIdentifier = request.action === "mint"
            ? pathwayValues.asset_mint_limit_policy_id
            : pathwayValues.asset_redeem_limit_policy_id;
        const assetLimitPolicy = await this.#resolvePolicyFromIdentifier(
            assetLimitIdentifier,
            "LimitPolicy",
            deriveLimitPolicyAddress,
            pdas,
        );
        const counterpartyLimitPolicy = await this.#resolvePolicyFromIdentifier(
            pathwayValues.counterparty_limit_policy_id,
            "LimitPolicy",
            deriveLimitPolicyAddress,
            pdas,
        );
        const executorLimitPolicy = request.mode === "direct"
            ? { snapshot: null, pda: null }
            : await this.#resolvePolicyFromIdentifier(
                pathwayValues.executor_limit_policy_id,
                "LimitPolicy",
                deriveLimitPolicyAddress,
                pdas,
            );

        const quoteResolution = computeSettlementEffectiveQuote(
            request.action,
            operationIdentity.inputAmount,
            assetValues,
            assetMintSnapshot.values,
            feePolicy.snapshot?.values ?? null,
            request.nowUnixTimestamp,
            currentEpoch,
        );
        const grossOutput = quoteResolution.grossOutput;
        const feeQuote = quoteResolution.feeQuote;
        const effectiveQuote = quoteResolution.effectiveQuote;
        const minimumOutput = request.minimumOutput
            ?? operationIdentity.intentMinimumOutput
            ?? effectiveQuote.principalReceivedAmount;
        const limitNotional = request.action === "mint" ? operationIdentity.inputAmount : grossOutput;
        const settlementPolicySnapshot = operationIdentity.settlementPolicy.snapshot;
        const settlementPolicyPda = operationIdentity.settlementPolicy.pda;
        let settlementPolicyObservation: SettlementPolicyObservation | null = null;
        if (
            settlementPolicySnapshot !== null
            && settlementPolicySnapshot.values !== null
            && settlementPolicyPda !== null
        ) {
            settlementPolicyObservation = observeSettlementPolicy(
                settlementPolicySnapshot.values,
                request.mode,
                request.assetMint,
                operationIdentity.principalA,
                operationIdentity.principalB,
                operationIdentity.executor,
                operationIdentity.inputAmount,
                request.nowUnixTimestamp,
                settlementPolicyPda.address,
                settlementPolicyPda.bump,
            );
            for (
                let index = 0, length = settlementPolicyObservation.observations.length;
                index < length;
                index++
            ) {
                const observation = settlementPolicyObservation.observations[index];
                if (observation !== undefined) {
                    blockingIssues.push(observation);
                }
            }
        }

        validateAmount(
            request.action,
            operationIdentity.inputAmount,
            minimumOutput,
            assetValues,
            effectiveQuote.principalReceivedAmount,
            blockingIssues,
        );
        for (let index = 0, length = feeQuote.observations.length; index < length; index++) {
            const observation = feeQuote.observations[index];
            if (observation !== undefined) {
                blockingIssues.push(observation);
            }
        }

        const pathwayPolicyAddress = pathway.address;
        const permissions = await this.#resolvePermissions(
            request,
            operationIdentity,
            pathwayPolicyAddress,
            pdas,
        );
        for (let index = 0, length = permissions.length; index < length; index++) {
            const permission = permissions[index];
            if (permission?.observation?.usable !== true) {
                blockingIssues.push(`${permission?.label ?? "Permission"} is not usable`);
            }
        }

        const limits: ResolvedLimitDimension[] = [];
        limits.push(await this.#resolvePathwayLimitDimension(
            pathwayLimitPolicy,
            request.action,
            limitNotional,
            request.nowUnixTimestamp,
            pdas,
        ));
        limits.push(await this.#resolveDailyLimitDimension(
            "asset",
            assetLimitPolicy,
            SCOPE.ASSET,
            request.assetMint,
            limitNotional,
            request.action,
            request.nowUnixTimestamp,
            pdas,
            false,
        ));
        if (request.mode === "trilateral") {
            limits.push(await this.#resolveDailyLimitDimension(
                "counterparty_a",
                counterpartyLimitPolicy,
                SCOPE.COUNTERPARTY,
                operationIdentity.principalA,
                limitNotional,
                request.action,
                request.nowUnixTimestamp,
                pdas,
                false,
            ));
            limits.push(await this.#resolveDailyLimitDimension(
                "counterparty_b",
                counterpartyLimitPolicy,
                SCOPE.COUNTERPARTY,
                operationIdentity.principalB,
                limitNotional,
                request.action,
                request.nowUnixTimestamp,
                pdas,
                false,
            ));
        } else {
            limits.push(await this.#resolveDailyLimitDimension(
                "counterparty",
                counterpartyLimitPolicy,
                SCOPE.COUNTERPARTY,
                operationIdentity.principalA,
                limitNotional,
                request.action,
                request.nowUnixTimestamp,
                pdas,
                request.mode === "delegated",
            ));
        }
        if (request.mode !== "direct") {
            limits.push(await this.#resolveDailyLimitDimension(
                "executor",
                executorLimitPolicy,
                SCOPE.EXECUTOR,
                operationIdentity.executor,
                limitNotional,
                request.action,
                request.nowUnixTimestamp,
                pdas,
                false,
            ));
        }
        validateLimits(limits, blockingIssues);

        const reserveAssociatedTokenAddress = deriveAssociatedTokenAddress(
            reserveAuthorityPda.address,
            request.assetMint,
            assetTokenProgram,
        );
        pdas.push({
            name: "reserve_asset_token_account",
            address: reserveAssociatedTokenAddress.address,
            bump: reserveAssociatedTokenAddress.bump,
            seeds: [
                reserveAuthorityPda.address,
                assetTokenProgram,
                request.assetMint,
            ],
        });

        const sourceMint = request.action === "mint" ? request.assetMint : issuedTokenMint;
        const sourceProgram = request.action === "mint" ? assetTokenProgram : issuedTokenProgram;
        const destinationMint = request.action === "mint" ? issuedTokenMint : request.assetMint;
        const destinationProgram = request.action === "mint" ? issuedTokenProgram : assetTokenProgram;
        const destinationOwner = request.mode === "trilateral"
            ? operationIdentity.principalB
            : operationIdentity.principalA;

        const sourceTokenAccount = await this.#resolveTokenAccount({
            label: "source token account",
            owner: operationIdentity.principalA,
            mint: sourceMint,
            tokenProgramAddress: sourceProgram,
            overrideAddress: request.sourceTokenAccount,
            allowMissing: true,
        });
        const destinationTokenAccount = await this.#resolveTokenAccount({
            label: "destination token account",
            owner: destinationOwner,
            mint: destinationMint,
            tokenProgramAddress: destinationProgram,
            overrideAddress: request.destinationTokenAccount,
            allowMissing: true,
        });
        const reserveTokenAccount = await this.#loadTokenAccountAtAddress(
            reserveAssociatedTokenAddress.address,
            reserveAuthorityPda.address,
            request.assetMint,
            assetTokenProgram,
            "associated_token_account",
            true,
        );

        let feeRecipientTokenAccount: TokenAccountSnapshot = {
            address: ZERO_ADDRESS,
            tokenProgramAddress: request.action === "mint" ? issuedTokenProgram : assetTokenProgram,
            selection: "derived_missing",
            exists: false,
            values: null,
        };
        if (feeQuote.routed) {
            feeRecipientTokenAccount = await this.#resolveTokenAccount({
                label: "fee recipient token account",
                owner: feeQuote.feeRecipientOwner,
                mint: destinationMint,
                tokenProgramAddress: destinationProgram,
                overrideAddress: request.feeRecipientTokenAccount,
                allowMissing: true,
            });
        }

        const requiredReserveBalance = request.action === "redeem"
            ? effectiveQuote.outputBeforePrincipalTransfer + (feeQuote.routed ? feeQuote.netFee : 0n)
            : 0n;
        validateTokenAccounts(
            request,
            operationIdentity.inputAmount,
            requiredReserveBalance,
            sourceTokenAccount,
            destinationTokenAccount,
            reserveTokenAccount,
            feeRecipientTokenAccount,
            feeQuote.routed,
            blockingIssues,
        );

        const reserveDestinations = await this.#discoverReserveDestinations(request.assetMint);
        const pauses = observePauses(
            request.action,
            currentSlot,
            coreAccounts.pause_state,
            coreAccounts.asset_pause_state,
            pathway,
        );
        if (pauses.globalPaused) {
            blockingIssues.push(`Global ${request.action} pause is active`);
        }
        if (pauses.assetPaused) {
            blockingIssues.push(`Asset ${request.action} pause is active`);
        }
        if (pauses.pathwayPaused) {
            blockingIssues.push("Pathway pause is active");
        }

        const policies: Record<string, ChanceryStateSnapshot | null> = {
            fee_policy: feePolicy.snapshot,
            pathway_limit_policy: pathwayLimitPolicy.snapshot,
            evidence_policy: evidencePolicy.snapshot,
            settlement_policy: operationIdentity.settlementPolicy.snapshot,
            asset_limit_policy: assetLimitPolicy.snapshot,
            counterparty_limit_policy: counterpartyLimitPolicy.snapshot,
            executor_limit_policy: executorLimitPolicy.snapshot,
        };

        const tokenAccounts: Record<string, TokenAccountSnapshot> = {
            source: sourceTokenAccount,
            reserve: reserveTokenAccount,
            destination: destinationTokenAccount,
            fee_recipient: feeRecipientTokenAccount,
        };
        const tokenMints: Record<string, TokenMintSnapshot> = {
            asset: assetMintSnapshot,
            issued_token: issuedTokenMintSnapshot,
        };

        const instructionArguments = buildInstructionArguments(
            request,
            operationIdentity,
            pathwayValues,
            minimumOutput,
        );
        const instructionAccounts = buildInstructionAccounts({
            request,
            operationIdentity,
            coreAccounts,
            pathway,
            permissions,
            policies,
            limits,
            tokenAccounts,
            assetMint: request.assetMint,
            issuedTokenMint,
            assetTokenProgram,
            issuedTokenProgram,
            mintAuthorityAddress: mintAuthorityPda.address,
            reserveAuthorityAddress: reserveAuthorityPda.address,
        });

        const uniqueBlockingIssues = uniqueStrings(blockingIssues);
        return {
            request,
            observation,
            instructionName: settlementInstructionName(request.action, request.mode),
            pathwayCandidates: pathwayDiscovery.candidates,
            pathway,
            intent: operationIdentity.intent,
            coreAccounts,
            policies,
            permissions,
            limits,
            pdas,
            tokenMints,
            tokenAccounts,
            reserveDestinations,
            feeQuote,
            effectiveQuote,
            settlementPolicyObservation,
            amounts: {
                inputAmount: operationIdentity.inputAmount,
                grossOutput,
                minimumOutput,
                limitNotional,
                sourceBalance: sourceTokenAccount.values?.amount ?? null,
                reserveBalance: reserveTokenAccount.values?.amount ?? null,
            },
            pauses,
            instructionArguments,
            instructionAccounts,
            blockingIssues: uniqueBlockingIssues,
            ready: uniqueBlockingIssues.length === 0,
        };
    }

    buildInstruction(inspection: SettlementInspection): ChanceryInstruction {
        assertInspectionReady(inspection);
        return buildChanceryInstruction(
            inspection.instructionName,
            inspection.instructionArguments,
            inspection.instructionAccounts,
            true,
        );
    }

    async prepareTransaction(
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ): Promise<PreparedSettlementTransaction> {
        const commitment = request.commitment ?? this.#commitment;
        const currentSlot = await this.#rpc.getSlot(commitment);
        if (currentSlot > inspection.observation.expiresAfterSlot) {
            throw new Error(
                `Inspection expired at slot ${inspection.observation.expiresAfterSlot.toString()}; current slot is ${currentSlot.toString()}`,
            );
        }
        const instruction = this.buildInstruction(inspection);
        const normalizedFeePayer = normalizePublicKey(request.feePayer);
        const latestBlockhash = await this.#rpc.getLatestBlockhash(commitment);
        const solanaInstruction: SolanaInstruction = {
            programAddress: instruction.programAddress,
            accounts: instruction.accounts,
            data: instruction.data,
        };
        const lookupTables = await this.#loadAddressLookupTables(request.addressLookupTableAddresses ?? []);
        const message = lookupTables.length === 0
            ? compileUnversionedMessage([solanaInstruction], normalizedFeePayer, latestBlockhash.blockhash)
            : compileVersionZeroMessage(
                [solanaInstruction],
                normalizedFeePayer,
                latestBlockhash.blockhash,
                lookupTables,
            );
        const transaction = signSolanaTransaction(message, request.keypairs);
        return {
            inspection,
            instruction,
            transaction,
            recentBlockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            lookupTables,
        };
    }

    async simulateTransaction(
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ): Promise<{ readonly prepared: PreparedSettlementTransaction; readonly simulation: RpcSimulationResult }> {
        const prepared = await this.prepareTransaction(inspection, request);
        const simulation = await this.#rpc.simulateTransaction(
            prepared.transaction.bytes,
            request.commitment ?? this.#commitment,
            true,
        );
        return { prepared, simulation };
    }

    async submitTransaction(
        inspection: SettlementInspection,
        request: SettlementTransactionRequest,
    ): Promise<SubmittedSettlementTransaction> {
        const { prepared, simulation } = await this.simulateTransaction(inspection, request);
        if (simulation.err !== null) {
            throw new Error(`Chancery transaction simulation failed: ${JSON.stringify(simulation.err, chanceryJsonReplacer)}`);
        }
        const commitment = request.commitment ?? this.#commitment;
        const signature = await this.#rpc.sendTransaction(prepared.transaction.bytes, commitment, false, 5);
        const status = await this.#confirmTransaction(
            signature,
            prepared.lastValidBlockHeight,
            commitment,
        );
        const transaction = await this.#rpc.getTransaction(signature, commitment);
        const events = await this.#rpc.getChanceryEvents(signature, commitment);
        return {
            prepared,
            simulation,
            signature,
            status,
            transaction,
            events,
        };
    }

    static stringify(value: unknown, spacing = 2): string {
        return JSON.stringify(value, chanceryJsonReplacer, spacing);
    }

    async #resolveOperationIdentity(
        request: NormalizedSettlementOperationRequest,
        pdas: NamedProgramAddress[],
    ): Promise<OperationIdentity> {
        if (request.mode === "direct") {
            if (request.amount === null || request.amount <= 0n) {
                throw new Error("Direct settlement requires a positive amount");
            }
            return {
                principalA: request.principal,
                principalB: request.principal,
                executor: request.principal,
                intentId: null,
                pathwayIdConstraint: request.pathwayId,
                inputAmount: request.amount,
                intentMinimumOutput: null,
                intent: null,
                settlementPolicy: { snapshot: null, pda: null },
                rentRefundRecipient: request.rentRefundRecipient ?? request.principal,
            };
        }
        if (request.intentId === null) {
            throw new Error(`${request.mode} settlement requires an intent id`);
        }
        const intentPda = deriveSettlementIntentAddress(request.intentId);
        pdas.push(intentPda);
        const intent = await this.#loadChanceryState(intentPda.address, "SettlementIntent", false);
        const intentValues = requireSnapshotValues(intent);
        const principalA = requirePublicKeyField(intentValues, "principal_a");
        const principalB = requirePublicKeyField(intentValues, "principal_b");
        const executor = requirePublicKeyField(intentValues, "executor");
        if (principalA !== request.principal) {
            throw new Error(`Settlement intent principal A is ${principalA}, not ${request.principal}`);
        }
        if (request.principalB !== null && request.principalB !== principalB) {
            throw new Error(`Settlement intent principal B is ${principalB}, not ${request.principalB}`);
        }
        if (request.executor !== null && request.executor !== executor) {
            throw new Error(`Settlement intent executor is ${executor}, not ${request.executor}`);
        }
        const inputAmount = request.action === "mint"
            ? requireBigIntField(intentValues, "asset_amount")
            : requireBigIntField(intentValues, "issued_token_amount");
        if (request.amount !== null && request.amount !== inputAmount) {
            throw new Error(`Requested amount ${request.amount.toString()} does not match settlement intent amount ${inputAmount.toString()}`);
        }
        const intentMinimumOutput = request.action === "mint"
            ? requireBigIntField(intentValues, "minimum_issued_token_amount")
            : requireBigIntField(intentValues, "minimum_asset_amount");
        const pathwayIdConstraint = requireBytes(intentValues.pathway_id, "intent pathway id", 32);
        if (request.pathwayId !== null && bytes32Hex(request.pathwayId, "requested pathway id") !== bytes32Hex(pathwayIdConstraint, "intent pathway id")) {
            throw new Error("Requested pathway id does not match settlement intent pathway id");
        }
        const settlementPolicy = await this.#resolvePolicyFromIdentifier(
            intentValues.policy_id,
            "SettlementPolicy",
            deriveSettlementPolicyAddress,
            pdas,
        );
        return {
            principalA,
            principalB,
            executor,
            intentId: request.intentId,
            pathwayIdConstraint,
            inputAmount,
            intentMinimumOutput,
            intent,
            settlementPolicy,
            rentRefundRecipient: request.rentRefundRecipient
                ?? requirePublicKeyField(intentValues, "rent_refund_recipient"),
        };
    }

    async #discoverPathways(
        request: NormalizedSettlementOperationRequest,
        pathwayIdConstraint: Uint8Array | null,
        issuedTokenMint: string,
    ): Promise<{ readonly candidates: readonly PathwayCandidate[] }> {
        const accountSchema = getAccountSchema("PathwayPolicy");
        const programAccounts = await this.#rpc.getProgramAccounts(
            CHANCERY_PROGRAM_ADDRESS,
            [
                { dataSize: accountSchema.size },
                { memcmp: { offset: 0, bytes: encodeBase58(new Uint8Array(accountSchema.discriminator)) } },
            ],
            this.#commitment,
        );
        const candidates: PathwayCandidate[] = [];
        for (let index = 0, length = programAccounts.length; index < length; index++) {
            const programAccount = programAccounts[index];
            if (programAccount === undefined) {
                continue;
            }
            if (programAccount.account.owner !== CHANCERY_PROGRAM_ADDRESS) {
                continue;
            }
            const decoded = decodeChanceryAccount(programAccount.account.data);
            if (decoded.name !== "PathwayPolicy") {
                continue;
            }
            const values = decoded.values;
            const pathwayId = requireBytes(values.pathway_id, "pathway id", 32);
            const derived = derivePathwayPolicyAddress(pathwayId);
            const candidate: PathwayCandidate = {
                address: programAccount.address,
                pathwayId: bytes32Hex(pathwayId, "pathway id"),
                assetMint: requirePublicKeyField(values, "asset_mint"),
                issuedTokenMint: requirePublicKeyField(values, "issued_token_mint"),
                pathwayKind: requireNumberField(values, "pathway_kind"),
                designatedExecutor: requirePublicKeyField(values, "designated_executor"),
                active: pathwayIsActive(values),
                matchesRequestedAsset: requirePublicKeyField(values, "asset_mint") === request.assetMint,
                matchesIssuedToken: requirePublicKeyField(values, "issued_token_mint") === issuedTokenMint,
                matchesMode: requireNumberField(values, "pathway_kind") === PATHWAY_KIND_VALUE[request.mode],
                matchesRequestedPathwayId: pathwayIdConstraint === null
                    || bytes32Hex(pathwayId, "pathway id") === bytes32Hex(pathwayIdConstraint, "requested pathway id"),
                canonicalPda: derived.address === programAccount.address,
            };
            candidates.push(candidate);
        }
        return { candidates };
    }

    async #resolvePolicyFromIdentifier(
        identifierValue: unknown,
        expectedName: string,
        derive: (identifier: string | Uint8Array) => NamedProgramAddress,
        pdas: NamedProgramAddress[],
    ): Promise<PolicyResolution> {
        if (isZeroBytes32(identifierValue, `${expectedName} id`)) {
            return { snapshot: null, pda: null };
        }
        const identifier = requireBytes(identifierValue, `${expectedName} id`, 32);
        const pda = derive(identifier);
        pdas.push(pda);
        const snapshot = await this.#loadChanceryState(pda.address, expectedName, false);
        return { snapshot, pda };
    }

    async #resolvePermissions(
        request: NormalizedSettlementOperationRequest,
        identity: OperationIdentity,
        pathwayPolicyAddress: string,
        pdas: NamedProgramAddress[],
    ): Promise<readonly ResolvedPermission[]> {
        const definitions: { readonly label: string; readonly subject: string; readonly requiredRole: bigint }[] = [];
        definitions.push({
            label: request.mode === "trilateral" ? "principal A permission" : "principal permission",
            subject: identity.principalA,
            requiredRole: requiredPrincipalRole(request.action, request.mode),
        });
        if (request.mode === "trilateral") {
            definitions.push({
                label: "principal B permission",
                subject: identity.principalB,
                requiredRole: ROLE.CAN_USE_TRILATERAL_PATHWAY,
            });
        }
        if (request.mode !== "direct") {
            definitions.push({
                label: "executor permission",
                subject: identity.executor,
                requiredRole: ROLE.CAN_EXECUTE_SETTLEMENT,
            });
        }
        const resolved: ResolvedPermission[] = [];
        for (let index = 0, length = definitions.length; index < length; index++) {
            const definition = definitions[index];
            if (definition === undefined) {
                continue;
            }
            const pda = derivePermissionRecordAddress(
                definition.subject,
                SCOPE.PATHWAY,
                pathwayPolicyAddress,
            );
            pdas.push({ ...pda, name: definition.label.replaceAll(" ", "_") });
            const snapshot = await this.#loadChanceryState(pda.address, "PermissionRecord", true);
            const observation = snapshot.values === null
                ? null
                : permissionObservation(
                    snapshot.values,
                    definition.requiredRole,
                    definition.subject,
                    SCOPE.PATHWAY,
                    pathwayPolicyAddress,
                    request.nowUnixTimestamp,
                );
            resolved.push({
                label: definition.label,
                address: pda.address,
                requiredRole: definition.requiredRole,
                snapshot,
                observation,
            });
        }
        return resolved;
    }

    async #resolvePathwayLimitDimension(
        policy: PolicyResolution,
        action: SettlementAction,
        proposedAmount: bigint,
        nowUnixTimestamp: bigint,
        pdas: NamedProgramAddress[],
    ): Promise<ResolvedLimitDimension> {
        if (policy.snapshot?.values === null || policy.snapshot === null) {
            return emptyLimitDimension("pathway");
        }
        const policyValues = policy.snapshot.values;
        const scopeHash = policyScopeHash(policyValues);
        const windows = await this.#loadLimitWindows(policyValues, scopeHash, pdas);
        return {
            label: "pathway",
            policy: policy.snapshot,
            scopeHash,
            windows,
            observation: observeLimitPolicy(
                policyValues,
                action,
                proposedAmount,
                snapshotValuesByWindow(windows),
                nowUnixTimestamp,
            ),
            validationIssues: [],
        };
    }

    async #resolveDailyLimitDimension(
        label: ResolvedLimitDimension["label"],
        policy: PolicyResolution,
        scopeKind: number,
        concreteScopeKey: string,
        proposedAmount: bigint,
        action: SettlementAction,
        nowUnixTimestamp: bigint,
        pdas: NamedProgramAddress[],
        requireDailyMaximum: boolean,
    ): Promise<ResolvedLimitDimension> {
        if (policy.snapshot?.values === null || policy.snapshot === null) {
            return emptyLimitDimension(label);
        }
        const policyValues = policy.snapshot.values;
        const scopeHash = dimensionScopeHash(scopeKind, concreteScopeKey);
        const dailyPda = deriveUsageWindowAddress(scopeHash, WINDOW_KIND.DAILY);
        pdas.push({ ...dailyPda, name: `${label}_daily_usage_window` });
        const dailySnapshot = await this.#loadChanceryState(dailyPda.address, "UsageWindow", true);
        const windows: Readonly<Record<string, ChanceryStateSnapshot | null>> = {
            hourly: null,
            daily: dailySnapshot,
            weekly: null,
            monthly: null,
        };
        const expectedPolicyScopeKey = scopeKind === SCOPE.ASSET ? concreteScopeKey : ZERO_ADDRESS;
        return {
            label,
            policy: policy.snapshot,
            scopeHash,
            windows,
            observation: observeLimitPolicy(
                policyValues,
                action,
                proposedAmount,
                snapshotValuesByWindow(windows),
                nowUnixTimestamp,
            ),
            validationIssues: dimensionPolicyValidationIssues(
                policyValues,
                scopeKind,
                expectedPolicyScopeKey,
                requireDailyMaximum,
            ),
        };
    }

    async #loadLimitWindows(
        policyValues: Readonly<Record<string, unknown>>,
        scopeHash: Uint8Array,
        pdas: NamedProgramAddress[],
    ): Promise<Readonly<Record<string, ChanceryStateSnapshot | null>>> {
        const definitions: readonly [string, number, boolean][] = [
            ["hourly", WINDOW_KIND.HOURLY,
                requireBigIntField(policyValues, "per_hour_maximum") !== 0n
                || requireNumberField(policyValues, "maximum_actions_per_hour") !== 0],
            ["daily", WINDOW_KIND.DAILY,
                requireBigIntField(policyValues, "per_day_maximum") !== 0n
                || requireNumberField(policyValues, "maximum_actions_per_day") !== 0],
            ["weekly", WINDOW_KIND.WEEKLY,
                requireBigIntField(policyValues, "per_seven_day_maximum") !== 0n],
            ["monthly", WINDOW_KIND.MONTHLY,
                requireBigIntField(policyValues, "per_thirty_day_maximum") !== 0n],
        ];
        const windows: Record<string, ChanceryStateSnapshot | null> = {};
        for (let index = 0, length = definitions.length; index < length; index++) {
            const definition = definitions[index];
            if (definition === undefined) {
                continue;
            }
            const [name, kind, enforced] = definition;
            if (!enforced) {
                windows[name] = null;
                continue;
            }
            const pda = deriveUsageWindowAddress(scopeHash, kind);
            pdas.push({ ...pda, name: `${name}_usage_window` });
            windows[name] = await this.#loadChanceryState(pda.address, "UsageWindow", true);
        }
        return windows;
    }

    async #resolveTokenAccount(input: TokenAccountResolutionInput): Promise<TokenAccountSnapshot> {
        if (input.overrideAddress !== null) {
            return this.#loadTokenAccountAtAddress(
                input.overrideAddress,
                input.owner,
                input.mint,
                input.tokenProgramAddress,
                "override",
                input.allowMissing,
            );
        }
        const associated = deriveAssociatedTokenAddress(input.owner, input.mint, input.tokenProgramAddress);
        const associatedSnapshot = await this.#loadTokenAccountAtAddress(
            associated.address,
            input.owner,
            input.mint,
            input.tokenProgramAddress,
            "associated_token_account",
            true,
        );
        if (associatedSnapshot.exists) {
            return associatedSnapshot;
        }
        const ownerAccounts = await this.#rpc.getTokenAccountsByOwner(input.owner, input.mint, this.#commitment);
        const matches: TokenAccountSnapshot[] = [];
        for (let index = 0, length = ownerAccounts.length; index < length; index++) {
            const ownerAccount = ownerAccounts[index];
            if (ownerAccount === undefined || ownerAccount.account.owner !== input.tokenProgramAddress) {
                continue;
            }
            try {
                const values = decodeTokenAccount(ownerAccount.account.data);
                assertTokenAccountBinding(values, input.mint, input.owner, input.label);
                matches.push({
                    address: ownerAccount.address,
                    tokenProgramAddress: input.tokenProgramAddress,
                    selection: "unique_owner_account",
                    exists: true,
                    values,
                });
            } catch {
                continue;
            }
        }
        if (matches.length === 1) {
            const match = matches[0];
            if (match !== undefined) {
                return match;
            }
        }
        if (matches.length > 1) {
            throw new Error(`${input.label} is ambiguous; supply an explicit token account address`);
        }
        if (!input.allowMissing) {
            throw new Error(`${input.label} does not exist at ${associated.address}`);
        }
        return {
            address: associated.address,
            tokenProgramAddress: input.tokenProgramAddress,
            selection: "derived_missing",
            exists: false,
            values: null,
        };
    }

    async #loadTokenAccountAtAddress(
        addressInput: string,
        expectedOwner: string,
        expectedMint: string,
        tokenProgramAddress: string,
        selection: TokenAccountSnapshot["selection"],
        allowMissing: boolean,
    ): Promise<TokenAccountSnapshot> {
        const address = normalizePublicKey(addressInput);
        const account = await this.#rpc.getAccountInfo(address, this.#commitment);
        if (account === null) {
            if (!allowMissing) {
                throw new Error(`Token account ${address} does not exist`);
            }
            return { address, tokenProgramAddress, selection: "derived_missing", exists: false, values: null };
        }
        if (account.owner !== tokenProgramAddress) {
            throw new Error(`Token account ${address} is owned by ${account.owner}, not ${tokenProgramAddress}`);
        }
        const values = decodeTokenAccount(account.data);
        assertTokenAccountBinding(values, expectedMint, expectedOwner, `token account ${address}`);
        return { address, tokenProgramAddress, selection, exists: true, values };
    }

    async #loadTokenMint(addressInput: string, tokenProgramAddress: string): Promise<TokenMintSnapshot> {
        const address = normalizePublicKey(addressInput);
        const account = await this.#rpc.getAccountInfo(address, this.#commitment);
        if (account === null) {
            return { address, tokenProgramAddress, exists: false, values: null };
        }
        if (account.owner !== tokenProgramAddress) {
            throw new Error(`Token mint ${address} is owned by ${account.owner}, not ${tokenProgramAddress}`);
        }
        return { address, tokenProgramAddress, exists: true, values: decodeTokenMint(account.data) };
    }

    async #discoverReserveDestinations(assetMint: string): Promise<readonly ChanceryStateSnapshot[]> {
        const accountSchema = getAccountSchema("ReserveDestination");
        const programAccounts = await this.#rpc.getProgramAccounts(
            CHANCERY_PROGRAM_ADDRESS,
            [
                { dataSize: accountSchema.size },
                { memcmp: { offset: 0, bytes: encodeBase58(new Uint8Array(accountSchema.discriminator)) } },
            ],
            this.#commitment,
        );
        const snapshots: ChanceryStateSnapshot[] = [];
        for (let index = 0, length = programAccounts.length; index < length; index++) {
            const account = programAccounts[index];
            if (account === undefined || account.account.owner !== CHANCERY_PROGRAM_ADDRESS) {
                continue;
            }
            const decoded = decodeChanceryAccount(account.account.data);
            if (decoded.name !== "ReserveDestination") {
                continue;
            }
            if (requirePublicKeyField(decoded.values, "asset_mint") !== assetMint) {
                continue;
            }
            snapshots.push(snapshotFromDecoded(account.address, account.account, "ReserveDestination", decoded.values));
        }
        return snapshots;
    }

    async #loadChanceryState(
        addressInput: string,
        expectedName: string,
        allowMissing: boolean,
    ): Promise<ChanceryStateSnapshot> {
        const address = normalizePublicKey(addressInput);
        const account = await this.#rpc.getAccountInfo(address, this.#commitment);
        if (account === null) {
            if (!allowMissing) {
                throw new Error(`${expectedName} account ${address} does not exist`);
            }
            return {
                address,
                expectedName,
                exists: false,
                owner: null,
                lamports: null,
                dataLength: 0,
                values: null,
            };
        }
        if (account.owner !== CHANCERY_PROGRAM_ADDRESS) {
            if (allowMissing && account.data.length === 0) {
                return {
                    address,
                    expectedName,
                    exists: false,
                    owner: account.owner,
                    lamports: account.lamports,
                    dataLength: 0,
                    values: null,
                };
            }
            throw new Error(`${expectedName} account ${address} is owned by ${account.owner}`);
        }
        const decoded = decodeChanceryAccount(account.data);
        if (decoded.name !== expectedName) {
            throw new Error(`${address} contains ${decoded.name}, expected ${expectedName}`);
        }
        return snapshotFromDecoded(address, account, expectedName, decoded.values);
    }

    async #loadAddressLookupTables(addresses: readonly string[]): Promise<readonly AddressLookupTable[]> {
        const tables: AddressLookupTable[] = [];
        for (let index = 0, length = addresses.length; index < length; index++) {
            const addressInput = addresses[index];
            if (addressInput === undefined) {
                continue;
            }
            const address = normalizePublicKey(addressInput);
            const account = await this.#rpc.getAccountInfo(address, this.#commitment);
            if (account === null) {
                throw new Error(`Address lookup table ${address} does not exist`);
            }
            tables.push(parseAddressLookupTableAccount(address, account.data));
        }
        return tables;
    }

    async #confirmTransaction(
        signature: string,
        lastValidBlockHeight: bigint,
        commitment: RpcCommitment,
    ): Promise<RpcSignatureStatus> {
        const maximumPolls = 120;
        for (let poll = 0; poll < maximumPolls; poll++) {
            const status = await this.#rpc.getSignatureStatus(signature);
            if (status !== null) {
                if (status.err !== null) {
                    throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err, chanceryJsonReplacer)}`);
                }
                if (commitmentSatisfied(status.confirmationStatus, commitment)) {
                    return status;
                }
            }
            const blockHeight = await this.#rpc.getBlockHeight(commitment);
            if (blockHeight > lastValidBlockHeight) {
                throw new Error(`Transaction ${signature} expired before reaching ${commitment}`);
            }
            await delay(500);
        }
        throw new Error(`Transaction ${signature} did not reach ${commitment} within the confirmation poll limit`);
    }
}

interface InstructionAccountBuildInput {
    readonly request: NormalizedSettlementOperationRequest;
    readonly operationIdentity: OperationIdentity;
    readonly coreAccounts: Readonly<Record<string, ChanceryStateSnapshot>>;
    readonly pathway: ChanceryStateSnapshot;
    readonly permissions: readonly ResolvedPermission[];
    readonly policies: Readonly<Record<string, ChanceryStateSnapshot | null>>;
    readonly limits: readonly ResolvedLimitDimension[];
    readonly tokenAccounts: Readonly<Record<string, TokenAccountSnapshot>>;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly assetTokenProgram: string;
    readonly issuedTokenProgram: string;
    readonly mintAuthorityAddress: string;
    readonly reserveAuthorityAddress: string;
}

function buildInstructionArguments(
    request: NormalizedSettlementOperationRequest,
    identity: OperationIdentity,
    pathwayValues: Readonly<Record<string, unknown>>,
    minimumOutput: bigint,
): StructValues {
    const pathwayId = requireBytes(pathwayValues.pathway_id, "pathway id", 32);
    if (request.mode === "direct") {
        return request.action === "mint"
            ? {
                pathway_id: pathwayId,
                asset_amount: identity.inputAmount,
                minimum_issued_token_amount: minimumOutput,
            }
            : {
                pathway_id: pathwayId,
                issued_token_amount: identity.inputAmount,
                minimum_asset_amount: minimumOutput,
            };
    }
    if (identity.intentId === null) {
        throw new Error("Non-direct settlement has no intent id");
    }
    return {
        intent_id: identity.intentId,
        pathway_id: pathwayId,
    };
}

function buildInstructionAccounts(input: InstructionAccountBuildInput): InstructionAccountInputs {
    const directPermission = input.permissions[0];
    if (directPermission === undefined) {
        throw new Error("Principal permission resolution is missing");
    }
    const pathwayLimit = limitByLabel(input.limits, "pathway");
    const assetLimit = limitByLabel(input.limits, "asset");
    const counterpartyLimit = input.request.mode === "trilateral"
        ? null
        : limitByLabel(input.limits, "counterparty");
    const executorLimit = input.request.mode === "direct"
        ? null
        : limitByLabel(input.limits, "executor");
    const core: Record<string, string | undefined> = {
        asset_config: requiredSnapshotAddress(input.coreAccounts.asset_config, "asset_config"),
        pathway_policy: input.pathway.address,
        source_asset_token_account: input.request.action === "mint" ? requiredTokenAddress(input.tokenAccounts.source, "source") : undefined,
        source_issued_token_account: input.request.action === "redeem" ? requiredTokenAddress(input.tokenAccounts.source, "source") : undefined,
        reserve_asset_token_account: requiredTokenAddress(input.tokenAccounts.reserve, "reserve"),
        destination_issued_token_account: input.request.action === "mint" ? requiredTokenAddress(input.tokenAccounts.destination, "destination") : undefined,
        destination_asset_token_account: input.request.action === "redeem" ? requiredTokenAddress(input.tokenAccounts.destination, "destination") : undefined,
        asset_mint: input.assetMint,
        issued_token_mint: input.issuedTokenMint,
        mint_authority_pda: input.request.action === "mint" ? input.mintAuthorityAddress : undefined,
        reserve_authority_pda: input.request.action === "redeem" ? input.reserveAuthorityAddress : undefined,
        asset_token_program: input.assetTokenProgram,
        issued_token_program: input.issuedTokenProgram,
        asset_pause_state: requiredSnapshotAddress(input.coreAccounts.asset_pause_state, "asset_pause_state", true),
        fee_policy: input.policies.fee_policy?.address,
        fee_recipient_token_account: input.tokenAccounts.fee_recipient?.exists === true
            ? input.tokenAccounts.fee_recipient.address
            : undefined,
        limit_policy: pathwayLimit?.policy?.address,
        hourly_usage_window: windowAddress(pathwayLimit, "hourly"),
        daily_usage_window: windowAddress(pathwayLimit, "daily"),
        weekly_usage_window: windowAddress(pathwayLimit, "weekly"),
        monthly_usage_window: windowAddress(pathwayLimit, "monthly"),
        evidence_policy: input.policies.evidence_policy?.address,
        asset_limit_policy: assetLimit?.policy?.address,
        asset_daily_usage_window: windowAddress(assetLimit, "daily"),
        counterparty_limit_policy: input.policies.counterparty_limit_policy?.address,
        counterparty_daily_usage_window: windowAddress(counterpartyLimit, "daily"),
        executor_limit_policy: input.policies.executor_limit_policy?.address,
        executor_daily_usage_window: windowAddress(executorLimit, "daily"),
    };

    if (input.request.mode === "direct") {
        core.permission_record = directPermission.address;
        core.principal = input.operationIdentity.principalA;
    } else if (input.request.mode === "delegated") {
        const executorPermission = input.permissions[1];
        if (executorPermission === undefined || input.operationIdentity.intent === null) {
            throw new Error("Delegated settlement permission or intent resolution is missing");
        }
        core.intent = input.operationIdentity.intent.address;
        core.principal_permission_record = directPermission.address;
        core.executor_permission_record = executorPermission.address;
        core.executor = input.operationIdentity.executor;
        core.principal = input.operationIdentity.principalA;
        core.settlement_policy = input.policies.settlement_policy?.address;
        core.rent_refund_recipient = input.operationIdentity.rentRefundRecipient;
    } else {
        const principalBPermission = input.permissions[1];
        const executorPermission = input.permissions[2];
        if (principalBPermission === undefined || executorPermission === undefined || input.operationIdentity.intent === null) {
            throw new Error("Trilateral settlement permission or intent resolution is missing");
        }
        const counterpartyA = limitByLabel(input.limits, "counterparty_a");
        const counterpartyB = limitByLabel(input.limits, "counterparty_b");
        core.intent = input.operationIdentity.intent.address;
        core.principal_a_permission_record = directPermission.address;
        core.principal_b_permission_record = principalBPermission.address;
        core.executor_permission_record = executorPermission.address;
        core.executor = input.operationIdentity.executor;
        core.principal_a = input.operationIdentity.principalA;
        core.principal_b = input.operationIdentity.principalB;
        core.settlement_policy = input.policies.settlement_policy?.address;
        core.counterparty_a_daily_usage_window = windowAddress(counterpartyA, "daily");
        core.counterparty_b_daily_usage_window = windowAddress(counterpartyB, "daily");
        core.rent_refund_recipient = input.operationIdentity.rentRefundRecipient;
    }
    return compactAccountInputs(core);
}

export interface SettlementEffectiveQuoteResolution {
    readonly grossOutput: bigint;
    readonly feeQuote: FeeQuote;
    readonly effectiveQuote: SettlementEffectiveQuote;
}

export function computeSettlementEffectiveQuote(
    action: SettlementAction,
    requestedInputAmount: bigint,
    assetValues: Readonly<Record<string, unknown>>,
    assetMintValues: DecodedTokenMint | null,
    feePolicyValues: Readonly<Record<string, unknown>> | null,
    nowUnixTimestamp: bigint,
    currentEpoch: bigint,
): SettlementEffectiveQuoteResolution {
    if (requestedInputAmount < 0n) {
        throw new Error("Requested input amount must be non-negative");
    }
    const configuredRateE9 = action === "mint"
        ? requireBigIntField(assetValues, "deposit_rate_e9")
        : requireBigIntField(assetValues, "redeem_rate_e9");
    const configuredGrossOutputFromRequestedInput = computeSettlementGrossOutput(
        action,
        requestedInputAmount,
        assetValues,
    );
    const assetTransferFeeConfig = assetMintValues?.transferFeeConfig ?? null;
    const inputAssetTransfer = action === "mint"
        ? calculateTokenTransferFee(requestedInputAmount, assetTransferFeeConfig, currentEpoch)
        : calculateTokenTransferFee(0n, null, currentEpoch);
    const rateInputAmount = action === "mint"
        ? inputAssetTransfer.receivedAmount
        : requestedInputAmount;
    const grossOutput = computeSettlementGrossOutput(action, rateInputAmount, assetValues);
    const grossInputForFee = action === "mint" ? rateInputAmount : requestedInputAmount;
    const feeQuote = computeFeeQuote(
        action,
        grossInputForFee,
        grossOutput,
        feePolicyValues,
        nowUnixTimestamp,
    );
    const principalAssetTransfer = action === "redeem"
        ? calculateTokenTransferFee(feeQuote.netOutput, assetTransferFeeConfig, currentEpoch)
        : calculateTokenTransferFee(feeQuote.netOutput, null, currentEpoch);
    const routedFeeTransfer = feeQuote.routed
        ? action === "redeem"
            ? calculateTokenTransferFee(feeQuote.netFee, assetTransferFeeConfig, currentEpoch)
            : calculateTokenTransferFee(feeQuote.netFee, null, currentEpoch)
        : null;
    const principalReceivedAmount = principalAssetTransfer.receivedAmount;
    const allInOutputReduction = configuredGrossOutputFromRequestedInput > principalReceivedAmount
        ? configuredGrossOutputFromRequestedInput - principalReceivedAmount
        : 0n;
    const observations: string[] = [];
    if (assetMintValues === null) {
        observations.push("Asset mint state is unavailable; transfer-fee effects cannot be calculated locally");
    }
    if (assetMintValues?.hasUnmodeledTransferBehavior === true) {
        observations.push("The asset mint has transfer behavior that requires transaction simulation for an exact received amount");
    }
    return {
        grossOutput,
        feeQuote,
        effectiveQuote: {
            action,
            currentEpoch,
            configuredRateE9,
            configuredGrossOutputFromRequestedInput,
            rateInputAmount,
            grossOutput,
            inputAssetTransfer,
            chanceryFeeAmount: feeQuote.netFee,
            chanceryFeeBasisPoints: grossOutput === 0n
                ? null
                : feeQuote.netFee * 10_000n / grossOutput,
            outputBeforePrincipalTransfer: feeQuote.netOutput,
            principalAssetTransfer,
            principalReceivedAmount,
            routedFeeTransfer,
            feeRecipientReceivedAmount: routedFeeTransfer?.receivedAmount ?? 0n,
            allInOutputReduction,
            allInFeeBasisPoints: configuredGrossOutputFromRequestedInput === 0n
                ? null
                : allInOutputReduction * 10_000n / configuredGrossOutputFromRequestedInput,
            effectiveOutputRateE9: requestedInputAmount === 0n
                ? null
                : principalReceivedAmount * 1_000_000_000n / requestedInputAmount,
            requiresSimulationForExactAmount: assetMintValues === null
                || assetMintValues.hasUnmodeledTransferBehavior,
            observations,
        },
    };
}

function normalizeRequest(
    request: SettlementOperationRequest,
    observedUnixTimestamp: bigint,
): NormalizedSettlementOperationRequest {
    if (request.action !== "mint" && request.action !== "redeem") {
        throw new Error(`Unsupported settlement action: ${String(request.action)}`);
    }
    if (request.mode !== "direct" && request.mode !== "delegated" && request.mode !== "trilateral") {
        throw new Error(`Unsupported settlement mode: ${String(request.mode)}`);
    }
    const amount = request.amount ?? null;
    const minimumOutput = request.minimumOutput ?? null;
    if (amount !== null && amount < 0n) {
        throw new Error("Settlement amount cannot be negative");
    }
    if (minimumOutput !== null && minimumOutput < 0n) {
        throw new Error("Minimum output cannot be negative");
    }
    return {
        action: request.action,
        mode: request.mode,
        assetMint: normalizePublicKey(request.assetMint),
        principal: normalizePublicKey(request.principal),
        amount,
        minimumOutput,
        pathwayId: request.pathwayId === undefined ? null : bytes32FromInput(request.pathwayId, "pathway id"),
        intentId: request.intentId === undefined ? null : bytes32FromInput(request.intentId, "intent id"),
        executor: request.executor === undefined ? null : normalizePublicKey(request.executor),
        principalB: request.principalB === undefined ? null : normalizePublicKey(request.principalB),
        sourceTokenAccount: request.sourceTokenAccount === undefined ? null : normalizePublicKey(request.sourceTokenAccount),
        destinationTokenAccount: request.destinationTokenAccount === undefined ? null : normalizePublicKey(request.destinationTokenAccount),
        feeRecipientTokenAccount: request.feeRecipientTokenAccount === undefined ? null : normalizePublicKey(request.feeRecipientTokenAccount),
        rentRefundRecipient: request.rentRefundRecipient === undefined ? null : normalizePublicKey(request.rentRefundRecipient),
        nowUnixTimestamp: request.nowUnixTimestamp ?? observedUnixTimestamp,
    };
}

function selectPathwayCandidate(candidates: readonly PathwayCandidate[]): PathwayCandidate {
    const matches: PathwayCandidate[] = [];
    for (let index = 0, length = candidates.length; index < length; index++) {
        const candidate = candidates[index];
        if (
            candidate !== undefined
            && candidate.matchesRequestedAsset
            && candidate.matchesIssuedToken
            && candidate.matchesMode
            && candidate.matchesRequestedPathwayId
            && candidate.canonicalPda
        ) {
            matches.push(candidate);
        }
    }
    if (matches.length === 0) {
        throw new Error("No canonical Chancery pathway matches the requested asset, issued token, mode, and pathway id");
    }
    if (matches.length > 1) {
        throw new Error("Multiple Chancery pathways match; supply an explicit pathway id");
    }
    const selected = matches[0];
    if (selected === undefined) {
        throw new Error("Pathway selection failed");
    }
    return selected;
}

function validateIntentAgainstPathway(
    request: NormalizedSettlementOperationRequest,
    identity: OperationIdentity,
    pathwayValues: Readonly<Record<string, unknown>>,
    issuedTokenMint: string,
    issues: string[],
): void {
    if (identity.intent?.values === null || identity.intent === null) {
        return;
    }
    const intent = identity.intent.values;
    if (requireNumberField(intent, "settlement_mode") !== SETTLEMENT_MODE_VALUE[request.mode]) {
        issues.push("Settlement intent mode does not match the requested mode");
    }
    if (requireNumberField(intent, "settlement_action") !== SETTLEMENT_ACTION_VALUE[request.action]) {
        issues.push("Settlement intent action does not match the requested action");
    }
    if (requirePublicKeyField(intent, "asset_mint") !== request.assetMint) {
        issues.push("Settlement intent asset mint does not match the requested asset mint");
    }
    if (requirePublicKeyField(intent, "issued_token_mint") !== issuedTokenMint) {
        issues.push("Settlement intent issued token mint does not match ChanceryConfig");
    }
    if (bytes32Hex(intent.pathway_id, "intent pathway id") !== bytes32Hex(pathwayValues.pathway_id, "pathway id")) {
        issues.push("Settlement intent pathway id does not match the selected pathway");
    }
    const status = requireNumberField(intent, "status");
    if (status !== 0) {
        issues.push(`Settlement intent status is ${status}, not pending`);
    }
    const now = request.nowUnixTimestamp;
    const validAfter = requireBigIntField(intent, "valid_after_unix_timestamp");
    const expiresAt = requireBigIntField(intent, "expires_at_unix_timestamp");
    if (validAfter !== 0n && now < validAfter) {
        issues.push("Settlement intent is not yet valid");
    }
    if (expiresAt !== 0n && now >= expiresAt) {
        issues.push("Settlement intent has expired");
    }
}

function validateAmount(
    action: SettlementAction,
    inputAmount: bigint,
    minimumOutput: bigint,
    assetValues: Readonly<Record<string, unknown>>,
    principalReceivedAmount: bigint,
    issues: string[],
): void {
    const minimumInput = action === "mint"
        ? requireBigIntField(assetValues, "minimum_deposit_amount")
        : requireBigIntField(assetValues, "minimum_redeem_amount");
    const maximumInput = requireBigIntField(assetValues, "maximum_single_settlement_amount");
    if (inputAmount < minimumInput) {
        issues.push(`Input amount ${inputAmount.toString()} is below minimum ${minimumInput.toString()}`);
    }
    if (maximumInput !== 0n && inputAmount > maximumInput) {
        issues.push(`Input amount ${inputAmount.toString()} exceeds maximum ${maximumInput.toString()}`);
    }
    if (minimumOutput > principalReceivedAmount) {
        issues.push(`Minimum output ${minimumOutput.toString()} exceeds predicted principal receipt ${principalReceivedAmount.toString()}`);
    }
}

function validateCoreSettlementGates(
    action: SettlementAction,
    currentSlot: bigint,
    moduleActivationValues: Readonly<Record<string, unknown>>,
    assetValues: Readonly<Record<string, unknown>>,
    issuedTokenControlValues: Readonly<Record<string, unknown>>,
    pathwayValues: Readonly<Record<string, unknown>>,
    evidencePolicyValues: Readonly<Record<string, unknown>> | null,
    issues: string[],
): void {
    const moduleStatuses = requireBytes(moduleActivationValues.module_statuses, "module_statuses", 32);
    if (moduleStatuses[SETTLEMENT_MODULE_ID] !== MODULE_STATUS_ACTIVE) {
        issues.push("Settlement module is not active");
    }

    const assetMode = requireNumberField(assetValues, "mode");
    if (action === "mint" && assetMode !== ASSET_MODE_ACTIVE) {
        issues.push("Asset mode forbids mint settlement");
    }
    if (action === "redeem" && assetMode !== ASSET_MODE_ACTIVE && assetMode !== ASSET_MODE_WIND_DOWN) {
        issues.push("Asset mode forbids redeem settlement");
    }

    validateExtensionFreshness(
        "Asset",
        requireBigIntField(assetValues, "extension_observed_at_slot"),
        requireBigIntField(assetValues, "max_extension_observation_age_slots"),
        currentSlot,
        issues,
    );
    const observedCollateral = requireBigIntArrayField(assetValues, "observed_extension_mask", 2);
    const approvedCollateral = requireBigIntArrayField(assetValues, "approved_extension_mask", 2);
    const assetForbidden = requireBigIntArrayField(assetValues, "forbidden_extension_mask", 2);
    const pathwayCollateralForbidden = requireBigIntArrayField(
        pathwayValues,
        "forbidden_collateral_extension_mask",
        2,
    );
    for (let index = 0; index < 2; index++) {
        const observed = observedCollateral[index] ?? 0n;
        const approved = approvedCollateral[index] ?? 0n;
        const protocolForbidden = index === 0 ? COLLATERAL_TRANSFER_HOOK_EXTENSION : 0n;
        const effectiveForbidden = (assetForbidden[index] ?? 0n) | protocolForbidden;
        if ((observed & ~approved) !== 0n) {
            issues.push("Asset extension observation contains an extension not approved by AssetConfig");
            break;
        }
        if ((observed & effectiveForbidden) !== 0n) {
            issues.push("Asset extension observation contains a forbidden extension");
            break;
        }
        if ((observed & (pathwayCollateralForbidden[index] ?? 0n)) !== 0n) {
            issues.push("Asset extension observation is forbidden by the selected pathway");
            break;
        }
    }

    const controlFlags = requireBigIntField(issuedTokenControlValues, "control_flags");
    if ((controlFlags & ISSUED_TOKEN_READY_FOR_SETTLEMENT) === 0n) {
        issues.push("Issued token deployment is not ready for settlement");
    }
    validateExtensionFreshness(
        "Issued token",
        requireBigIntField(issuedTokenControlValues, "extension_observed_at_slot"),
        requireBigIntField(issuedTokenControlValues, "max_extension_observation_age_slots"),
        currentSlot,
        issues,
    );
    const activeIssuedExtensions = requireBigIntArrayField(
        issuedTokenControlValues,
        "active_mint_extension_mask",
        2,
    );
    const pathwayIssuedForbidden = requireBigIntArrayField(
        pathwayValues,
        "forbidden_issued_token_extension_mask",
        2,
    );
    for (let index = 0; index < 2; index++) {
        if (((activeIssuedExtensions[index] ?? 0n) & (pathwayIssuedForbidden[index] ?? 0n)) !== 0n) {
            issues.push("Issued-token extension observation is forbidden by the selected pathway");
            break;
        }
    }

    const evidencePolicyId = requireBytes(pathwayValues.evidence_policy_id, "evidence_policy_id", 32);
    const hasEvidencePolicy = !isZeroBytes32(evidencePolicyId, "evidence_policy_id");
    if (hasEvidencePolicy && evidencePolicyValues === null) {
        issues.push("Selected pathway requires an evidence policy account");
    }
    if (!hasEvidencePolicy && evidencePolicyValues !== null) {
        issues.push("Evidence policy account is present but the selected pathway has no evidence policy binding");
    }
    if (evidencePolicyValues !== null) {
        const requiredFieldMask = requireBigIntArrayField(evidencePolicyValues, "required_field_mask", 2);
        const schemaHash = requireBytes(
            evidencePolicyValues.counterparty_reporting_schema_hash,
            "counterparty_reporting_schema_hash",
            32,
        );
        if (
            (requiredFieldMask[1] ?? 0n) !== 0n
            || (((requiredFieldMask[0] ?? 0n) & ~SETTLEMENT_EVIDENCE_SUPPORTED_FIELD_MASK) !== 0n)
        ) {
            issues.push("Evidence policy requires fields that settlement evidence cannot prove");
        }
        if (
            requireNumberField(evidencePolicyValues, "allow_freeform_counterparty_fields") !== 0
            || !isZeroBytes32(schemaHash, "counterparty_reporting_schema_hash")
            || requireNumberField(evidencePolicyValues, "maximum_freeform_field_count") !== 0
            || requireNumberField(evidencePolicyValues, "maximum_freeform_value_bytes") !== 0
            || requireBigIntField(evidencePolicyValues, "retention_flags") !== 0n
        ) {
            issues.push("Evidence policy uses a configuration unsupported by settlement evidence");
        }
    }
}

function validateExtensionFreshness(
    label: string,
    observedAtSlot: bigint,
    maximumAgeSlots: bigint,
    currentSlot: bigint,
    issues: string[],
): void {
    if (observedAtSlot > currentSlot) {
        issues.push(`${label} extension observation is future-dated`);
        return;
    }
    if (maximumAgeSlots !== 0n && currentSlot - observedAtSlot > maximumAgeSlots) {
        issues.push(`${label} extension observation is stale`);
    }
}

function validateLimits(limits: readonly ResolvedLimitDimension[], issues: string[]): void {
    for (let index = 0, length = limits.length; index < length; index++) {
        const limit = limits[index];
        if (limit === undefined) {
            continue;
        }
        for (let issueIndex = 0, issueLength = limit.validationIssues.length; issueIndex < issueLength; issueIndex++) {
            const issue = limit.validationIssues[issueIndex];
            if (issue !== undefined) {
                issues.push(`${limit.label} ${issue}`);
            }
        }
        if (limit.observation === null) {
            continue;
        }
        if (!limit.observation.perTransactionAllowed) {
            issues.push(`${limit.label} per-transaction limit is exceeded`);
        }
        for (let windowIndex = 0, windowLength = limit.observation.windows.length; windowIndex < windowLength; windowIndex++) {
            const window = limit.observation.windows[windowIndex];
            if (window === undefined) {
                continue;
            }
            if (window.clockRegression) {
                issues.push(`${limit.label} ${window.name} usage window starts after the canonical current period`);
            } else {
                if (!window.allowed) {
                    issues.push(`${limit.label} ${window.name} volume limit is exceeded`);
                }
                if (!window.actionAllowed) {
                    issues.push(`${limit.label} ${window.name} action-count limit is exceeded`);
                }
            }
            const enforced = window.maximum !== 0n || window.maximumActionCount !== 0;
            const snapshot = limit.windows[window.name];
            if (enforced && snapshot?.exists !== true) {
                issues.push(`${limit.label} ${window.name} usage window does not exist`);
            }
        }
    }
}

function dimensionPolicyValidationIssues(
    policyValues: Readonly<Record<string, unknown>>,
    expectedScopeKind: number,
    expectedScopeKey: string,
    requireDailyMaximum: boolean,
): readonly string[] {
    const issues: string[] = [];
    if (requireNumberField(policyValues, "scope_kind") !== expectedScopeKind) {
        issues.push(`limit policy scope kind does not match ${expectedScopeKind.toString()}`);
    }
    if (requirePublicKeyField(policyValues, "scope_key") !== expectedScopeKey) {
        issues.push(`limit policy scope key does not match ${expectedScopeKey}`);
    }
    if (
        requireBigIntField(policyValues, "per_hour_maximum") !== 0n
        || requireBigIntField(policyValues, "per_seven_day_maximum") !== 0n
        || requireBigIntField(policyValues, "per_thirty_day_maximum") !== 0n
        || requireNumberField(policyValues, "maximum_actions_per_hour") !== 0
        || requireNumberField(policyValues, "maximum_actions_per_day") !== 0
    ) {
        issues.push("dimension policy contains caps that settlement does not enforce");
    }
    if (requireDailyMaximum && requireBigIntField(policyValues, "per_day_maximum") === 0n) {
        issues.push("delegated counterparty policy requires a daily maximum");
    }
    return issues;
}

function validateTokenAccounts(
    request: NormalizedSettlementOperationRequest,
    inputAmount: bigint,
    requiredReserveBalance: bigint,
    source: TokenAccountSnapshot,
    destination: TokenAccountSnapshot,
    reserve: TokenAccountSnapshot,
    feeRecipient: TokenAccountSnapshot,
    feeRouted: boolean,
    issues: string[],
): void {
    if (!source.exists || source.values === null) {
        issues.push(`Source token account ${source.address} does not exist`);
    } else if (source.values.amount < inputAmount) {
        issues.push(`Source token balance ${source.values.amount.toString()} is below input amount ${inputAmount.toString()}`);
    }
    if (!destination.exists) {
        issues.push(`Destination token account ${destination.address} does not exist`);
    }
    if (!reserve.exists || reserve.values === null) {
        issues.push(`Reserve token account ${reserve.address} does not exist`);
    } else if (request.action === "redeem" && reserve.values.amount < requiredReserveBalance) {
        issues.push(
            `Reserve balance ${reserve.values.amount.toString()} is below required reserve outflow ${requiredReserveBalance.toString()}`,
        );
    }
    if (feeRouted && !feeRecipient.exists) {
        issues.push(`Fee recipient token account ${feeRecipient.address} does not exist`);
    }
}

function observePauses(
    action: SettlementAction,
    currentSlot: bigint,
    pauseState: ChanceryStateSnapshot,
    assetPauseState: ChanceryStateSnapshot,
    pathway: ChanceryStateSnapshot,
): SettlementPauseObservation {
    const actionBit = action === "mint" ? 1n : 2n;
    const globalValues = requireSnapshotValues(pauseState);
    const globalExpiry = requireBigIntField(globalValues, "expires_at_slot");
    const globalActive = globalExpiry === 0n || currentSlot < globalExpiry;
    const globalPaused = globalActive && (requireBigIntField(globalValues, "global_pause_bits") & actionBit) !== 0n;

    let assetPaused = false;
    if (assetPauseState.values !== null) {
        const assetExpiry = requireBigIntField(assetPauseState.values, "expires_at_slot");
        const assetActive = assetExpiry === 0n || currentSlot < assetExpiry;
        assetPaused = assetActive && (requireBigIntField(assetPauseState.values, "asset_pause_bits") & actionBit) !== 0n;
    }
    const pathwayValues = requireSnapshotValues(pathway);
    const pathwayPaused = (requireBigIntField(pathwayValues, "status_flags") & STATUS_FLAG.PATHWAY_PAUSE) !== 0n;
    return { currentSlot, globalPaused, assetPaused, pathwayPaused };
}

function snapshotFromDecoded(
    address: string,
    account: RpcAccountInfo,
    expectedName: string,
    values: Readonly<Record<string, unknown>>,
): ChanceryStateSnapshot {
    return {
        address,
        expectedName,
        exists: true,
        owner: account.owner,
        lamports: account.lamports,
        dataLength: account.data.length,
        values,
    };
}

function requireSnapshotValues(snapshot: ChanceryStateSnapshot): Readonly<Record<string, unknown>> {
    if (snapshot.values === null) {
        throw new Error(`${snapshot.expectedName} account ${snapshot.address} has no decoded values`);
    }
    return snapshot.values;
}

function requiredSnapshotAddress(
    snapshot: ChanceryStateSnapshot | undefined,
    label: string,
    allowUninitializedPda = false,
): string {
    if (snapshot === undefined) {
        throw new Error(`${label} snapshot is missing`);
    }
    if (!snapshot.exists && !allowUninitializedPda) {
        throw new Error(`${label} account ${snapshot.address} does not exist`);
    }
    return snapshot.address;
}

function requiredTokenAddress(snapshot: TokenAccountSnapshot | undefined, label: string): string {
    if (snapshot === undefined || !snapshot.exists) {
        throw new Error(`${label} token account is unavailable`);
    }
    return snapshot.address;
}

function emptyLimitDimension(label: ResolvedLimitDimension["label"]): ResolvedLimitDimension {
    return {
        label,
        policy: null,
        scopeHash: null,
        windows: { hourly: null, daily: null, weekly: null, monthly: null },
        observation: null,
        validationIssues: [],
    };
}

function snapshotValuesByWindow(
    windows: Readonly<Record<string, ChanceryStateSnapshot | null>>,
): Readonly<Record<string, Readonly<Record<string, unknown>> | null>> {
    const values: Record<string, Readonly<Record<string, unknown>> | null> = {};
    const names = Object.keys(windows);
    for (let index = 0, length = names.length; index < length; index++) {
        const name = names[index];
        if (name !== undefined) {
            values[name] = windows[name]?.values ?? null;
        }
    }
    return values;
}

function limitByLabel(
    limits: readonly ResolvedLimitDimension[],
    label: ResolvedLimitDimension["label"],
): ResolvedLimitDimension | null {
    for (let index = 0, length = limits.length; index < length; index++) {
        const limit = limits[index];
        if (limit?.label === label) {
            return limit;
        }
    }
    return null;
}

function windowAddress(limit: ResolvedLimitDimension | null, name: string): string | undefined {
    const snapshot = limit?.windows[name];
    return snapshot?.exists === true ? snapshot.address : undefined;
}

function compactAccountInputs(values: Readonly<Record<string, string | undefined>>): InstructionAccountInputs {
    const result: Record<string, string> = {};
    const names = Object.keys(values);
    for (let index = 0, length = names.length; index < length; index++) {
        const name = names[index];
        if (name === undefined) {
            continue;
        }
        const value = values[name];
        if (value !== undefined) {
            result[name] = value;
        }
    }
    return result;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
    const unique = new Set<string>();
    for (let index = 0, length = values.length; index < length; index++) {
        const value = values[index];
        if (value !== undefined) {
            unique.add(value);
        }
    }
    return [...unique];
}

function assertInspectionReady(inspection: SettlementInspection): void {
    if (!inspection.ready) {
        throw new Error(
            `Settlement operation is not ready:\n${inspection.blockingIssues.map((issue) => `- ${issue}`).join("\n")}`,
        );
    }
}

function commitmentSatisfied(
    actual: RpcCommitment | null,
    required: RpcCommitment,
): boolean {
    if (actual === null) {
        return false;
    }
    const rank: Readonly<Record<RpcCommitment, number>> = {
        processed: 0,
        confirmed: 1,
        finalized: 2,
    };
    return rank[actual] >= rank[required];
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
