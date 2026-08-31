const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEXES = createBase58Indexes();

function createBase58Indexes(): Int16Array {
    const indexes = new Int16Array(128);
    indexes.fill(-1);
    for (let index = 0, length = BASE58_ALPHABET.length; index < length; index++) {
        indexes[BASE58_ALPHABET.charCodeAt(index)] = index;
    }
    return indexes;
}

export function encodeBase58(bytes: Uint8Array): string {
    if (bytes.length === 0) {
        return "";
    }

    let leadingZeroCount = 0;
    while (leadingZeroCount < bytes.length && bytes[leadingZeroCount] === 0) {
        leadingZeroCount++;
    }

    if (leadingZeroCount === bytes.length) {
        return "1".repeat(leadingZeroCount);
    }

    const digits: number[] = [0];
    for (let byteIndex = leadingZeroCount, byteLength = bytes.length; byteIndex < byteLength; byteIndex++) {
        let carry = bytes[byteIndex] ?? 0;
        for (let digitIndex = 0, digitLength = digits.length; digitIndex < digitLength; digitIndex++) {
            carry += (digits[digitIndex] ?? 0) * 256;
            digits[digitIndex] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }

    let encoded = "1".repeat(leadingZeroCount);
    for (let digitIndex = digits.length - 1; digitIndex >= 0; digitIndex--) {
        encoded += BASE58_ALPHABET[digits[digitIndex] ?? 0] ?? "";
    }
    return encoded;
}

export function decodeBase58(encoded: string): Uint8Array {
    if (encoded.length === 0) {
        return new Uint8Array(0);
    }

    let leadingOneCount = 0;
    while (leadingOneCount < encoded.length && encoded.charCodeAt(leadingOneCount) === 49) {
        leadingOneCount++;
    }

    if (leadingOneCount === encoded.length) {
        return new Uint8Array(leadingOneCount);
    }

    const bytes: number[] = [0];
    for (
        let characterIndex = leadingOneCount, characterLength = encoded.length;
        characterIndex < characterLength;
        characterIndex++
    ) {
        const characterCode = encoded.charCodeAt(characterIndex);
        const alphabetIndex = characterCode < BASE58_INDEXES.length ? BASE58_INDEXES[characterCode] : -1;
        if (alphabetIndex === undefined || alphabetIndex < 0) {
            throw new Error(`Invalid base58 character at index ${characterIndex}`);
        }

        let carry = alphabetIndex;
        for (let byteIndex = 0, byteLength = bytes.length; byteIndex < byteLength; byteIndex++) {
            carry += (bytes[byteIndex] ?? 0) * 58;
            bytes[byteIndex] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    const decoded = new Uint8Array(leadingOneCount + bytes.length);
    for (let byteIndex = 0, byteLength = bytes.length; byteIndex < byteLength; byteIndex++) {
        decoded[decoded.length - 1 - byteIndex] = bytes[byteIndex] ?? 0;
    }
    return decoded;
}

export function decodePublicKey(publicKey: string | Uint8Array): Uint8Array {
    const bytes = typeof publicKey === "string" ? decodeBase58(publicKey) : new Uint8Array(publicKey);
    if (bytes.length !== 32) {
        throw new Error(`Public key must contain 32 bytes; received ${bytes.length}`);
    }
    return bytes;
}

export function normalizePublicKey(publicKey: string | Uint8Array): string {
    return encodeBase58(decodePublicKey(publicKey));
}
