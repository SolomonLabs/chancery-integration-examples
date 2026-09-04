const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Int16Array(128).fill(-1);

for (let index = 0; index < BASE58_ALPHABET.length; index += 1) {
    BASE58_INDEX[BASE58_ALPHABET.charCodeAt(index)] = index;
}

export function decodeBase58(value: string): Uint8Array {
    if (value.length === 0) {
        throw new Error("Base58 value must not be empty");
    }

    const littleEndianBytes: number[] = [];
    for (const character of value) {
        const characterCode = character.charCodeAt(0);
        if (characterCode >= BASE58_INDEX.length || BASE58_INDEX[characterCode] === -1) {
            throw new Error(`Invalid base58 character ${JSON.stringify(character)}`);
        }

        let carry = BASE58_INDEX[characterCode] ?? -1;
        for (let index = 0; index < littleEndianBytes.length; index += 1) {
            const expanded = littleEndianBytes[index]! * 58 + carry;
            littleEndianBytes[index] = expanded & 0xff;
            carry = expanded >>> 8;
        }
        while (carry > 0) {
            littleEndianBytes.push(carry & 0xff);
            carry >>>= 8;
        }
    }

    let leadingZeroCount = 0;
    while (leadingZeroCount < value.length && value[leadingZeroCount] === "1") {
        leadingZeroCount += 1;
    }

    const decoded = new Uint8Array(leadingZeroCount + littleEndianBytes.length);
    for (let index = 0; index < littleEndianBytes.length; index += 1) {
        decoded[decoded.length - 1 - index] = littleEndianBytes[index]!;
    }
    return decoded;
}

export function assertPublicKey(
    value: string,
    fieldName: string,
    allowDefaultPublicKey: boolean,
): void {
    const decoded = decodeBase58(value);
    if (decoded.length !== 32) {
        throw new Error(`${fieldName} must decode to exactly 32 bytes`);
    }
    if (!allowDefaultPublicKey && decoded.every((byte) => byte === 0)) {
        throw new Error(`${fieldName} must not be the default public key`);
    }
}
