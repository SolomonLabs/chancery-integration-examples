from __future__ import annotations

import argparse
import sys

from .client import (
    ChanceryClient,
    SettlementOperationRequest,
    SettlementTransactionRequest,
)
from .solana_transaction import load_solana_keypair_file

_OPERATION_COMMANDS = ("inspect", "quote-mint", "mint", "quote-redeem", "redeem")
_COMMANDS = ("discover", "decode-transaction", *_OPERATION_COMMANDS)


def main(arguments: list[str] | None = None) -> int:
    parser = _build_parser()
    parsed = parser.parse_args(arguments)
    client = ChanceryClient(parsed.rpc, parsed.commitment)

    if parsed.command == "discover":
        print(ChanceryClient.stringify(client.discover()))
        return 0
    if parsed.command == "decode-transaction":
        if parsed.signature is None:
            parser.error("decode-transaction requires --signature")
        print(ChanceryClient.stringify(client.decode_transaction_evidence(parsed.signature)))
        return 0

    if parsed.asset_mint is None:
        parser.error(f"{parsed.command} requires --asset-mint")
    if parsed.principal is None:
        parser.error(f"{parsed.command} requires --principal")
    action = _command_action(parsed.command, parsed.action)
    operation_request = SettlementOperationRequest(
        action=action,
        mode=parsed.mode,
        asset_mint=parsed.asset_mint,
        principal=parsed.principal,
        amount=_parse_unsigned_integer(parsed.amount, "--amount"),
        minimum_output=_parse_unsigned_integer(parsed.minimum_output, "--minimum-output"),
        pathway_id=parsed.pathway_id,
        intent_id=parsed.intent_id,
        executor=parsed.executor,
        principal_b=parsed.principal_b,
        source_token_account=parsed.source_token_account,
        destination_token_account=parsed.destination_token_account,
        fee_recipient_token_account=parsed.fee_recipient_token_account,
        rent_refund_recipient=parsed.rent_refund_recipient,
        now_unix_timestamp=_parse_unsigned_integer(
            parsed.now_unix_timestamp,
            "--now-unix-timestamp",
        ),
    )
    inspection = client.inspect(operation_request)
    if parsed.command == "inspect":
        print(ChanceryClient.stringify(inspection))
        return 0 if inspection.ready else 2
    if not inspection.ready:
        print(ChanceryClient.stringify(inspection))
        return 2

    if len(parsed.signer) == 0:
        parser.error("at least one --signer <keypair.json> is required")
    keypairs = tuple(load_solana_keypair_file(path) for path in parsed.signer)
    fee_payer = parsed.fee_payer or keypairs[0].public_key
    transaction_request = SettlementTransactionRequest(
        fee_payer=fee_payer,
        keypairs=keypairs,
        address_lookup_table_addresses=tuple(parsed.lookup_table),
        commitment=parsed.commitment,
    )
    if parsed.command in ("quote-mint", "quote-redeem"):
        simulated = client.simulate_transaction(inspection, transaction_request)
        print(ChanceryClient.stringify(simulated))
        return 0 if simulated.simulation.error is None else 3
    submitted = client.submit_transaction(inspection, transaction_request)
    print(ChanceryClient.stringify(submitted))
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m chancery_reference.cli",
        description=(
            "Discover Chancery state, decode transaction evidence, and inspect, simulate, "
            "or submit settlements."
        ),
    )
    parser.add_argument("command", choices=_COMMANDS)
    parser.add_argument("--rpc", required=True)
    parser.add_argument("--signature")
    parser.add_argument("--asset-mint")
    parser.add_argument("--principal")
    parser.add_argument("--mode", choices=("direct", "delegated", "trilateral"), default="direct")
    parser.add_argument("--action", choices=("mint", "redeem"))
    parser.add_argument("--amount")
    parser.add_argument("--minimum-output")
    parser.add_argument("--pathway-id")
    parser.add_argument("--intent-id")
    parser.add_argument("--executor")
    parser.add_argument("--principal-b")
    parser.add_argument("--source-token-account")
    parser.add_argument("--destination-token-account")
    parser.add_argument("--fee-recipient-token-account")
    parser.add_argument("--rent-refund-recipient")
    parser.add_argument("--now-unix-timestamp")
    parser.add_argument("--signer", action="append", default=[])
    parser.add_argument("--fee-payer")
    parser.add_argument("--lookup-table", action="append", default=[])
    parser.add_argument(
        "--commitment",
        choices=("processed", "confirmed", "finalized"),
        default="confirmed",
    )
    return parser


def _command_action(command: str, explicit_action: str | None) -> str:
    if command in ("quote-mint", "mint"):
        return "mint"
    if command in ("quote-redeem", "redeem"):
        return "redeem"
    if explicit_action is None:
        raise ValueError("inspect requires --action mint or --action redeem")
    return explicit_action


def _parse_unsigned_integer(value: str | None, label: str) -> int | None:
    if value is None:
        return None
    if not value.isdecimal():
        raise ValueError(f"{label} must be an unsigned decimal integer")
    return int(value)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1) from error
