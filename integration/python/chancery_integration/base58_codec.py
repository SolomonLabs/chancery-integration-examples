from __future__ import annotations


_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_BASE58_INDEX = {character: index for index, character in enumerate(_BASE58_ALPHABET)}


def decode_base58(value: str) -> bytes:
    if not value:
        raise ValueError("Base58 value must not be empty")

    number = 0
    for character in value:
        digit = _BASE58_INDEX.get(character)
        if digit is None:
            raise ValueError(f"Invalid base58 character {character!r}")
        number = number * 58 + digit

    encoded = (
        number.to_bytes((number.bit_length() + 7) // 8, byteorder="big")
        if number
        else b""
    )
    leading_zero_count = len(value) - len(value.lstrip("1"))
    return (b"\x00" * leading_zero_count) + encoded


def assert_public_key(
    value: str,
    field_name: str,
    *,
    allow_default_public_key: bool,
) -> None:
    decoded = decode_base58(value)
    if len(decoded) != 32:
        raise ValueError(f"{field_name} must decode to exactly 32 bytes")
    if not allow_default_public_key and decoded == (b"\x00" * 32):
        raise ValueError(f"{field_name} must not be the default public key")
