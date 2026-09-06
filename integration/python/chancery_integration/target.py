from __future__ import annotations

import os

CHANCERY_MAINNET_PROGRAM_ADDRESS = "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz"
CHANCERY_DEVNET_PROGRAM_ADDRESS = "3doMTb5u94mzTDoBbyJXbZscNE3suuQe75ybYmirKute"


def chancery_program_address_for_target(target: str = "mainnet") -> str:
    if target == "mainnet":
        return CHANCERY_MAINNET_PROGRAM_ADDRESS
    if target == "devnet":
        return CHANCERY_DEVNET_PROGRAM_ADDRESS
    raise ValueError("CHANCERY_TARGET must be mainnet or devnet")


CHANCERY_PROGRAM_ADDRESS = chancery_program_address_for_target(os.environ.get("CHANCERY_TARGET", "mainnet"))
