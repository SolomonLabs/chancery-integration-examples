from __future__ import annotations

import argparse
import sys

from chancery_integration import (
    build_redeem_direct_instruction,
    load_redeem_direct_operation,
    serialize_instruction,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a Chancery redeem_direct instruction document."
    )
    parser.add_argument("operation_file")
    arguments = parser.parse_args()

    operation = load_redeem_direct_operation(arguments.operation_file)
    instruction = build_redeem_direct_instruction(operation)
    sys.stdout.write(serialize_instruction(instruction))


if __name__ == "__main__":
    main()
