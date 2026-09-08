from __future__ import annotations

import os

from chancery_reference.client import ChanceryClient
from oracle_snapshot import build_oracle_snapshot


def required_environment_variable(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        raise ValueError(f"Missing environment variable {name}")
    return value


def main() -> int:
    client = ChanceryClient(
        required_environment_variable("RPC_URL"),
        "confirmed",
    )
    discovery = client.discover()
    print(ChanceryClient.stringify(build_oracle_snapshot(discovery)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())