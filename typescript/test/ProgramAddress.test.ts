import assert from "node:assert/strict";
import test from "node:test";

import {
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    createProgramAddress,
    decodeBase58,
    encodeBase58,
    findProgramAddress,
} from "../src/index.js";

test("base58 preserves public-key byte sequences", () => {
    const vectors = [
        new Uint8Array(32),
        new Uint8Array(Array.from({ length: 32 }, (_value, index) => index)),
        new Uint8Array(Array.from({ length: 32 }, (_value, index) => 255 - index)),
    ];
    for (let index = 0, length = vectors.length; index < length; index++) {
        const vector = vectors[index];
        if (vector !== undefined) {
            assert.deepEqual(decodeBase58(encodeBase58(vector)), vector);
        }
    }
});

test("known Chancery program addresses reproduce their published addresses and bumps", () => {
    const knownPdaNames = Object.keys(CHANCERY_SCHEMA.known_pdas);
    for (let index = 0, length = knownPdaNames.length; index < length; index++) {
        const knownPdaName = knownPdaNames[index];
        if (knownPdaName === undefined) {
            continue;
        }
        const knownPda = CHANCERY_SCHEMA.known_pdas[knownPdaName];
        assert.ok(knownPda !== undefined);
        const result = findProgramAddress(
            knownPda.seeds.map((seed) => new Uint8Array(seed)),
            CHANCERY_PROGRAM_ADDRESS,
        );
        assert.equal(result.address, knownPda.address, knownPdaName);
        assert.equal(
            createProgramAddress(
                [...knownPda.seeds.map((seed) => new Uint8Array(seed)), new Uint8Array([result.bump])],
                CHANCERY_PROGRAM_ADDRESS,
            ),
            knownPda.address,
            knownPdaName,
        );
    }
});

test("program-address seed limits are enforced", () => {
    assert.throws(
        () => findProgramAddress([new Uint8Array(33)]),
        /exceeds 32 bytes/,
    );
    assert.throws(
        () => findProgramAddress(Array.from({ length: 16 }, () => new Uint8Array(1))),
        /at most 15 seeds/,
    );
});
