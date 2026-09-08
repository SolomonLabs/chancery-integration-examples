from __future__ import annotations

from chancery_reference.chancery_protocol import (
    RATE_PRECISION_E9,
    require_int_field,
    require_public_key_field,
)
from chancery_reference.discovery import ChanceryStateDiscovery

BASIS_POINTS_DENOMINATOR = 10_000


def format_rate_e9(rate_e9: int) -> str:
    if rate_e9 < 0:
        raise ValueError("Rate must be non-negative")
    integer, fraction = divmod(rate_e9, RATE_PRECISION_E9)
    return f"{integer}.{fraction:09d}"


def is_rate_within_basis_points_of_one(
    rate_e9: int,
    tolerance_basis_points: int,
) -> bool:
    if rate_e9 < 0:
        raise ValueError("Rate must be non-negative")
    if tolerance_basis_points < 0:
        raise ValueError("Tolerance must be non-negative")
    difference = abs(rate_e9 - RATE_PRECISION_E9)
    return (
        difference * BASIS_POINTS_DENOMINATOR
        <= RATE_PRECISION_E9 * tolerance_basis_points
    )


def build_oracle_snapshot(discovery: ChanceryStateDiscovery) -> dict[str, object]:
    issued_token_mint = (
        None
        if discovery.chancery_config is None
        else require_public_key_field(
            discovery.chancery_config.values,
            "issued_token_mint",
        )
    )
    assets: list[dict[str, object]] = []
    for asset in discovery.assets:
        mode_value = require_int_field(asset.asset_config.values, "mode")
        assets.append(
            {
                "asset_mint": asset.asset_mint,
                "asset_token_program": asset.asset_token_program,
                "mode": _asset_mode_name(mode_value),
                "mode_value": mode_value,
                "deposit_rate_e9": asset.deposit_rate_e9,
                "redeem_rate_e9": asset.redeem_rate_e9,
                "deposit_rate": format_rate_e9(asset.deposit_rate_e9),
                "redeem_rate": format_rate_e9(asset.redeem_rate_e9),
            }
        )
    return {
        "program_address": discovery.program_address,
        "commitment": discovery.commitment,
        "issued_token_mint": issued_token_mint,
        "assets": assets,
        "fees": {
            "global_fee_policy": None,
            "pathway_scoped_fees_present": any(
                pathway.fee_policy is not None
                for pathway in discovery.pathways
            ),
        },
    }


def _asset_mode_name(mode_value: int) -> str:
    if mode_value == 0:
        return "active"
    if mode_value == 1:
        return "wind_down"
    if mode_value == 2:
        return "frozen"
    return "unknown"