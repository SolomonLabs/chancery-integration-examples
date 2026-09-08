import {
    RATE_PRECISION_E9,
    requireNumberField,
    requirePublicKeyField,
    type ChanceryStateDiscovery,
} from "../../../typescript/src/index.js";

const ASSET_MODE_ACTIVE = 0;
const ASSET_MODE_WIND_DOWN = 1;
const ASSET_MODE_FROZEN = 2;
const BASIS_POINTS_DENOMINATOR = 10_000n;

export interface OracleAssetRate {
    readonly assetMint: string;
    readonly assetTokenProgram: string;
    readonly mode: "active" | "wind_down" | "frozen" | "unknown";
    readonly modeValue: number;
    readonly depositRateE9: bigint;
    readonly redeemRateE9: bigint;
    readonly depositRate: string;
    readonly redeemRate: string;
}

export interface OracleFeeSummary {
    readonly globalFeePolicy: null;
    readonly pathwayScopedFeesPresent: boolean;
}

export interface OracleSnapshot {
    readonly programAddress: string;
    readonly commitment: ChanceryStateDiscovery["commitment"];
    readonly issuedTokenMint: string | null;
    readonly assets: readonly OracleAssetRate[];
    readonly fees: OracleFeeSummary;
}

export function formatRateE9(rateE9: bigint): string {
    if (rateE9 < 0n) {
        throw new Error("Rate must be non-negative");
    }
    const integer = rateE9 / RATE_PRECISION_E9;
    const fraction = rateE9 % RATE_PRECISION_E9;
    return `${integer}.${fraction.toString().padStart(9, "0")}`;
}

export function isRateWithinBasisPointsOfOne(
    rateE9: bigint,
    toleranceBasisPoints: bigint,
): boolean {
    if (rateE9 < 0n) {
        throw new Error("Rate must be non-negative");
    }
    if (toleranceBasisPoints < 0n) {
        throw new Error("Tolerance must be non-negative");
    }
    const difference = rateE9 >= RATE_PRECISION_E9
        ? rateE9 - RATE_PRECISION_E9
        : RATE_PRECISION_E9 - rateE9;
    return difference * BASIS_POINTS_DENOMINATOR
        <= RATE_PRECISION_E9 * toleranceBasisPoints;
}

export function buildOracleSnapshot(discovery: ChanceryStateDiscovery): OracleSnapshot {
    const issuedTokenMint = discovery.chanceryConfig === null
        ? null
        : requirePublicKeyField(discovery.chanceryConfig.values, "issued_token_mint");
    return {
        programAddress: discovery.programAddress,
        commitment: discovery.commitment,
        issuedTokenMint,
        assets: discovery.assets.map((asset) => {
            const modeValue = requireNumberField(asset.assetConfig.values, "mode");
            return {
                assetMint: asset.assetMint,
                assetTokenProgram: asset.assetTokenProgram,
                mode: assetModeName(modeValue),
                modeValue,
                depositRateE9: asset.depositRateE9,
                redeemRateE9: asset.redeemRateE9,
                depositRate: formatRateE9(asset.depositRateE9),
                redeemRate: formatRateE9(asset.redeemRateE9),
            };
        }),
        fees: {
            globalFeePolicy: null,
            pathwayScopedFeesPresent: discovery.pathways.some(
                (pathway) => pathway.feePolicy !== null,
            ),
        },
    };
}

function assetModeName(modeValue: number): OracleAssetRate["mode"] {
    switch (modeValue) {
        case ASSET_MODE_ACTIVE:
            return "active";
        case ASSET_MODE_WIND_DOWN:
            return "wind_down";
        case ASSET_MODE_FROZEN:
            return "frozen";
        default:
            return "unknown";
    }
}