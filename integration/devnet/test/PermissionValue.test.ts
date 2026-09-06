import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeBase58 } from "../../../typescript/src/Base58Codec.js";
import { permissionChangeId, permissionValueHash, permissionValuePayload, type PermissionValue } from "../permissions/Value.js";

const subjectBytes = Buffer.alloc(32, 1);
const scopeBytes = Buffer.alloc(32, 2);
const targetBytes = Buffer.alloc(32, 3);
const proposerBytes = Buffer.alloc(32, 4);
const value: PermissionValue = {
    subject: encodeBase58(subjectBytes), scopeKind: 2, scopeKey: encodeBase58(scopeBytes),
    roleBits: (5n << 64n) | 7n, permissionGeneration: 9n, expiryUnixTimestamp: 123456789n,
};

test("permission values use the program's 97-byte semantic payload", () => {
    const payload = Buffer.from(permissionValuePayload(value));
    assert.equal(payload.length, 97);
    assert.deepEqual(payload.subarray(0, 32), subjectBytes);
    assert.equal(payload[32], 2);
    assert.deepEqual(payload.subarray(33, 65), scopeBytes);
    assert.equal(payload.readBigUInt64LE(65), 7n);
    assert.equal(payload.readBigUInt64LE(73), 5n);
    assert.equal(payload.readBigUInt64LE(81), 9n);
    assert.equal(payload.readBigInt64LE(89), 123456789n);
});

test("permission hashes bind kind, target, risk, and canonical semantic fields", () => {
    const expected = createHash("sha256").update(Buffer.concat([
        Buffer.from("chancery:pending-config-change:v1"), Buffer.from([0, 5]), targetBytes,
        Buffer.from([2]), Buffer.from(permissionValuePayload(value)),
    ])).digest();
    const hash = permissionValueHash(encodeBase58(targetBytes), 2, value);
    assert.deepEqual(Buffer.from(hash), expected);
    assert.notDeepEqual(hash, permissionValueHash(encodeBase58(targetBytes), 4, value));
    assert.notDeepEqual(hash, permissionValueHash(encodeBase58(targetBytes), 2, { ...value, permissionGeneration: 10n }));
});

test("permission proposal identity encodes the proposer nonce as big endian", () => {
    const hash = permissionValueHash(encodeBase58(targetBytes), 2, value);
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64BE(0x0102030405060708n);
    const expected = createHash("sha256").update(Buffer.concat([
        Buffer.from("chancery:pending-config-change-id:v1"), Buffer.from([0, 5]), targetBytes,
        Buffer.from(hash), proposerBytes, nonce,
    ])).digest();
    assert.deepEqual(Buffer.from(permissionChangeId(encodeBase58(targetBytes), hash, encodeBase58(proposerBytes), 0x0102030405060708n)), expected);
    assert.throws(() => permissionChangeId(encodeBase58(targetBytes), new Uint8Array(31), encodeBase58(proposerBytes), 1n), /32 bytes/);
});

test("permission payload bounds retain u128 roles, u64 generation, and i64 expiry", () => {
    assert.throws(() => permissionValuePayload({ ...value, roleBits: 1n << 128n }), /u128/);
    assert.throws(() => permissionValuePayload({ ...value, roleBits: -1n }), /u128/);
    assert.throws(() => permissionValuePayload({ ...value, permissionGeneration: 1n << 64n }));
    assert.throws(() => permissionValuePayload({ ...value, expiryUnixTimestamp: 1n << 63n }));
});
