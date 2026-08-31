import { createHash } from "node:crypto";

import { decodeBase58, decodePublicKey, encodeBase58, normalizePublicKey } from "../Base58Codec.js";
import { bytesToHex } from "../BinaryCodec.js";
import { CHANCERY_PROGRAM_ADDRESS, CHANCERY_SCHEMA, ZERO_ADDRESS } from "../ChancerySchema.js";
import { findProgramAddress, type ProgramAddressResult } from "../ProgramAddress.js";

export type SettlementAction = "mint" | "redeem";
export type SettlementMode = "direct" | "delegated" | "trilateral";

export const SETTLEMENT_ACTION_VALUE: Readonly<Record<SettlementAction, number>> = {
    mint: 0,
    redeem: 1,
};

export const SETTLEMENT_MODE_VALUE: Readonly<Record<SettlementMode, number>> = {
    direct: 0,
    delegated: 1,
    trilateral: 2,
};

export const PATHWAY_KIND_VALUE: Readonly<Record<SettlementMode, number>> = {
    direct: 0,
    delegated: 1,
    trilateral: 2,
};

export const ROLE = {
    CAN_MINT_DIRECT: 1n << 0n,
    CAN_REDEEM_DIRECT: 1n << 1n,
    CAN_MINT_DELEGATED: 1n << 2n,
    CAN_REDEEM_DELEGATED: 1n << 3n,
    CAN_EXECUTE_SETTLEMENT: 1n << 4n,
    CAN_USE_TRILATERAL_PATHWAY: 1n << 5n,
} as const;

export const SCOPE = {
    GLOBAL: 0,
    ASSET: 1,
    PATHWAY: 2,
    DESTINATION: 3,
    EXECUTOR: 4,
    COUNTERPARTY: 12,
} as const;

export const WINDOW_KIND = {
    HOURLY: 0,
    DAILY: 1,
    WEEKLY: 2,
    MONTHLY: 3,
} as const;

export const STATUS_FLAG = {
    INITIALIZED: 1n << 0n,
    PATHWAY_PAUSE: 1n << 3n,
    MINT_PAUSED: 1n << 4n,
    REDEEM_PAUSED: 1n << 5n,
} as const;

export const PERMISSION_FLAG = {
    PAUSED: 1n << 0n,
} as const;

export const FEE_FLAG = {
    FEE_IN_ASSET: 1n << 0n,
    FEE_IN_ISSUED_TOKEN: 1n << 1n,
    PERCENT_ON_INPUT: 1n << 2n,
    REBATE_TO_PRINCIPAL: 1n << 3n,
    ACTIVE: 1n << 4n,
} as const;

export const FEE_RECIPIENT = {
    NONE: 0,
    PROTOCOL_TREASURY: 1,
    OPERATOR_OWNED_WALLET: 2,
    PATHWAY_SPECIFIC: 3,
    RESERVE_RETENTION: 4,
} as const;

export const ROUNDING = {
    FLOOR: 0,
    CEILING: 1,
    NEAREST: 2,
} as const;

export const RATE_PRECISION_E9 = 1_000_000_000n;

export interface NamedProgramAddress extends ProgramAddressResult {
    readonly name: string;
    readonly seeds: readonly string[];
}

export interface FeeQuote {
    readonly grossInput: bigint;
    readonly grossOutput: bigint;
    readonly denomination: "asset" | "issued_token" | "invalid";
    readonly assessedFee: bigint;
    readonly nominalRebate: bigint;
    readonly effectiveRebate: bigint;
    readonly netFee: bigint;
    readonly netOutput: bigint;
    readonly routed: boolean;
    readonly feeRecipientOwner: string;
    readonly effective: boolean;
    readonly observations: readonly string[];
}

export interface PermissionObservation {
    readonly requiredRole: bigint;
    readonly heldRoles: bigint;
    readonly hasRequiredRole: boolean;
    readonly subjectMatches: boolean;
    readonly scopeMatches: boolean;
    readonly roleSchemaMatches: boolean;
    readonly paused: boolean;
    readonly expired: boolean;
    readonly usable: boolean;
}

export interface SettlementPolicyObservation {
    readonly identityMatches: boolean;
    readonly bumpMatches: boolean;
    readonly policyIdNonzero: boolean;
    readonly policyFlagsValid: boolean;
    readonly allowedSettlementModes: number;
    readonly modeMaskValid: boolean;
    readonly modeAllowed: boolean;
    readonly assetAllowed: boolean;
    readonly principalAAllowed: boolean;
    readonly principalBAllowed: boolean;
    readonly executorAllowed: boolean;
    readonly minimumNotional: bigint;
    readonly maximumNotional: bigint;
    readonly notionalAllowed: boolean;
    readonly validAfterUnixTimestamp: bigint;
    readonly expiresAtUnixTimestamp: bigint;
    readonly timestampRangeValid: boolean;
    readonly temporallyEffective: boolean;
    readonly usable: boolean;
    readonly observations: readonly string[];
}

export interface LimitObservation {
    readonly action: SettlementAction;
    readonly accumulatorField: "gross_in" | "gross_output_amount";
    readonly perTransactionMaximum: bigint;
    readonly proposedAmount: bigint;
    readonly perTransactionRemainingBefore: bigint | null;
    readonly perTransactionRemainingAfter: bigint | null;
    readonly perTransactionAllowed: boolean;
    readonly windows: readonly LimitWindowObservation[];
}

export interface LimitWindowObservation {
    readonly name: "hourly" | "daily" | "weekly" | "monthly";
    readonly windowKind: number;
    readonly maximum: bigint;
    readonly accumulatorField: "gross_in" | "gross_output_amount";
    readonly storedWindowStartUnixTimestamp: bigint | null;
    readonly canonicalWindowStartUnixTimestamp: bigint;
    readonly rolledBeforeCheck: boolean;
    readonly clockRegression: boolean;
    readonly currentAmount: bigint;
    readonly proposedAmount: bigint;
    readonly projectedAmount: bigint;
    readonly remainingBefore: bigint | null;
    readonly remainingAfter: bigint | null;
    readonly allowed: boolean;
    readonly currentActionCount: number;
    readonly projectedActionCount: number;
    readonly maximumActionCount: number;
    readonly actionRemainingBefore: number | null;
    readonly actionRemainingAfter: number | null;
    readonly actionAllowed: boolean;
}

export function requiredPrincipalRole(action: SettlementAction, mode: SettlementMode): bigint {
    if (mode === "direct") {
        return action === "mint" ? ROLE.CAN_MINT_DIRECT : ROLE.CAN_REDEEM_DIRECT;
    }
    return action === "mint" ? ROLE.CAN_MINT_DELEGATED : ROLE.CAN_REDEEM_DELEGATED;
}

export function settlementInstructionName(action: SettlementAction, mode: SettlementMode): string {
    return `${action}_${mode}`;
}

export function bytes32FromInput(value: string | Uint8Array, label: string): Uint8Array {
    if (value instanceof Uint8Array) {
        if (value.length !== 32) {
            throw new Error(`${label} must contain exactly 32 bytes`);
        }
        return new Uint8Array(value);
    }
    let bytes: Uint8Array;
    if (value.startsWith("0x")) {
        bytes = decodeHex(value.slice(2), label);
    } else if (value.startsWith("hex:")) {
        bytes = decodeHex(value.slice(4), label);
    } else if (value.startsWith("base58:")) {
        bytes = decodeBase58(value.slice(7));
    } else if (value.startsWith("utf8:")) {
        const textBytes = new TextEncoder().encode(value.slice(5));
        if (textBytes.length > 32) {
            throw new Error(`${label} UTF-8 value exceeds 32 bytes`);
        }
        bytes = new Uint8Array(32);
        bytes.set(textBytes);
    } else {
        const hexadecimalCandidate = /^[0-9a-fA-F]{64}$/.test(value);
        bytes = hexadecimalCandidate ? decodeHex(value, label) : decodeBase58(value);
    }
    if (bytes.length !== 32) {
        throw new Error(`${label} must resolve to exactly 32 bytes`);
    }
    return bytes;
}

export function bytes32Hex(value: unknown, label: string): string {
    return `0x${bytesToHex(requireBytes(value, label, 32))}`;
}

export function isZeroBytes32(value: unknown, label: string): boolean {
    const bytes = requireBytes(value, label, 32);
    for (let index = 0; index < 32; index++) {
        if (bytes[index] !== 0) {
            return false;
        }
    }
    return true;
}

export function deriveNamedProgramAddress(name: string, seeds: readonly Uint8Array[]): NamedProgramAddress {
    const result = findProgramAddress(seeds, CHANCERY_PROGRAM_ADDRESS);
    const seedDescriptions: string[] = [];
    for (let index = 0, length = seeds.length; index < length; index++) {
        const seed = seeds[index];
        if (seed !== undefined) {
            seedDescriptions.push(`0x${bytesToHex(seed)}`);
        }
    }
    return { name, ...result, seeds: seedDescriptions };
}

export function deriveAssetConfigAddress(assetMint: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("asset_config", [textSeed("asset-config"), decodePublicKey(assetMint)]);
}

export function deriveAssetPauseStateAddress(assetMint: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("asset_pause_state", [textSeed("asset-pause"), decodePublicKey(assetMint)]);
}

export function derivePathwayPolicyAddress(pathwayId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("pathway_policy", [textSeed("pathway-policy"), bytes32FromInput(pathwayId, "pathway id")]);
}

export function derivePermissionRecordAddress(
    subject: string | Uint8Array,
    scopeKind: number,
    scopeKey: string | Uint8Array,
): NamedProgramAddress {
    assertByte(scopeKind, "permission scope kind");
    return deriveNamedProgramAddress("permission_record", [
        textSeed("permission"),
        decodePublicKey(subject),
        new Uint8Array([scopeKind]),
        decodePublicKey(scopeKey),
    ]);
}

export function deriveFeePolicyAddress(feePolicyId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("fee_policy", [textSeed("fee-policy"), bytes32FromInput(feePolicyId, "fee policy id")]);
}

export function deriveLimitPolicyAddress(limitPolicyId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("limit_policy", [textSeed("limit-policy"), bytes32FromInput(limitPolicyId, "limit policy id")]);
}

export function deriveEvidencePolicyAddress(evidencePolicyId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("evidence_policy", [textSeed("evidence-policy"), bytes32FromInput(evidencePolicyId, "evidence policy id")]);
}

export function deriveSettlementPolicyAddress(policyId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("settlement_policy", [textSeed("settlement-policy"), bytes32FromInput(policyId, "settlement policy id")]);
}

export function deriveSettlementIntentAddress(intentId: string | Uint8Array): NamedProgramAddress {
    return deriveNamedProgramAddress("settlement_intent", [textSeed("settlement-intent"), bytes32FromInput(intentId, "intent id")]);
}

export function deriveUsageWindowAddress(scopeHash: Uint8Array, windowKind: number): NamedProgramAddress {
    if (scopeHash.length !== 32) {
        throw new Error("Usage-window scope hash must contain 32 bytes");
    }
    assertByte(windowKind, "window kind");
    return deriveNamedProgramAddress("usage_window", [
        textSeed("usage-window"),
        scopeHash,
        new Uint8Array([windowKind]),
    ]);
}

export function deriveAuthorityTransferAddress(roleKind: number): NamedProgramAddress {
    assertByte(roleKind, "authority role kind");
    return deriveNamedProgramAddress("authority_transfer", [
        textSeed("authority-transfer"),
        new Uint8Array([roleKind]),
    ]);
}

export function deriveBasicFreezeRecordAddress(
    issuedTokenAccount: string | Uint8Array,
): NamedProgramAddress {
    return deriveNamedProgramAddress("basic_freeze_record", [
        textSeed("basic-freeze-record"),
        decodePublicKey(issuedTokenAccount),
    ]);
}

export function deriveCrossChainSignerSetAddress(
    signerSetId: string | Uint8Array,
): NamedProgramAddress {
    return deriveNamedProgramAddress("cross_chain_signer_set", [
        textSeed("cross-chain-signer-set"),
        bytes32FromInput(signerSetId, "signer set id"),
    ]);
}

export function deriveOutboundReclaimRecordAddress(
    remoteChainKind: number,
    remoteDomainId: bigint,
    sourceNonce: bigint,
): NamedProgramAddress {
    assertByte(remoteChainKind, "remote chain kind");
    return deriveNamedProgramAddress("outbound_reclaim_record", [
        textSeed("outbound-reclaim"),
        new Uint8Array([remoteChainKind]),
        unsigned64BigEndian(remoteDomainId, "remote domain id"),
        unsigned64BigEndian(sourceNonce, "source nonce"),
    ]);
}

export function derivePendingConfigChangeAddress(
    changeId: string | Uint8Array,
): NamedProgramAddress {
    return deriveNamedProgramAddress("pending_config_change", [
        textSeed("pending-config-change"),
        bytes32FromInput(changeId, "change id"),
    ]);
}

export function deriveRemoteDomainPolicyAddress(
    remoteChainKind: number,
    remoteDomainId: bigint,
): NamedProgramAddress {
    assertByte(remoteChainKind, "remote chain kind");
    return deriveNamedProgramAddress("remote_domain_policy", [
        textSeed("remote-domain-policy"),
        new Uint8Array([remoteChainKind]),
        unsigned64BigEndian(remoteDomainId, "remote domain id"),
    ]);
}

export function deriveRemoteNonceAddress(
    remoteChainKind: number,
    remoteDomainId: bigint,
    scopeKey: string | Uint8Array,
): NamedProgramAddress {
    assertByte(remoteChainKind, "remote chain kind");
    return deriveNamedProgramAddress("remote_nonce", [
        textSeed("remote-nonce"),
        new Uint8Array([remoteChainKind]),
        unsigned64BigEndian(remoteDomainId, "remote domain id"),
        bytes32FromInput(scopeKey, "remote nonce scope key"),
    ]);
}

export function deriveReserveDestinationAddress(
    assetMint: string | Uint8Array,
    destinationTokenAccount: string | Uint8Array,
): NamedProgramAddress {
    return deriveNamedProgramAddress("reserve_destination", [
        textSeed("reserve-destination"),
        decodePublicKey(assetMint),
        decodePublicKey(destinationTokenAccount),
    ]);
}

export function deriveSingletonAddress(name: string, seedText: string): NamedProgramAddress {
    return deriveNamedProgramAddress(name, [textSeed(seedText)]);
}

export function dimensionScopeHash(scopeKind: number, partyKey: string | Uint8Array): Uint8Array {
    assertByte(scopeKind, "dimension scope kind");
    return sha256(concatenate([new Uint8Array([scopeKind]), decodePublicKey(partyKey)]));
}

export function policyScopeHash(values: Readonly<Record<string, unknown>>): Uint8Array {
    return dimensionScopeHash(
        requireNumberField(values, "scope_kind"),
        requirePublicKeyField(values, "scope_key"),
    );
}

export function pathwayIsActive(values: Readonly<Record<string, unknown>>): boolean {
    const statusFlags = requireBigIntField(values, "status_flags");
    return (statusFlags & STATUS_FLAG.INITIALIZED) !== 0n && (statusFlags & STATUS_FLAG.PATHWAY_PAUSE) === 0n;
}

export function permissionObservation(
    values: Readonly<Record<string, unknown>>,
    requiredRole: bigint,
    expectedSubject: string | Uint8Array,
    expectedScopeKind: number,
    expectedScopeKey: string | Uint8Array,
    nowUnixTimestamp: bigint,
): PermissionObservation {
    const heldRoles = wordsToUnsigned128(requireBigIntArrayField(values, "role_bits", 2));
    const expiry = requireBigIntField(values, "expiry_unix_timestamp");
    const permissionFlags = requireBigIntField(values, "permission_flags");
    const subjectMatches = requirePublicKeyField(values, "subject") === normalizePublicKey(expectedSubject);
    const scopeMatches = requireNumberField(values, "scope_kind") === expectedScopeKind
        && requirePublicKeyField(values, "scope_key") === normalizePublicKey(expectedScopeKey);
    const roleSchemaMatches = requireNumberField(values, "role_schema_version") === 1;
    const paused = (permissionFlags & PERMISSION_FLAG.PAUSED) !== 0n;
    const expired = expiry !== 0n && nowUnixTimestamp >= expiry;
    const hasRequiredRole = (heldRoles & requiredRole) === requiredRole;
    return {
        requiredRole,
        heldRoles,
        hasRequiredRole,
        subjectMatches,
        scopeMatches,
        roleSchemaMatches,
        paused,
        expired,
        usable: hasRequiredRole && subjectMatches && scopeMatches && roleSchemaMatches && !paused && !expired,
    };
}

export function observeSettlementPolicy(
    values: Readonly<Record<string, unknown>>,
    mode: SettlementMode,
    assetMint: string | Uint8Array,
    principalA: string | Uint8Array,
    principalB: string | Uint8Array,
    executor: string | Uint8Array,
    inputNotional: bigint,
    nowUnixTimestamp: bigint,
    expectedAddress: string | Uint8Array,
    expectedBump: number,
): SettlementPolicyObservation {
    const policyId = requireBytes(values.policy_id, "settlement policy id", 32);
    const derivedAddress = deriveSettlementPolicyAddress(policyId);
    const identityMatches = derivedAddress.address === normalizePublicKey(expectedAddress);
    const bumpMatches = requireNumberField(values, "bump") === expectedBump;
    const policyIdNonzero = !isZeroBytes32(policyId, "settlement policy id");
    const policyFlagsValid = requireBigIntField(values, "policy_flags") === 0n;
    const allowedSettlementModes = requireNumberField(values, "allowed_settlement_modes") >>> 0;
    const knownModeMask = (1 << SETTLEMENT_MODE_VALUE.delegated) | (1 << SETTLEMENT_MODE_VALUE.trilateral);
    const modeMaskValid = allowedSettlementModes !== 0 && (allowedSettlementModes & ~knownModeMask) === 0;
    const modeValue = SETTLEMENT_MODE_VALUE[mode];
    const modeAllowed = mode !== "direct" && (allowedSettlementModes & (1 << modeValue)) !== 0;
    const normalizedAssetMint = normalizePublicKey(assetMint);
    const normalizedPrincipalA = normalizePublicKey(principalA);
    const normalizedPrincipalB = normalizePublicKey(principalB);
    const normalizedExecutor = normalizePublicKey(executor);
    const allowedAssetMint = requirePublicKeyField(values, "allowed_asset_mint");
    const allowedPrincipalA = requirePublicKeyField(values, "allowed_principal_a");
    const allowedPrincipalB = requirePublicKeyField(values, "allowed_principal_b");
    const designatedExecutor = requirePublicKeyField(values, "designated_executor");
    const assetAllowed = allowedAssetMint === ZERO_ADDRESS || allowedAssetMint === normalizedAssetMint;
    const principalAAllowed = allowedPrincipalA === ZERO_ADDRESS || allowedPrincipalA === normalizedPrincipalA;
    const principalBAllowed = allowedPrincipalB === ZERO_ADDRESS || allowedPrincipalB === normalizedPrincipalB;
    const executorAllowed = designatedExecutor === ZERO_ADDRESS || designatedExecutor === normalizedExecutor;
    const minimumNotional = requireBigIntField(values, "min_notional");
    const maximumNotional = requireBigIntField(values, "max_notional");
    const notionalRangeValid = maximumNotional === 0n || minimumNotional <= maximumNotional;
    const notionalAllowed = inputNotional >= minimumNotional
        && (maximumNotional === 0n || inputNotional <= maximumNotional);
    const validAfterUnixTimestamp = requireBigIntField(values, "valid_after_unix_timestamp");
    const expiresAtUnixTimestamp = requireBigIntField(values, "expires_at_unix_timestamp");
    const timestampRangeValid = expiresAtUnixTimestamp === 0n
        || validAfterUnixTimestamp < expiresAtUnixTimestamp;
    const temporallyEffective = (validAfterUnixTimestamp === 0n || nowUnixTimestamp >= validAfterUnixTimestamp)
        && (expiresAtUnixTimestamp === 0n || nowUnixTimestamp < expiresAtUnixTimestamp);
    const observations: string[] = [];
    if (!identityMatches) {
        observations.push("Settlement policy identity does not resolve to the supplied policy PDA");
    }
    if (!bumpMatches) {
        observations.push("Settlement policy stored bump does not match the canonical PDA bump");
    }
    if (!policyIdNonzero) {
        observations.push("Settlement policy id is zero");
    }
    if (!policyFlagsValid) {
        observations.push("Settlement policy contains unsupported policy flags");
    }
    if (!modeMaskValid) {
        observations.push("Settlement policy mode mask is empty or contains unsupported settlement modes");
    }
    if (!modeAllowed) {
        observations.push(`Settlement policy does not permit ${mode} settlement`);
    }
    if (!assetAllowed) {
        observations.push("Settlement policy does not permit the requested asset mint");
    }
    if (!principalAAllowed) {
        observations.push("Settlement policy does not permit principal A");
    }
    if (!principalBAllowed) {
        observations.push("Settlement policy does not permit principal B");
    }
    if (!executorAllowed) {
        observations.push("Settlement policy does not permit the selected executor");
    }
    if (!notionalRangeValid) {
        observations.push("Settlement policy minimum notional exceeds its maximum notional");
    }
    if (!notionalAllowed) {
        observations.push("Settlement input notional is outside the settlement policy range");
    }
    if (!timestampRangeValid) {
        observations.push("Settlement policy activation timestamp is not earlier than its expiry timestamp");
    }
    if (!temporallyEffective) {
        observations.push("Settlement policy is not effective at the supplied timestamp");
    }
    const usable = identityMatches
        && bumpMatches
        && policyIdNonzero
        && policyFlagsValid
        && modeMaskValid
        && modeAllowed
        && assetAllowed
        && principalAAllowed
        && principalBAllowed
        && executorAllowed
        && notionalRangeValid
        && notionalAllowed
        && timestampRangeValid
        && temporallyEffective;
    return {
        identityMatches,
        bumpMatches,
        policyIdNonzero,
        policyFlagsValid,
        allowedSettlementModes,
        modeMaskValid,
        modeAllowed,
        assetAllowed,
        principalAAllowed,
        principalBAllowed,
        executorAllowed,
        minimumNotional,
        maximumNotional,
        notionalAllowed,
        validAfterUnixTimestamp,
        expiresAtUnixTimestamp,
        timestampRangeValid,
        temporallyEffective,
        usable,
        observations,
    };
}

export function computeSettlementGrossOutput(
    action: SettlementAction,
    inputAmount: bigint,
    assetConfigValues: Readonly<Record<string, unknown>>,
): bigint {
    if (inputAmount < 0n) {
        throw new Error("Settlement input amount must be non-negative");
    }
    const rate = action === "mint"
        ? requireBigIntField(assetConfigValues, "deposit_rate_e9")
        : requireBigIntField(assetConfigValues, "redeem_rate_e9");
    return inputAmount * rate / RATE_PRECISION_E9;
}

export function computeFeeQuote(
    action: SettlementAction,
    grossInput: bigint,
    grossOutput: bigint,
    feePolicyValues: Readonly<Record<string, unknown>> | null,
    nowUnixTimestamp: bigint,
): FeeQuote {
    if (feePolicyValues === null) {
        return {
            grossInput,
            grossOutput,
            denomination: action === "mint" ? "issued_token" : "asset",
            assessedFee: 0n,
            nominalRebate: 0n,
            effectiveRebate: 0n,
            netFee: 0n,
            netOutput: grossOutput,
            routed: false,
            feeRecipientOwner: ZERO_ADDRESS,
            effective: true,
            observations: [],
        };
    }

    const observations: string[] = [];
    const flags = requireBigIntField(feePolicyValues, "fee_policy_flags");
    const inAsset = (flags & FEE_FLAG.FEE_IN_ASSET) !== 0n;
    const inIssuedToken = (flags & FEE_FLAG.FEE_IN_ISSUED_TOKEN) !== 0n;
    const denomination = inAsset === inIssuedToken ? "invalid" : inAsset ? "asset" : "issued_token";
    const expectedDenomination = action === "mint" ? "issued_token" : "asset";
    if (denomination !== expectedDenomination) {
        observations.push(`Fee denomination ${denomination} does not match ${action} output denomination ${expectedDenomination}`);
    }
    if ((flags & FEE_FLAG.PERCENT_ON_INPUT) !== 0n) {
        observations.push("Percent-on-input is not supported by the settlement runtime");
    }
    const effectiveFrom = requireBigIntField(feePolicyValues, "effective_from_unix_timestamp");
    const effectiveUntil = requireBigIntField(feePolicyValues, "effective_until_unix_timestamp");
    const active = (flags & FEE_FLAG.ACTIVE) !== 0n;
    const effective = active
        && (effectiveFrom === 0n || nowUnixTimestamp >= effectiveFrom)
        && (effectiveUntil === 0n || nowUnixTimestamp < effectiveUntil);
    if (!effective) {
        observations.push("Fee policy is not effective at the supplied timestamp");
    }

    const flatFee = action === "mint"
        ? requireBigIntField(feePolicyValues, "flat_fee_in_issued_token")
        : requireBigIntField(feePolicyValues, "flat_fee_in_asset");
    const percentFeeBasisPoints = BigInt(requireNumberField(feePolicyValues, "percent_fee_bps"));
    let rawFee = 0n;
    if (flatFee !== 0n) {
        rawFee = flatFee;
    } else if (percentFeeBasisPoints !== 0n) {
        rawFee = roundedBasisPoints(
            grossOutput,
            percentFeeBasisPoints,
            requireNumberField(feePolicyValues, "rounding_mode"),
        );
    }
    const feeCap = requireBigIntField(feePolicyValues, "fee_cap_amount");
    const minimumFee = requireBigIntField(feePolicyValues, "minimum_fee_amount");
    const cappedFee = feeCap === 0n || rawFee <= feeCap ? rawFee : feeCap;
    const assessedFee = cappedFee >= minimumFee ? cappedFee : minimumFee;

    const flatRebate = requireBigIntField(feePolicyValues, "rebate_flat_amount");
    const rebateBasisPoints = BigInt(requireNumberField(feePolicyValues, "rebate_bps"));
    let rawRebate = 0n;
    if (flatRebate !== 0n) {
        rawRebate = flatRebate;
    } else if (rebateBasisPoints !== 0n) {
        rawRebate = assessedFee * rebateBasisPoints / 10_000n;
    }
    const rebateCap = requireBigIntField(feePolicyValues, "rebate_cap_amount");
    const nominalRebate = rebateCap === 0n || rawRebate <= rebateCap ? rawRebate : rebateCap;
    const floorZero = requireNumberField(feePolicyValues, "net_fee_floor_zero") !== 0;
    if (!floorZero && nominalRebate > assessedFee) {
        observations.push("Configured rebate exceeds assessed fee while zero-flooring is disabled");
    }
    const effectiveRebate = floorZero && nominalRebate > assessedFee ? assessedFee : nominalRebate;
    const netFee = effectiveRebate > assessedFee ? 0n : assessedFee - effectiveRebate;
    const netOutput = grossOutput >= netFee ? grossOutput - netFee : 0n;
    if (netOutput === 0n) {
        observations.push("Net settlement output is zero");
    }

    const recipientPolicy = requireNumberField(feePolicyValues, "fee_recipient_policy");
    const routed = netFee > 0n
        && recipientPolicy !== FEE_RECIPIENT.NONE
        && recipientPolicy !== FEE_RECIPIENT.RESERVE_RETENTION;
    return {
        grossInput,
        grossOutput,
        denomination,
        assessedFee,
        nominalRebate,
        effectiveRebate,
        netFee,
        netOutput,
        routed,
        feeRecipientOwner: requirePublicKeyField(feePolicyValues, "fee_recipient_key"),
        effective,
        observations,
    };
}

export function observeLimitPolicy(
    policyValues: Readonly<Record<string, unknown>>,
    action: SettlementAction,
    proposedAmount: bigint,
    windows: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>,
    nowUnixTimestamp: bigint,
): LimitObservation {
    if (proposedAmount < 0n) {
        throw new Error("Proposed limit amount must be non-negative");
    }
    const accumulatorField = action === "mint" ? "gross_in" : "gross_output_amount";
    const perTransactionMaximum = requireBigIntField(policyValues, "per_transaction_maximum");
    const perTransactionRemainingBefore = perTransactionMaximum === 0n ? null : perTransactionMaximum;
    const perTransactionRemainingAfter = perTransactionMaximum === 0n
        ? null
        : maximumBigInt(perTransactionMaximum - proposedAmount, 0n);
    const perTransactionAllowed = perTransactionMaximum === 0n || proposedAmount <= perTransactionMaximum;
    const definitions: readonly [
        "hourly" | "daily" | "weekly" | "monthly",
        number,
        string,
        string,
    ][] = [
        ["hourly", WINDOW_KIND.HOURLY, "per_hour_maximum", "maximum_actions_per_hour"],
        ["daily", WINDOW_KIND.DAILY, "per_day_maximum", "maximum_actions_per_day"],
        ["weekly", WINDOW_KIND.WEEKLY, "per_seven_day_maximum", ""],
        ["monthly", WINDOW_KIND.MONTHLY, "per_thirty_day_maximum", ""],
    ];
    const observations: LimitWindowObservation[] = [];
    for (let index = 0, length = definitions.length; index < length; index++) {
        const definition = definitions[index];
        if (definition === undefined) {
            continue;
        }
        const [name, windowKind, maximumField, actionsField] = definition;
        const maximum = requireBigIntField(policyValues, maximumField);
        const maximumActionCount = actionsField === "" ? 0 : requireNumberField(policyValues, actionsField);
        const windowValues = windows[name] ?? null;
        const canonicalStart = canonicalWindowStart(windowKind, nowUnixTimestamp);
        const storedStart = windowValues === null
            ? null
            : requireBigIntField(windowValues, "window_start_unix_timestamp");
        const clockRegression = storedStart !== null && storedStart > canonicalStart;
        const useStoredCounters = storedStart !== null && storedStart === canonicalStart;
        const currentAmount = useStoredCounters && windowValues !== null
            ? wordsToUnsigned128(requireBigIntArrayField(windowValues, accumulatorField, 2))
            : 0n;
        const currentActionCount = useStoredCounters && windowValues !== null
            ? requireNumberField(windowValues, "action_count")
            : 0;
        const projectedAmount = currentAmount + proposedAmount;
        const projectedActionCount = currentActionCount + 1;
        const remainingBefore = maximum === 0n ? null : maximumBigInt(maximum - currentAmount, 0n);
        const remainingAfter = maximum === 0n ? null : maximumBigInt(maximum - projectedAmount, 0n);
        const actionRemainingBefore = maximumActionCount === 0
            ? null
            : Math.max(maximumActionCount - currentActionCount, 0);
        const actionRemainingAfter = maximumActionCount === 0
            ? null
            : Math.max(maximumActionCount - projectedActionCount, 0);
        observations.push({
            name,
            windowKind,
            maximum,
            accumulatorField,
            storedWindowStartUnixTimestamp: storedStart,
            canonicalWindowStartUnixTimestamp: canonicalStart,
            rolledBeforeCheck: storedStart !== null && storedStart < canonicalStart,
            clockRegression,
            currentAmount,
            proposedAmount,
            projectedAmount,
            remainingBefore,
            remainingAfter,
            allowed: !clockRegression && (maximum === 0n || projectedAmount <= maximum),
            currentActionCount,
            projectedActionCount,
            maximumActionCount,
            actionRemainingBefore,
            actionRemainingAfter,
            actionAllowed: !clockRegression
                && (maximumActionCount === 0 || projectedActionCount <= maximumActionCount),
        });
    }
    return {
        action,
        accumulatorField,
        perTransactionMaximum,
        proposedAmount,
        perTransactionRemainingBefore,
        perTransactionRemainingAfter,
        perTransactionAllowed,
        windows: observations,
    };
}

export function canonicalWindowStart(windowKind: number, unixTimestamp: bigint): bigint {
    let periodSeconds: bigint;
    if (windowKind === WINDOW_KIND.HOURLY) {
        periodSeconds = 3_600n;
    } else if (windowKind === WINDOW_KIND.DAILY) {
        periodSeconds = 86_400n;
    } else if (windowKind === WINDOW_KIND.WEEKLY) {
        periodSeconds = 604_800n;
    } else if (windowKind === WINDOW_KIND.MONTHLY) {
        periodSeconds = 2_592_000n;
    } else {
        throw new Error(`Unknown usage-window kind: ${windowKind}`);
    }
    return floorDivision(unixTimestamp, periodSeconds) * periodSeconds;
}

function floorDivision(numerator: bigint, denominator: bigint): bigint {
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder !== 0n && ((remainder > 0n) !== (denominator > 0n))) {
        quotient--;
    }
    return quotient;
}

function maximumBigInt(left: bigint, right: bigint): bigint {
    return left >= right ? left : right;
}

export function requireBytes(value: unknown, label: string, expectedLength?: number): Uint8Array {
    if (!(value instanceof Uint8Array)) {
        throw new Error(`${label} must be bytes`);
    }
    if (expectedLength !== undefined && value.length !== expectedLength) {
        throw new Error(`${label} must contain ${expectedLength} bytes`);
    }
    return new Uint8Array(value);
}

export function requireBigIntField(values: Readonly<Record<string, unknown>>, fieldName: string): bigint {
    const value = values[fieldName];
    if (typeof value !== "bigint") {
        throw new Error(`${fieldName} must be a bigint`);
    }
    return value;
}

export function requireNumberField(values: Readonly<Record<string, unknown>>, fieldName: string): number {
    const value = values[fieldName];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new Error(`${fieldName} must be a safe integer`);
    }
    return value;
}

export function requirePublicKeyField(values: Readonly<Record<string, unknown>>, fieldName: string): string {
    const value = values[fieldName];
    if (typeof value !== "string") {
        throw new Error(`${fieldName} must be a public key string`);
    }
    return normalizePublicKey(value);
}

export function requireBigIntArrayField(
    values: Readonly<Record<string, unknown>>,
    fieldName: string,
    expectedLength: number,
): readonly bigint[] {
    const value = values[fieldName];
    if (!Array.isArray(value) || value.length !== expectedLength) {
        throw new Error(`${fieldName} must contain ${expectedLength} integers`);
    }
    const result: bigint[] = [];
    for (let index = 0; index < expectedLength; index++) {
        const item = value[index];
        if (typeof item !== "bigint") {
            throw new Error(`${fieldName}[${index}] must be a bigint`);
        }
        result.push(item);
    }
    return result;
}

export function wordsToUnsigned128(words: readonly bigint[]): bigint {
    if (words.length !== 2) {
        throw new Error("Unsigned 128-bit word array must contain two words");
    }
    return (words[0] ?? 0n) | ((words[1] ?? 0n) << 64n);
}

export function knownPdaAddress(name: string): string {
    const knownPda = CHANCERY_SCHEMA.known_pdas[name];
    if (knownPda === undefined) {
        throw new Error(`Unknown Chancery singleton PDA: ${name}`);
    }
    return knownPda.address;
}

export function publicKeyFromBytes32(value: unknown, label: string): string {
    return encodeBase58(requireBytes(value, label, 32));
}

export function sha256(bytes: Uint8Array): Uint8Array {
    const digest = createHash("sha256").update(bytes).digest();
    return new Uint8Array(digest);
}

function textSeed(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
    let totalLength = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        totalLength += parts[index]?.length ?? 0;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (let index = 0, length = parts.length; index < length; index++) {
        const part = parts[index];
        if (part !== undefined) {
            result.set(part, offset);
            offset += part.length;
        }
    }
    return result;
}

function decodeHex(hexadecimal: string, label: string): Uint8Array {
    if (hexadecimal.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexadecimal)) {
        throw new Error(`${label} hexadecimal encoding is invalid`);
    }
    const bytes = new Uint8Array(hexadecimal.length / 2);
    for (let index = 0, length = bytes.length; index < length; index++) {
        bytes[index] = Number.parseInt(hexadecimal.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

function assertByte(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`${label} must be an unsigned byte`);
    }
}

function unsigned64BigEndian(value: bigint, label: string): Uint8Array {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
        throw new Error(`${label} must be an unsigned 64-bit integer`);
    }
    const bytes = new Uint8Array(8);
    let remaining = value;
    for (let index = 7; index >= 0; index--) {
        bytes[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}

function roundedBasisPoints(amount: bigint, basisPoints: bigint, roundingMode: number): bigint {
    const product = amount * basisPoints;
    const quotient = product / 10_000n;
    const remainder = product % 10_000n;
    if (roundingMode === ROUNDING.FLOOR) {
        return quotient;
    }
    if (roundingMode === ROUNDING.CEILING) {
        return quotient + (remainder === 0n ? 0n : 1n);
    }
    if (roundingMode === ROUNDING.NEAREST) {
        return quotient + (remainder >= 5_000n ? 1n : 0n);
    }
    throw new Error(`Unsupported fee rounding mode: ${roundingMode}`);
}
