from __future__ import annotations

import os

from chancery_reference.client import ChanceryClient
from chancery_reference.discovery import ChanceryStateDiscovery
from chancery_reference.event import ChanceryEventOccurrence


def required_environment_variable(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        raise ValueError(f"Missing environment variable {name}")
    return value


def comma_separated_values(value: str | None) -> tuple[str, ...]:
    if value is None or value.strip() == "":
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip() != "")


def summarize_deployment(discovery: ChanceryStateDiscovery) -> dict[str, object]:
    return {
        "program_address": discovery.program_address,
        "commitment": discovery.commitment,
        "account_count": discovery.account_count,
        "account_counts_by_type": {
            type_name: len(accounts)
            for type_name, accounts in discovery.accounts_by_type.items()
        },
        "unrecognized_account_count": len(discovery.unrecognized_accounts),
        "asset_mints": [asset.asset_mint for asset in discovery.assets],
        "pathway_ids": [pathway.pathway_id for pathway in discovery.pathways],
    }


def summarize_evidence(
    signature: str,
    occurrences: tuple[ChanceryEventOccurrence, ...] | None,
) -> dict[str, object]:
    if occurrences is None:
        return {"signature": signature, "evidence": None}
    return {
        "signature": signature,
        "event_count": len(occurrences),
        "events": [
            {
                "name": occurrence.event.name,
                "parent_instruction_index": occurrence.parent_instruction_index,
                "inner_instruction_index": occurrence.inner_instruction_index,
                "values": occurrence.event.values,
            }
            for occurrence in occurrences
        ],
    }


def main() -> int:
    rpc_endpoint = required_environment_variable("RPC_URL")
    client = ChanceryClient(rpc_endpoint, "confirmed")

    discovery = client.discover()
    print(ChanceryClient.stringify(summarize_deployment(discovery)))

    if os.environ.get("FULL_DISCOVERY") == "true":
        print(ChanceryClient.stringify(discovery))

    for signature in comma_separated_values(os.environ.get("TRANSACTION_SIGNATURES")):
        occurrences = client.decode_transaction_evidence(signature)
        print(ChanceryClient.stringify(summarize_evidence(signature, occurrences)))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
