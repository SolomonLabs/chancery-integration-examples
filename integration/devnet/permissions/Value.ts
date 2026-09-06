import { createHash } from "node:crypto";
import { decodePublicKey } from "../../../typescript/src/Base58Codec.js";
import { encodeType } from "../../../typescript/src/BinaryCodec.js";

export interface PermissionValue {
    readonly subject: string;
    readonly scopeKind: number;
    readonly scopeKey: string;
    readonly roleBits: bigint;
    readonly permissionGeneration: bigint;
    readonly expiryUnixTimestamp: bigint;
}

export function permissionValuePayload(value: PermissionValue): Uint8Array {
    if (value.roleBits < 0n || value.roleBits >= 1n << 128n) throw new Error("Permission roles must fit u128");
    return Uint8Array.from([
        ...decodePublicKey(value.subject), ...encodeType("u8", value.scopeKind, "scopeKind"), ...decodePublicKey(value.scopeKey),
        ...encodeType("u128", value.roleBits, "roleBits"), ...encodeType("u64", value.permissionGeneration, "permissionGeneration"),
        ...encodeType("i64", value.expiryUnixTimestamp, "expiryUnixTimestamp"),
    ]);
}

export function permissionValueHash(target: string, riskClass: 2 | 4, value: PermissionValue): Uint8Array {
    return createHash("sha256").update("chancery:pending-config-change:v1")
        .update(Uint8Array.of(0, 5)).update(decodePublicKey(target)).update(Uint8Array.of(riskClass))
        .update(permissionValuePayload(value)).digest();
}

export function permissionChangeId(target: string, newValueHash: Uint8Array, governanceAuthority: string, nonce: bigint): Uint8Array {
    if (newValueHash.length !== 32) throw new Error("Config-change value hash must contain 32 bytes");
    const nonceBytes = Buffer.from(encodeType("u64", nonce, "proposerNonce"));
    nonceBytes.reverse();
    return createHash("sha256").update("chancery:pending-config-change-id:v1")
        .update(Uint8Array.of(0, 5)).update(decodePublicKey(target)).update(newValueHash)
        .update(decodePublicKey(governanceAuthority)).update(nonceBytes).digest();
}
