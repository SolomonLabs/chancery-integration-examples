from __future__ import annotations

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_INDEXES = {character: index for index, character in enumerate(BASE58_ALPHABET)}


def encode_base58(data: bytes | bytearray | memoryview) -> str:
    raw = bytes(data)
    if not raw:
        return ""

    leading_zero_count = 0
    while leading_zero_count < len(raw) and raw[leading_zero_count] == 0:
        leading_zero_count += 1

    if leading_zero_count == len(raw):
        return "1" * leading_zero_count

    digits = [0]
    for byte_value in raw[leading_zero_count:]:
        carry = byte_value
        for digit_index in range(len(digits)):
            carry += digits[digit_index] * 256
            digits[digit_index] = carry % 58
            carry //= 58
        while carry > 0:
            digits.append(carry % 58)
            carry //= 58

    encoded = "1" * leading_zero_count
    encoded += "".join(BASE58_ALPHABET[digit] for digit in reversed(digits))
    return encoded


def decode_base58(encoded: str) -> bytes:
    if not encoded:
        return b""

    leading_one_count = 0
    while leading_one_count < len(encoded) and encoded[leading_one_count] == "1":
        leading_one_count += 1

    if leading_one_count == len(encoded):
        return b"\x00" * leading_one_count

    decoded = [0]
    for character_index, character in enumerate(encoded[leading_one_count:], start=leading_one_count):
        alphabet_index = BASE58_INDEXES.get(character)
        if alphabet_index is None:
            raise ValueError(f"Invalid base58 character at index {character_index}")
        carry = alphabet_index
        for byte_index in range(len(decoded)):
            carry += decoded[byte_index] * 58
            decoded[byte_index] = carry & 0xFF
            carry >>= 8
        while carry > 0:
            decoded.append(carry & 0xFF)
            carry >>= 8

    return b"\x00" * leading_one_count + bytes(reversed(decoded))


def decode_public_key(public_key: str | bytes | bytearray | memoryview) -> bytes:
    data = decode_base58(public_key) if isinstance(public_key, str) else bytes(public_key)
    if len(data) != 32:
        raise ValueError(f"Public key must contain 32 bytes; received {len(data)}")
    return data


def normalize_public_key(public_key: str | bytes | bytearray | memoryview) -> str:
    return encode_base58(decode_public_key(public_key))
