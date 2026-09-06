import assert from "node:assert/strict";
import test from "node:test";
import { CHANCERY_SCHEMA } from "../../../typescript/src/ChancerySchema.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS, CHANCERY_MAINNET_PROGRAM_ADDRESS, chanceryProgramAddressForTarget } from "../../../typescript/src/ChanceryTarget.js";
import { findProgramAddress } from "../../../typescript/src/ProgramAddress.js";
import { requireDevnetTarget, testAssetForSymbol, TEST_ASSETS } from "../configuration/Deployment.js";
import { directPathwayId } from "../pathway/DirectPathway.js";

test("target selection preserves mainnet as the default and rejects unknown names", () => {
    assert.equal(chanceryProgramAddressForTarget(), CHANCERY_MAINNET_PROGRAM_ADDRESS);
    assert.equal(chanceryProgramAddressForTarget("mainnet"), CHANCERY_MAINNET_PROGRAM_ADDRESS);
    assert.equal(chanceryProgramAddressForTarget("devnet"), CHANCERY_DEVNET_PROGRAM_ADDRESS);
    for (const name of ["", "DEVNET", "localnet", "mainnet-beta"]) {
        assert.throws(() => chanceryProgramAddressForTarget(name), /mainnet or devnet/);
    }
});

test("devnet schema resolves every singleton from its declared seeds", () => {
    requireDevnetTarget();
    assert.equal(CHANCERY_SCHEMA.program.address, CHANCERY_DEVNET_PROGRAM_ADDRESS);
    for (const pda of Object.values(CHANCERY_SCHEMA.known_pdas)) {
        const seeds = pda.seeds.map((seed) => new Uint8Array(seed));
        assert.equal(pda.address, findProgramAddress(seeds, CHANCERY_DEVNET_PROGRAM_ADDRESS).address);
        assert.notEqual(pda.address, findProgramAddress(seeds, CHANCERY_MAINNET_PROGRAM_ADDRESS).address);
    }
});

test("devnet helpers require explicit devnet process selection", () => {
    const original = process.env.CHANCERY_TARGET;
    try {
        delete process.env.CHANCERY_TARGET;
        assert.throws(requireDevnetTarget, /CHANCERY_TARGET=devnet/);
        process.env.CHANCERY_TARGET = "mainnet";
        assert.throws(requireDevnetTarget, /CHANCERY_TARGET=devnet/);
    } finally {
        if (original === undefined) delete process.env.CHANCERY_TARGET;
        else process.env.CHANCERY_TARGET = original;
    }
});

test("test assets and default pathways preserve explicit deployment identities", () => {
    const asset = testAssetForSymbol("USDC");
    assert.equal(TEST_ASSETS.length, 4);
    assert.throws(() => testAssetForSymbol("SOL"), /USDC, USDT, USDG, or PYUSD/);
    const first = directPathwayId(asset.mint, CHANCERY_DEVNET_PROGRAM_ADDRESS);
    assert.deepEqual(first, directPathwayId(asset.mint, CHANCERY_DEVNET_PROGRAM_ADDRESS));
    assert.notDeepEqual(first, directPathwayId(asset.mint, CHANCERY_MAINNET_PROGRAM_ADDRESS));
    assert.deepEqual(Buffer.from(directPathwayId(asset.mint, CHANCERY_MAINNET_PROGRAM_ADDRESS, Buffer.from(first).toString("hex"))), Buffer.from(first));
    assert.throws(() => directPathwayId(asset.mint, CHANCERY_DEVNET_PROGRAM_ADDRESS, "00".repeat(32)), /nonzero/);
});
