import assert from "node:assert/strict";
import test from "node:test";

import type {
    ChanceryAssetInventory,
    ChanceryPathwayInventory,
    ChanceryStateDiscovery,
    DiscoveredChanceryAccount,
} from "../../../typescript/src/index.js";
import {
    buildOracleSnapshot,
    formatRateE9,
    isRateWithinBasisPointsOfOne,
} from "../src/OracleSnapshot.js";

const SYSTEM_ADDRESS = "11111111111111111111111111111111";
const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function account(
    name: string,
    values: Readonly<Record<string, unknown>>,
): DiscoveredChanceryAccount {
    return {
        address: SYSTEM_ADDRESS,
        name,
        values,
        owner: SYSTEM_ADDRESS,
        lamports: 0n,
        dataLength: 0,
        canonicalPda: null,
    };
}

function fixtureDiscovery(): ChanceryStateDiscovery {
    const assetConfig = account("AssetConfig", {
        asset_mint: SYSTEM_ADDRESS,
        asset_token_program: TOKEN_PROGRAM_ADDRESS,
        deposit_rate_e9: 1_000_500_000n,
        redeem_rate_e9: 999_500_000n,
        mode: 0,
    });
    const feePolicy = account("FeePolicy", {});
    const pathway: ChanceryPathwayInventory = {
        address: SYSTEM_ADDRESS,
        pathwayId: "0x00",
        pathwayKind: 0,
        assetMint: SYSTEM_ADDRESS,
        issuedTokenMint: SYSTEM_ADDRESS,
        designatedExecutor: SYSTEM_ADDRESS,
        statusFlags: 0n,
        feePolicy,
        pathwayLimitPolicy: null,
        assetMintLimitPolicy: null,
        assetRedeemLimitPolicy: null,
        counterpartyLimitPolicy: null,
        executorLimitPolicy: null,
        evidencePolicy: null,
        reserveDestinations: [],
    };
    const asset: ChanceryAssetInventory = {
        assetConfig,
        assetPauseState: null,
        assetMint: SYSTEM_ADDRESS,
        assetTokenProgram: TOKEN_PROGRAM_ADDRESS,
        depositRateE9: 1_000_500_000n,
        redeemRateE9: 999_500_000n,
        pathways: [pathway],
        reserveDestinations: [],
    };
    return {
        programAddress: SYSTEM_ADDRESS,
        commitment: "confirmed",
        accountCount: 3,
        recognizedAccounts: [assetConfig, feePolicy],
        accountsByType: {
            AssetConfig: [assetConfig],
            FeePolicy: [feePolicy],
        },
        unrecognizedAccounts: [],
        knownPdas: [],
        chanceryConfig: account("ChanceryConfig", {
            issued_token_mint: SYSTEM_ADDRESS,
        }),
        issuedTokenControl: null,
        assets: [asset],
        pathways: [pathway],
        settlementLimitModel: {
            volumeScopes: ["pathway", "asset", "counterparty", "executor"],
            globalSettlementVolumeAccumulatorExists: false,
            globalPauseAccount: SYSTEM_ADDRESS,
        },
    };
}

test("formats e9 rates without floating-point conversion", () => {
    assert.equal(formatRateE9(1_000_500_000n), "1.000500000");
    assert.equal(formatRateE9(999_500_000n), "0.999500000");
});

test("checks a caller-selected basis-point tolerance exactly", () => {
    assert.equal(isRateWithinBasisPointsOfOne(1_000_500_000n, 5n), true);
    assert.equal(isRateWithinBasisPointsOfOne(1_000_500_001n, 5n), false);
});

test("builds the focused oracle snapshot without treating pathway fees as global", () => {
    const snapshot = buildOracleSnapshot(fixtureDiscovery());
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0]?.mode, "active");
    assert.equal(snapshot.assets[0]?.depositRate, "1.000500000");
    assert.equal(snapshot.assets[0]?.redeemRate, "0.999500000");
    assert.equal(snapshot.fees.globalFeePolicy, null);
    assert.equal(snapshot.fees.pathwayScopedFeesPresent, true);
});