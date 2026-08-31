from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from collections.abc import Sequence

from .base58_codec import decode_public_key, encode_base58
from .schema import CHANCERY_PROGRAM_ADDRESS

PROGRAM_DERIVED_ADDRESS_MARKER = b"ProgramDerivedAddress"
ED25519_FIELD_MODULUS = (1 << 255) - 19
ED25519_D = (-121665 * pow(121666, ED25519_FIELD_MODULUS - 2, ED25519_FIELD_MODULUS)) % ED25519_FIELD_MODULUS
ED25519_SQRT_MINUS_ONE = pow(2, (ED25519_FIELD_MODULUS - 1) // 4, ED25519_FIELD_MODULUS)


@dataclass(frozen=True)
class ProgramAddressResult:
    address: str
    bump: int


def _is_ed25519_curve_point(compressed_point: bytes) -> bool:
    if len(compressed_point) != 32:
        return False

    encoded_y = bytearray(compressed_point)
    sign = encoded_y[31] >> 7
    encoded_y[31] &= 0x7F
    y = int.from_bytes(encoded_y, "little")
    if y >= ED25519_FIELD_MODULUS:
        return False

    y_squared = y * y % ED25519_FIELD_MODULUS
    numerator = (y_squared - 1) % ED25519_FIELD_MODULUS
    denominator = (ED25519_D * y_squared + 1) % ED25519_FIELD_MODULUS
    if denominator == 0:
        return False

    x_squared = numerator * pow(
        denominator,
        ED25519_FIELD_MODULUS - 2,
        ED25519_FIELD_MODULUS,
    ) % ED25519_FIELD_MODULUS
    x = pow(
        x_squared,
        (ED25519_FIELD_MODULUS + 3) // 8,
        ED25519_FIELD_MODULUS,
    )
    if (x * x - x_squared) % ED25519_FIELD_MODULUS != 0:
        x = x * ED25519_SQRT_MINUS_ONE % ED25519_FIELD_MODULUS
    if (x * x - x_squared) % ED25519_FIELD_MODULUS != 0:
        return False
    if x == 0 and sign == 1:
        return False
    return True


def _validate_seeds(seeds: Sequence[bytes], maximum_seed_count: int) -> None:
    if len(seeds) > maximum_seed_count:
        raise ValueError(f"Program address accepts at most {maximum_seed_count} seeds")
    for seed_index, seed in enumerate(seeds):
        if len(seed) > 32:
            raise ValueError(f"Program address seed {seed_index} exceeds 32 bytes")


def create_program_address(
    seeds: Sequence[bytes | bytearray | memoryview],
    program_address: str | bytes | bytearray | memoryview = CHANCERY_PROGRAM_ADDRESS,
) -> str:
    normalized_seeds = [bytes(seed) for seed in seeds]
    _validate_seeds(normalized_seeds, 16)
    digest = sha256(
        b"".join(normalized_seeds)
        + decode_public_key(program_address)
        + PROGRAM_DERIVED_ADDRESS_MARKER
    ).digest()
    if _is_ed25519_curve_point(digest):
        raise ValueError("Derived address is on the Ed25519 curve")
    return encode_base58(digest)


def find_program_address(
    seeds: Sequence[bytes | bytearray | memoryview],
    program_address: str | bytes | bytearray | memoryview = CHANCERY_PROGRAM_ADDRESS,
) -> ProgramAddressResult:
    normalized_seeds = [bytes(seed) for seed in seeds]
    _validate_seeds(normalized_seeds, 15)
    for bump in range(255, -1, -1):
        try:
            return ProgramAddressResult(
                address=create_program_address(
                    [*normalized_seeds, bytes([bump])],
                    program_address,
                ),
                bump=bump,
            )
        except ValueError as error:
            if str(error) != "Derived address is on the Ed25519 curve":
                raise
    raise ValueError("Unable to find an off-curve program address")
