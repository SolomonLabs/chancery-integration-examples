from __future__ import annotations

import json
import sys

from chancery_integration import (
    load_mint_direct_operation,
    prepare_market_maker_mint,
    prepared_settlement_to_document,
)


def main() -> int:
    if len(sys.argv) != 2:
        raise ValueError(
            "Usage: prepare_mint_inventory.py <direct-mint.operation.json>"
        )
    operation = load_mint_direct_operation(sys.argv[1])
    settlement = prepare_market_maker_mint(operation)
    print(json.dumps(prepared_settlement_to_document(settlement), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
