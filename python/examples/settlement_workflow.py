from __future__ import annotations

import os

from chancery_reference.client import (
    ChanceryClient,
    SettlementOperationRequest,
    SettlementTransactionRequest,
)
from chancery_reference.solana_transaction import load_solana_keypair_file


def required_environment_variable(name: str) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        raise ValueError(f"Missing environment variable {name}")
    return value


def parse_action(value: str) -> str:
    if value not in ("mint", "redeem"):
        raise ValueError("ACTION must be mint or redeem")
    return value


def parse_mode(value: str) -> str:
    if value not in ("direct", "delegated", "trilateral"):
        raise ValueError("MODE must be direct, delegated, or trilateral")
    return value


def parse_unsigned_integer(value: str, name: str) -> int:
    if not value.isdecimal():
        raise ValueError(f"{name} must be a raw unsigned integer")
    return int(value)


def comma_separated_values(value: str | None) -> tuple[str, ...]:
    if value is None or value.strip() == "":
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip() != "")


def main() -> int:
    rpc_endpoint = required_environment_variable("RPC_URL")
    client = ChanceryClient(rpc_endpoint, "confirmed")

    action = parse_action(required_environment_variable("ACTION"))
    mode = parse_mode(os.environ.get("MODE", "direct"))
    asset_mint = required_environment_variable("ASSET_MINT")
    principal = required_environment_variable("PRINCIPAL")
    signer_paths = comma_separated_values(required_environment_variable("KEYPAIR_PATHS"))
    keypairs = tuple(load_solana_keypair_file(path) for path in signer_paths)
    if len(keypairs) == 0:
        raise ValueError("KEYPAIR_PATHS did not contain a keypair path")

    request = SettlementOperationRequest(
        action=action,
        mode=mode,
        asset_mint=asset_mint,
        principal=principal,
        amount=parse_unsigned_integer(required_environment_variable("AMOUNT"), "AMOUNT")
        if mode == "direct"
        else None,
        minimum_output=parse_unsigned_integer(os.environ["MINIMUM_OUTPUT"], "MINIMUM_OUTPUT")
        if "MINIMUM_OUTPUT" in os.environ
        else None,
        pathway_id=os.environ.get("PATHWAY_ID"),
        intent_id=required_environment_variable("INTENT_ID") if mode != "direct" else None,
        executor=os.environ.get("EXECUTOR"),
        principal_b=os.environ.get("PRINCIPAL_B"),
        source_token_account=os.environ.get("SOURCE_TOKEN_ACCOUNT"),
        destination_token_account=os.environ.get("DESTINATION_TOKEN_ACCOUNT"),
        fee_recipient_token_account=os.environ.get("FEE_RECIPIENT_TOKEN_ACCOUNT"),
    )

    inspection = client.inspect(request)
    print(ChanceryClient.stringify(inspection))
    if not inspection.ready:
        return 2

    lookup_table_addresses = comma_separated_values(os.environ.get("LOOKUP_TABLES"))
    transaction_request = SettlementTransactionRequest(
        fee_payer=os.environ.get("FEE_PAYER", keypairs[0].public_key),
        keypairs=keypairs,
        address_lookup_table_addresses=lookup_table_addresses,
        commitment="confirmed",
    )
    simulation = client.simulate_transaction(inspection, transaction_request)
    print(ChanceryClient.stringify(simulation))
    if os.environ.get("SUBMIT") == "true" and simulation.simulation.error is None:
        submitted = client.submit_transaction(inspection, transaction_request)
        print(ChanceryClient.stringify(submitted))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
