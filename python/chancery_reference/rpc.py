from __future__ import annotations

import json
from dataclasses import dataclass
from typing import cast
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .account import DecodedChanceryAccount, decode_chancery_account
from .base58_codec import normalize_public_key
from .binary_codec import decode_base64, encode_base64
from .event import ChanceryEventOccurrence, decode_chancery_events_from_rpc_transaction

RpcCommitment = str


@dataclass(frozen=True)
class RpcAccountInfo:
    data: bytes
    executable: bool
    lamports: int
    owner: str
    rent_epoch: int
    space: int


@dataclass(frozen=True)
class RpcAddressAccountInfo:
    address: str
    account: RpcAccountInfo


@dataclass(frozen=True)
class RpcLatestBlockhash:
    blockhash: str
    last_valid_block_height: int


@dataclass(frozen=True)
class RpcEpochInfo:
    epoch: int
    slot_index: int
    slots_in_epoch: int
    absolute_slot: int
    block_height: int | None
    transaction_count: int | None


@dataclass(frozen=True)
class RpcClock:
    slot: int
    epoch_start_unix_timestamp: int
    epoch: int
    leader_schedule_epoch: int
    unix_timestamp: int


@dataclass(frozen=True)
class RpcSimulationResult:
    error: object | None
    logs: tuple[str, ...] | None
    units_consumed: int | None
    return_data: object | None
    accounts: object | None
    raw: dict[str, object]


@dataclass(frozen=True)
class RpcSignatureStatus:
    slot: int
    confirmations: int | None
    error: object | None
    confirmation_status: str | None


class ChanceryRpc:
    def __init__(self, endpoint: str) -> None:
        parsed_endpoint = urlparse(endpoint)
        if parsed_endpoint.scheme not in ("http", "https") or not parsed_endpoint.netloc:
            raise ValueError("RPC endpoint must use HTTP or HTTPS")
        self._endpoint = endpoint
        self._request_id = 0
        self._minimum_context_slot: int | None = None

    def set_minimum_context_slot(self, slot: int | None) -> None:
        if slot is not None and (isinstance(slot, bool) or not isinstance(slot, int) or slot < 0):
            raise ValueError("Minimum context slot must be a nonnegative integer")
        self._minimum_context_slot = slot

    def request(self, method: str, parameters: list[object]) -> object:
        self._request_id += 1
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": self._request_id,
                "method": method,
                "params": parameters,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        request = Request(
            self._endpoint,
            data=body,
            method="POST",
            headers={"content-type": "application/json"},
        )
        with urlopen(request) as response:
            response_value: object = json.loads(response.read().decode("utf-8"))
        response_record = _record(response_value, "RPC response")
        error_value = response_record.get("error")
        if error_value is not None:
            error_record = _record(error_value, "RPC error")
            code = error_record.get("code")
            message = error_record.get("message")
            if isinstance(code, bool) or not isinstance(code, int) or not isinstance(message, str):
                raise ValueError("RPC error requires numeric code and string message fields")
            detail = "" if "data" not in error_record else f" {error_record['data']!r}"
            raise RuntimeError(f"RPC {code}: {message}{detail}")
        if "result" not in response_record:
            raise ValueError("RPC response has no result field")
        return response_record["result"]

    def get_account_info(
        self,
        address: str | bytes | bytearray | memoryview,
        commitment: RpcCommitment = "confirmed",
    ) -> RpcAccountInfo | None:
        result = self.request(
            "getAccountInfo",
            [
                normalize_public_key(address),
                self._context_configuration({"encoding": "base64", "commitment": commitment}),
            ],
        )
        result_record = _record(result, "getAccountInfo result")
        value = result_record.get("value")
        return None if value is None else _parse_account_info(value)

    def get_multiple_accounts(
        self,
        addresses: list[str],
        commitment: RpcCommitment = "confirmed",
    ) -> tuple[RpcAccountInfo | None, ...]:
        result = self.request(
            "getMultipleAccounts",
            [
                [normalize_public_key(address) for address in addresses],
                self._context_configuration({"encoding": "base64", "commitment": commitment}),
            ],
        )
        result_record = _record(result, "getMultipleAccounts result")
        values = result_record.get("value")
        if not isinstance(values, list):
            raise ValueError("getMultipleAccounts result.value must be an array")
        parsed: list[RpcAccountInfo | None] = []
        for index, value in enumerate(values):
            parsed.append(None if value is None else _parse_account_info(value, f"getMultipleAccounts[{index}]"))
        return tuple(parsed)

    def get_program_accounts(
        self,
        program_address: str | bytes | bytearray | memoryview,
        filters: list[dict[str, object]] | None = None,
        commitment: RpcCommitment = "confirmed",
    ) -> tuple[RpcAddressAccountInfo, ...]:
        result = self.request(
            "getProgramAccounts",
            [
                normalize_public_key(program_address),
                self._context_configuration({
                    "encoding": "base64",
                    "commitment": commitment,
                    "filters": [] if filters is None else filters,
                }),
            ],
        )
        if not isinstance(result, list):
            raise ValueError("getProgramAccounts result must be an array")
        parsed: list[RpcAddressAccountInfo] = []
        for index, value in enumerate(result):
            item = _record(value, f"getProgramAccounts[{index}]")
            address = item.get("pubkey")
            if not isinstance(address, str):
                raise ValueError(f"getProgramAccounts[{index}].pubkey must be a string")
            parsed.append(
                RpcAddressAccountInfo(
                    address=normalize_public_key(address),
                    account=_parse_account_info(item.get("account"), f"getProgramAccounts[{index}].account"),
                )
            )
        return tuple(parsed)

    def get_token_accounts_by_owner(
        self,
        owner: str | bytes | bytearray | memoryview,
        mint: str | bytes | bytearray | memoryview,
        commitment: RpcCommitment = "confirmed",
    ) -> tuple[RpcAddressAccountInfo, ...]:
        result = self.request(
            "getTokenAccountsByOwner",
            [
                normalize_public_key(owner),
                {"mint": normalize_public_key(mint)},
                self._context_configuration({"encoding": "base64", "commitment": commitment}),
            ],
        )
        result_record = _record(result, "getTokenAccountsByOwner result")
        values = result_record.get("value")
        if not isinstance(values, list):
            raise ValueError("getTokenAccountsByOwner result.value must be an array")
        parsed: list[RpcAddressAccountInfo] = []
        for index, value in enumerate(values):
            item = _record(value, f"getTokenAccountsByOwner.value[{index}]")
            address = item.get("pubkey")
            if not isinstance(address, str):
                raise ValueError(f"getTokenAccountsByOwner.value[{index}].pubkey must be a string")
            parsed.append(
                RpcAddressAccountInfo(
                    address=normalize_public_key(address),
                    account=_parse_account_info(item.get("account"), f"getTokenAccountsByOwner.value[{index}].account"),
                )
            )
        return tuple(parsed)

    def get_latest_blockhash(self, commitment: RpcCommitment = "confirmed") -> RpcLatestBlockhash:
        result = self.request(
            "getLatestBlockhash",
            [self._context_configuration({"commitment": commitment})],
        )
        result_record = _record(result, "getLatestBlockhash result")
        value = _record(result_record.get("value"), "getLatestBlockhash result.value")
        blockhash = value.get("blockhash")
        if not isinstance(blockhash, str):
            raise ValueError("getLatestBlockhash blockhash must be a string")
        return RpcLatestBlockhash(
            blockhash=normalize_public_key(blockhash),
            last_valid_block_height=_unsigned_integer(value.get("lastValidBlockHeight"), "lastValidBlockHeight"),
        )

    def get_block_height(self, commitment: RpcCommitment = "confirmed") -> int:
        return _unsigned_integer(self.request("getBlockHeight", [{"commitment": commitment}]), "getBlockHeight result")

    def get_slot(self, commitment: RpcCommitment = "confirmed") -> int:
        return _unsigned_integer(self.request("getSlot", [{"commitment": commitment}]), "getSlot result")

    def get_block_time(self, slot: int) -> int | None:
        if isinstance(slot, bool) or not isinstance(slot, int) or slot < 0:
            raise ValueError("getBlockTime slot must be an unsigned integer")
        result = self.request("getBlockTime", [slot])
        if result is None:
            return None
        if isinstance(result, bool) or not isinstance(result, int):
            raise ValueError("getBlockTime result must be an integer or null")
        return result

    def get_clock(self, commitment: RpcCommitment = "confirmed") -> RpcClock:
        account = self.get_account_info(
            "SysvarC1ock11111111111111111111111111111111",
            commitment,
        )
        if account is None or len(account.data) < 40:
            raise ValueError("Clock sysvar account is unavailable or truncated")
        return RpcClock(
            slot=int.from_bytes(account.data[0:8], "little", signed=False),
            epoch_start_unix_timestamp=int.from_bytes(account.data[8:16], "little", signed=True),
            epoch=int.from_bytes(account.data[16:24], "little", signed=False),
            leader_schedule_epoch=int.from_bytes(account.data[24:32], "little", signed=False),
            unix_timestamp=int.from_bytes(account.data[32:40], "little", signed=True),
        )

    def get_epoch_info(self, commitment: RpcCommitment = "confirmed") -> RpcEpochInfo:
        result = _record(
            self.request(
                "getEpochInfo",
                [self._context_configuration({"commitment": commitment})],
            ),
            "getEpochInfo result",
        )
        block_height_value = result.get("blockHeight")
        transaction_count_value = result.get("transactionCount")
        return RpcEpochInfo(
            epoch=_unsigned_integer(result.get("epoch"), "getEpochInfo epoch"),
            slot_index=_unsigned_integer(result.get("slotIndex"), "getEpochInfo slotIndex"),
            slots_in_epoch=_unsigned_integer(result.get("slotsInEpoch"), "getEpochInfo slotsInEpoch"),
            absolute_slot=_unsigned_integer(result.get("absoluteSlot"), "getEpochInfo absoluteSlot"),
            block_height=(
                None
                if block_height_value is None
                else _unsigned_integer(block_height_value, "getEpochInfo blockHeight")
            ),
            transaction_count=(
                None
                if transaction_count_value is None
                else _unsigned_integer(transaction_count_value, "getEpochInfo transactionCount")
            ),
        )

    def simulate_transaction(
        self,
        transaction: bytes | bytearray | memoryview,
        commitment: RpcCommitment = "confirmed",
        signature_verification: bool = True,
    ) -> RpcSimulationResult:
        result = self.request(
            "simulateTransaction",
            [
                encode_base64(transaction),
                {
                    "encoding": "base64",
                    "commitment": commitment,
                    "sigVerify": signature_verification,
                    "replaceRecentBlockhash": False,
                },
            ],
        )
        result_record = _record(result, "simulateTransaction result")
        value = _record(result_record.get("value"), "simulateTransaction result.value")
        logs_value = value.get("logs")
        logs: tuple[str, ...] | None
        if logs_value is None:
            logs = None
        elif isinstance(logs_value, list) and all(isinstance(log, str) for log in logs_value):
            logs = tuple(cast(list[str], logs_value))
        else:
            raise ValueError("simulateTransaction logs must be an array of strings or null")
        units_value = value.get("unitsConsumed")
        units_consumed = None if units_value is None else _unsigned_integer(units_value, "unitsConsumed")
        return RpcSimulationResult(
            error=value.get("err"),
            logs=logs,
            units_consumed=units_consumed,
            return_data=value.get("returnData"),
            accounts=value.get("accounts"),
            raw=value,
        )

    def send_transaction(
        self,
        transaction: bytes | bytearray | memoryview,
        commitment: RpcCommitment = "confirmed",
        skip_preflight: bool = False,
        maximum_retries: int = 5,
    ) -> str:
        result = self.request(
            "sendTransaction",
            [
                encode_base64(transaction),
                {
                    "encoding": "base64",
                    "preflightCommitment": commitment,
                    "skipPreflight": skip_preflight,
                    "maxRetries": maximum_retries,
                },
            ],
        )
        if not isinstance(result, str):
            raise ValueError("sendTransaction result must be a signature string")
        return result

    def get_signature_status(self, signature: str) -> RpcSignatureStatus | None:
        result = self.request("getSignatureStatuses", [[signature], {"searchTransactionHistory": True}])
        result_record = _record(result, "getSignatureStatuses result")
        values = result_record.get("value")
        if not isinstance(values, list) or len(values) != 1:
            raise ValueError("getSignatureStatuses result.value must contain one entry")
        value = values[0]
        if value is None:
            return None
        status = _record(value, "getSignatureStatuses status")
        confirmation_status = status.get("confirmationStatus")
        if confirmation_status is not None and confirmation_status not in ("processed", "confirmed", "finalized"):
            raise ValueError("getSignatureStatuses confirmationStatus is invalid")
        confirmations_value = status.get("confirmations")
        confirmations = None if confirmations_value is None else _unsigned_integer(confirmations_value, "confirmations")
        return RpcSignatureStatus(
            slot=_unsigned_integer(status.get("slot"), "slot"),
            confirmations=confirmations,
            error=status.get("err"),
            confirmation_status=cast(str | None, confirmation_status),
        )

    def get_transaction(self, signature: str, commitment: RpcCommitment = "confirmed") -> object | None:
        return self.request(
            "getTransaction",
            [
                signature,
                {
                    "encoding": "json",
                    "commitment": commitment,
                    "maxSupportedTransactionVersion": 0,
                },
            ],
        )

    def get_decoded_chancery_account(
        self,
        address: str | bytes | bytearray | memoryview,
        commitment: RpcCommitment = "confirmed",
    ) -> DecodedChanceryAccount | None:
        account_info = self.get_account_info(address, commitment)
        return None if account_info is None else decode_chancery_account(account_info.data)

    def get_chancery_events(
        self,
        signature: str,
        commitment: RpcCommitment = "confirmed",
    ) -> tuple[ChanceryEventOccurrence, ...] | None:
        result = self.get_transaction(signature, commitment)
        if result is None:
            return None
        return decode_chancery_events_from_rpc_transaction(result)

    def _context_configuration(self, configuration: dict[str, object]) -> dict[str, object]:
        if self._minimum_context_slot is None:
            return configuration
        return {
            **configuration,
            "minContextSlot": self._minimum_context_slot,
        }


def _record(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], value)


def _parse_account_info(value: object, label: str = "RPC account value") -> RpcAccountInfo:
    record = _record(value, label)
    data_value = record.get("data")
    executable = record.get("executable")
    owner = record.get("owner")
    if (
        not isinstance(data_value, list)
        or len(data_value) != 2
        or not isinstance(data_value[0], str)
        or data_value[1] != "base64"
        or not isinstance(executable, bool)
        or not isinstance(owner, str)
    ):
        raise ValueError(f"{label} has an unsupported shape")
    data = decode_base64(data_value[0])
    space_value = record.get("space")
    space = len(data) if space_value is None else _unsigned_integer(space_value, "space")
    return RpcAccountInfo(
        data=data,
        executable=executable,
        lamports=_unsigned_integer(record.get("lamports"), "lamports"),
        owner=normalize_public_key(owner),
        rent_epoch=_unsigned_integer(record.get("rentEpoch"), "rentEpoch"),
        space=space,
    )


def _unsigned_integer(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field_name} must be an unsigned integer")
    return value
