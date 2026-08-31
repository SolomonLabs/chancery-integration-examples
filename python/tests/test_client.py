from __future__ import annotations

import unittest

from chancery_reference.account import encode_chancery_account
from chancery_reference.base58_codec import decode_public_key, encode_base58
from chancery_reference.binary_codec import zero_value_for_type
from chancery_reference.chancery_protocol import (
    FEE_ACTIVE,
    FEE_IN_ASSET,
    FEE_IN_ISSUED_TOKEN,
    ROLE_CAN_EXECUTE_SETTLEMENT,
    ROLE_CAN_MINT_DELEGATED,
    ROLE_CAN_MINT_DIRECT,
    ROLE_CAN_REDEEM_DELEGATED,
    ROLE_CAN_REDEEM_DIRECT,
    ROLE_CAN_USE_TRILATERAL_PATHWAY,
    SCOPE_PATHWAY,
    derive_authority_transfer_address,
    derive_asset_config_address,
    derive_basic_freeze_record_address,
    derive_cross_chain_signer_set_address,
    derive_outbound_reclaim_record_address,
    derive_pathway_policy_address,
    derive_pending_config_change_address,
    derive_permission_record_address,
    derive_remote_domain_policy_address,
    derive_remote_nonce_address,
    derive_reserve_destination_address,
    derive_settlement_intent_address,
    derive_settlement_policy_address,
    derive_singleton_address,
    known_pda_address,
    observe_limit_policy,
)
from chancery_reference.client import (
    ChanceryClient,
    SettlementOperationRequest,
    SettlementTransactionRequest,
    compute_settlement_effective_quote,
)
from chancery_reference.program_address import find_program_address
from chancery_reference.rpc import (
    RpcAccountInfo,
    RpcAddressAccountInfo,
    RpcClock,
    RpcEpochInfo,
    RpcLatestBlockhash,
    RpcSignatureStatus,
    RpcSimulationResult,
)
from chancery_reference.schema import (
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    ZERO_ADDRESS,
    account_schema,
)
from chancery_reference.solana_transaction import keypair_from_secret_key_bytes
from chancery_reference.spl_token import (
    SPL_TOKEN_PROGRAM_ADDRESS,
    calculate_token_transfer_fee,
    decode_token_mint,
    derive_associated_token_address,
)


def public_key(fill: int) -> str:
    return encode_base58(bytes([fill]) * 32)


def active_module_statuses() -> bytes:
    statuses = bytearray(32)
    statuses[4] = 2
    return bytes(statuses)


def account_values(account_name: str, overrides: dict[str, object]) -> dict[str, object]:
    schema = account_schema(account_name)
    fields = schema.get("fields")
    if not isinstance(fields, list):
        raise ValueError(f"{account_name} fields are invalid")
    values: dict[str, object] = {}
    for field in fields:
        if not isinstance(field, dict):
            raise ValueError(f"{account_name} field is invalid")
        name = field.get("name")
        field_type = field.get("type")
        if not isinstance(name, str) or not isinstance(field_type, (str, dict)):
            raise ValueError(f"{account_name} field is invalid")
        values[name] = zero_value_for_type(field_type)
    values.update(overrides)
    return values


def chancery_account(account_name: str, values: dict[str, object]) -> RpcAccountInfo:
    data = encode_chancery_account(account_name, values)
    return RpcAccountInfo(
        data=data,
        executable=False,
        lamports=1,
        owner=CHANCERY_PROGRAM_ADDRESS,
        rent_epoch=0,
        space=len(data),
    )


def token_mint_account(supply: int = 0, decimals: int = 6) -> RpcAccountInfo:
    data = bytearray(82)
    data[36:44] = supply.to_bytes(8, "little")
    data[44] = decimals
    data[45] = 1
    return RpcAccountInfo(
        data=bytes(data),
        executable=False,
        lamports=1,
        owner=SPL_TOKEN_PROGRAM_ADDRESS,
        rent_epoch=0,
        space=len(data),
    )


def token_2022_mint_with_transfer_fee(
    older_epoch: int,
    older_maximum_fee: int,
    older_basis_points: int,
    newer_epoch: int,
    newer_maximum_fee: int,
    newer_basis_points: int,
) -> bytes:
    data = bytearray(166 + 4 + 108)
    data[44] = 6
    data[45] = 1
    data[165] = 1
    data[166:168] = (1).to_bytes(2, "little")
    data[168:170] = (108).to_bytes(2, "little")
    value_offset = 170
    data[value_offset + 72 : value_offset + 80] = older_epoch.to_bytes(8, "little")
    data[value_offset + 80 : value_offset + 88] = older_maximum_fee.to_bytes(8, "little")
    data[value_offset + 88 : value_offset + 90] = older_basis_points.to_bytes(2, "little")
    data[value_offset + 90 : value_offset + 98] = newer_epoch.to_bytes(8, "little")
    data[value_offset + 98 : value_offset + 106] = newer_maximum_fee.to_bytes(8, "little")
    data[value_offset + 106 : value_offset + 108] = newer_basis_points.to_bytes(2, "little")
    return bytes(data)


def token_account(mint: str, owner: str, amount: int) -> RpcAccountInfo:
    data = bytearray(165)
    data[0:32] = decode_public_key(mint)
    data[32:64] = decode_public_key(owner)
    data[64:72] = amount.to_bytes(8, "little")
    data[108] = 1
    return RpcAccountInfo(
        data=bytes(data),
        executable=False,
        lamports=1,
        owner=SPL_TOKEN_PROGRAM_ADDRESS,
        rent_epoch=0,
        space=len(data),
    )


class FixtureRpc:
    def __init__(self, action: str) -> None:
        self.action = action
        self.signer = keypair_from_secret_key_bytes(bytes([7]) * 32)
        self.principal = self.signer.public_key
        self.asset_mint = public_key(21)
        self.issued_token_mint = public_key(22)
        self.pathway_id = bytes([31]) * 32
        self.pathway_address = derive_pathway_policy_address(self.pathway_id).address
        self.asset_config_address = derive_asset_config_address(self.asset_mint).address
        self.mint_authority = derive_singleton_address("mint_authority_pda", "mint-authority").address
        self.reserve_authority = derive_singleton_address("reserve_authority_pda", "reserve-authority").address
        self.permission_address = derive_permission_record_address(
            self.principal, SCOPE_PATHWAY, self.pathway_address
        ).address
        self.reserve_token = derive_associated_token_address(
            self.reserve_authority, self.asset_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        source_mint = self.asset_mint if action == "mint" else self.issued_token_mint
        destination_mint = self.issued_token_mint if action == "mint" else self.asset_mint
        self.source_token = derive_associated_token_address(
            self.principal, source_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        self.destination_token = derive_associated_token_address(
            self.principal, destination_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        required_role = ROLE_CAN_MINT_DIRECT if action == "mint" else ROLE_CAN_REDEEM_DIRECT
        self.accounts: dict[str, RpcAccountInfo] = {
            known_pda_address("module_activation_state"): chancery_account(
                "ModuleActivationState",
                account_values(
                    "ModuleActivationState",
                    {"version": 1, "module_statuses": active_module_statuses()},
                ),
            ),
            known_pda_address("chancery_config"): chancery_account(
                "ChanceryConfig",
                account_values(
                    "ChanceryConfig",
                    {
                        "version": 1,
                        "issued_token_mint": self.issued_token_mint,
                        "issued_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "mint_authority_pda": self.mint_authority,
                    },
                ),
            ),
            known_pda_address("pause_state"): chancery_account(
                "PauseState", account_values("PauseState", {"version": 1})
            ),
            self.asset_config_address: chancery_account(
                "AssetConfig",
                account_values(
                    "AssetConfig",
                    {
                        "version": 1,
                        "asset_mint": self.asset_mint,
                        "asset_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "deposit_rate_e9": 1_000_000_000,
                        "redeem_rate_e9": 1_000_000_000,
                        "minimum_deposit_amount": 1,
                        "minimum_redeem_amount": 1,
                    },
                ),
            ),
            known_pda_address("issued_token_control"): chancery_account(
                "IssuedTokenControl",
                account_values(
                    "IssuedTokenControl",
                    {
                        "version": 1,
                        "issued_token_mint": self.issued_token_mint,
                        "issued_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "mint_authority_pda": self.mint_authority,
                        "control_flags": 1 << 63,
                    },
                ),
            ),
            self.pathway_address: chancery_account(
                "PathwayPolicy",
                account_values(
                    "PathwayPolicy",
                    {
                        "version": 1,
                        "pathway_kind": 0,
                        "pathway_id": self.pathway_id,
                        "asset_mint": self.asset_mint,
                        "issued_token_mint": self.issued_token_mint,
                        "designated_executor": ZERO_ADDRESS,
                        "status_flags": 1,
                    },
                ),
            ),
            self.permission_address: chancery_account(
                "PermissionRecord",
                account_values(
                    "PermissionRecord",
                    {
                        "version": 1,
                        "scope_kind": SCOPE_PATHWAY,
                        "subject": self.principal,
                        "scope_key": self.pathway_address,
                        "role_bits": [required_role, 0],
                        "role_schema_version": 1,
                    },
                ),
            ),
            self.asset_mint: token_mint_account(5_000_000),
            self.issued_token_mint: token_mint_account(10_000_000),
            self.source_token: token_account(source_mint, self.principal, 1_000_000),
            self.destination_token: token_account(destination_mint, self.principal, 0),
            self.reserve_token: token_account(self.asset_mint, self.reserve_authority, 1_000_000),
        }

    def get_slot(self, commitment: str = "confirmed") -> int:
        return 100

    def set_minimum_context_slot(self, slot: int | None) -> None:
        return None

    def get_clock(self, commitment: str = "confirmed") -> RpcClock:
        return RpcClock(
            slot=100,
            epoch_start_unix_timestamp=0,
            epoch=10,
            leader_schedule_epoch=10,
            unix_timestamp=1_700_000_000,
        )

    def get_epoch_info(self, commitment: str = "confirmed") -> RpcEpochInfo:
        return RpcEpochInfo(
            epoch=10,
            slot_index=100,
            slots_in_epoch=432_000,
            absolute_slot=100,
            block_height=100,
            transaction_count=0,
        )

    def get_account_info(self, address: str, commitment: str = "confirmed") -> RpcAccountInfo | None:
        return self.accounts.get(address)

    def get_program_accounts(
        self,
        program_address: str,
        filters: list[dict[str, object]] | None = None,
        commitment: str = "confirmed",
    ) -> tuple[RpcAddressAccountInfo, ...]:
        if len(filters or []) == 0:
            return tuple(
                RpcAddressAccountInfo(address, account)
                for address, account in self.accounts.items()
                if account.owner == CHANCERY_PROGRAM_ADDRESS and not account.executable
            )
        size = None
        for filter_value in filters or []:
            if "dataSize" in filter_value:
                size = filter_value["dataSize"]
        if size == account_schema("PathwayPolicy")["size"]:
            return (RpcAddressAccountInfo(self.pathway_address, self.accounts[self.pathway_address]),)
        return ()

    def get_token_accounts_by_owner(
        self,
        owner: str,
        mint: str,
        commitment: str = "confirmed",
    ) -> tuple[RpcAddressAccountInfo, ...]:
        return ()

    def get_latest_blockhash(self, commitment: str = "confirmed") -> RpcLatestBlockhash:
        return RpcLatestBlockhash(public_key(91), 500)

    def simulate_transaction(
        self,
        transaction: bytes,
        commitment: str = "confirmed",
        signature_verification: bool = True,
    ) -> RpcSimulationResult:
        return RpcSimulationResult(None, ("Program log: fixture",), 1000, None, None, {"err": None})

    def send_transaction(
        self,
        transaction: bytes,
        commitment: str = "confirmed",
        skip_preflight: bool = False,
        maximum_retries: int = 5,
    ) -> str:
        return public_key(92)

    def get_signature_status(self, signature: str) -> RpcSignatureStatus | None:
        return RpcSignatureStatus(101, 1, None, "confirmed")

    def get_block_height(self, commitment: str = "confirmed") -> int:
        return 101

    def get_transaction(self, signature: str, commitment: str = "confirmed") -> object | None:
        return {"slot": 101, "meta": {"err": None}}

    def get_chancery_events(self, signature: str, commitment: str = "confirmed") -> tuple[object, ...]:
        return ()


class IntentFixtureRpc(FixtureRpc):
    def __init__(self, action: str, mode: str) -> None:
        super().__init__(action)
        self.mode = mode
        self.principal_a_signer = keypair_from_secret_key_bytes(bytes([11]) * 32)
        self.principal_b_signer = keypair_from_secret_key_bytes(bytes([12]) * 32)
        self.executor_signer = keypair_from_secret_key_bytes(bytes([13]) * 32)
        self.principal_a = self.principal_a_signer.public_key
        self.principal_b = (
            self.principal_b_signer.public_key if mode == "trilateral" else self.principal_a
        )
        self.executor = self.executor_signer.public_key
        self.asset_mint = public_key(41)
        self.issued_token_mint = public_key(42)
        self.pathway_id = bytes([43 if mode == "delegated" else 44]) * 32
        self.intent_id = bytes([45 if action == "mint" else 46]) * 32
        self.policy_id = bytes([47 if mode == "delegated" else 48]) * 32
        pathway_pda = derive_pathway_policy_address(self.pathway_id)
        intent_pda = derive_settlement_intent_address(self.intent_id)
        settlement_policy_pda = derive_settlement_policy_address(self.policy_id)
        self.pathway_address = pathway_pda.address
        self.intent_address = intent_pda.address
        self.settlement_policy_address = settlement_policy_pda.address
        self.lookup_table_address = public_key(49)
        self.asset_config_address = derive_asset_config_address(self.asset_mint).address
        self.mint_authority = derive_singleton_address(
            "mint_authority_pda", "mint-authority"
        ).address
        self.reserve_authority = derive_singleton_address(
            "reserve_authority_pda", "reserve-authority"
        ).address
        self.reserve_token = derive_associated_token_address(
            self.reserve_authority, self.asset_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        source_mint = self.asset_mint if action == "mint" else self.issued_token_mint
        destination_mint = self.issued_token_mint if action == "mint" else self.asset_mint
        destination_owner = self.principal_b if mode == "trilateral" else self.principal_a
        self.source_token = derive_associated_token_address(
            self.principal_a, source_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        self.destination_token = derive_associated_token_address(
            destination_owner, destination_mint, SPL_TOKEN_PROGRAM_ADDRESS
        ).address
        self.accounts = {
            known_pda_address("module_activation_state"): chancery_account(
                "ModuleActivationState",
                account_values(
                    "ModuleActivationState",
                    {"version": 1, "module_statuses": active_module_statuses()},
                ),
            ),
            known_pda_address("chancery_config"): chancery_account(
                "ChanceryConfig",
                account_values(
                    "ChanceryConfig",
                    {
                        "version": 1,
                        "issued_token_mint": self.issued_token_mint,
                        "issued_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "mint_authority_pda": self.mint_authority,
                    },
                ),
            ),
            known_pda_address("pause_state"): chancery_account(
                "PauseState", account_values("PauseState", {"version": 1})
            ),
            self.asset_config_address: chancery_account(
                "AssetConfig",
                account_values(
                    "AssetConfig",
                    {
                        "version": 1,
                        "asset_mint": self.asset_mint,
                        "asset_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "deposit_rate_e9": 1_000_000_000,
                        "redeem_rate_e9": 1_000_000_000,
                        "minimum_deposit_amount": 1,
                        "minimum_redeem_amount": 1,
                    },
                ),
            ),
            known_pda_address("issued_token_control"): chancery_account(
                "IssuedTokenControl",
                account_values(
                    "IssuedTokenControl",
                    {
                        "version": 1,
                        "issued_token_mint": self.issued_token_mint,
                        "issued_token_program": SPL_TOKEN_PROGRAM_ADDRESS,
                        "mint_authority_pda": self.mint_authority,
                        "control_flags": 1 << 63,
                    },
                ),
            ),
            self.pathway_address: chancery_account(
                "PathwayPolicy",
                account_values(
                    "PathwayPolicy",
                    {
                        "version": 1,
                        "bump": pathway_pda.bump,
                        "pathway_kind": 1 if mode == "delegated" else 2,
                        "pathway_id": self.pathway_id,
                        "asset_mint": self.asset_mint,
                        "issued_token_mint": self.issued_token_mint,
                        "designated_executor": self.executor,
                        "status_flags": 1,
                    },
                ),
            ),
            self.intent_address: chancery_account(
                "SettlementIntent",
                account_values(
                    "SettlementIntent",
                    {
                        "version": 1,
                        "bump": intent_pda.bump,
                        "status": 0,
                        "settlement_mode": 1 if mode == "delegated" else 2,
                        "settlement_action": 0 if action == "mint" else 1,
                        "intent_id": self.intent_id,
                        "principal_a": self.principal_a,
                        "principal_b": self.principal_b,
                        "executor": self.executor,
                        "asset_mint": self.asset_mint,
                        "issued_token_mint": self.issued_token_mint,
                        "asset_amount": 1000,
                        "issued_token_amount": 1000,
                        "minimum_asset_amount": 900,
                        "minimum_issued_token_amount": 900,
                        "nonce": 1,
                        "policy_id": self.policy_id,
                        "pathway_id": self.pathway_id,
                        "rent_refund_recipient": self.principal_a,
                    },
                ),
            ),
            self.settlement_policy_address: chancery_account(
                "SettlementPolicy",
                account_values(
                    "SettlementPolicy",
                    {
                        "version": 1,
                        "bump": settlement_policy_pda.bump,
                        "policy_id": self.policy_id,
                        "allowed_settlement_modes": 1 << (1 if mode == "delegated" else 2),
                        "allowed_asset_mint": self.asset_mint,
                        "allowed_principal_a": self.principal_a,
                        "allowed_principal_b": self.principal_b,
                        "designated_executor": self.executor,
                        "min_notional": 1,
                        "max_notional": 10_000,
                    },
                ),
            ),
            self.asset_mint: token_mint_account(5_000_000),
            self.issued_token_mint: token_mint_account(10_000_000),
            self.source_token: token_account(source_mint, self.principal_a, 1_000_000),
            self.destination_token: token_account(destination_mint, destination_owner, 0),
            self.reserve_token: token_account(
                self.asset_mint, self.reserve_authority, 1_000_000
            ),
        }
        principal_role = (
            ROLE_CAN_MINT_DELEGATED if action == "mint" else ROLE_CAN_REDEEM_DELEGATED
        )
        self._set_permission(self.principal_a, principal_role)
        if mode == "trilateral":
            self._set_permission(self.principal_b, ROLE_CAN_USE_TRILATERAL_PATHWAY)
        self._set_permission(self.executor, ROLE_CAN_EXECUTE_SETTLEMENT)

    def _set_permission(self, subject: str, role: int) -> None:
        permission_address = derive_permission_record_address(
            subject, SCOPE_PATHWAY, self.pathway_address
        ).address
        self.accounts[permission_address] = chancery_account(
            "PermissionRecord",
            account_values(
                "PermissionRecord",
                {
                    "version": 1,
                    "scope_kind": SCOPE_PATHWAY,
                    "subject": subject,
                    "scope_key": self.pathway_address,
                    "role_bits": [role, 0],
                    "role_schema_version": 1,
                },
            ),
        )

    def install_lookup_table(self, addresses: tuple[str, ...]) -> None:
        unique_addresses = tuple(dict.fromkeys(addresses))
        data = bytearray(56 + len(unique_addresses) * 32)
        data[0:4] = (1).to_bytes(4, "little")
        for index, address in enumerate(unique_addresses):
            start = 56 + index * 32
            data[start : start + 32] = decode_public_key(address)
        self.accounts[self.lookup_table_address] = RpcAccountInfo(
            data=bytes(data),
            executable=False,
            lamports=1,
            owner=public_key(50),
            rent_epoch=0,
            space=len(data),
        )


class ChanceryClientTests(unittest.TestCase):
    def test_python_ed25519_matches_rfc_8032_vector(self) -> None:
        from chancery_reference.solana_transaction import sign_message_with_keypair

        seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        keypair = keypair_from_secret_key_bytes(seed)
        self.assertEqual(
            decode_public_key(keypair.public_key).hex(),
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        )
        self.assertEqual(
            sign_message_with_keypair(b"", keypair).hex(),
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555"
            "fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        )

    def test_token_2022_transfer_fee_decoding_selects_epoch_and_applies_cap(self) -> None:
        mint = decode_token_mint(
            token_2022_mint_with_transfer_fee(0, 500, 100, 20, 2_000, 200)
        )
        self.assertIsNotNone(mint.transfer_fee_config)
        if mint.transfer_fee_config is None:
            raise AssertionError("Transfer-fee configuration was not decoded")
        self.assertEqual(
            mint.transfer_fee_config.older_transfer_fee.transfer_fee_basis_points,
            100,
        )
        self.assertEqual(
            mint.transfer_fee_config.newer_transfer_fee.transfer_fee_basis_points,
            200,
        )
        older = calculate_token_transfer_fee(101, mint.transfer_fee_config, 10)
        self.assertEqual(older.fee_amount, 2)
        self.assertEqual(older.received_amount, 99)
        newer = calculate_token_transfer_fee(200_000, mint.transfer_fee_config, 20)
        self.assertEqual(newer.fee_amount, 2_000)
        self.assertEqual(newer.received_amount, 198_000)

    def test_limit_observations_use_action_accumulators_and_period_rollover(self) -> None:
        policy = account_values(
            "LimitPolicy",
            {
                "per_transaction_maximum": 1_000,
                "per_day_maximum": 1_000,
                "maximum_actions_per_day": 3,
            },
        )
        live_window = account_values(
            "UsageWindow",
            {
                "window_start_unix_timestamp": 86_400,
                "gross_in": [400, 0],
                "gross_output_amount": [700, 0],
                "action_count": 1,
            },
        )
        mint = observe_limit_policy(
            policy,
            "mint",
            100,
            {"daily": live_window},
            90_000,
        )
        mint_daily = next(window for window in mint.windows if window.name == "daily")
        self.assertEqual(mint.accumulator_field, "gross_in")
        self.assertEqual(mint_daily.current_amount, 400)
        self.assertEqual(mint_daily.remaining_before, 600)
        self.assertEqual(mint_daily.remaining_after, 500)
        self.assertEqual(mint_daily.action_remaining_after, 1)

        redeem = observe_limit_policy(
            policy,
            "redeem",
            100,
            {"daily": live_window},
            90_000,
        )
        redeem_daily = next(window for window in redeem.windows if window.name == "daily")
        self.assertEqual(redeem.accumulator_field, "gross_output_amount")
        self.assertEqual(redeem_daily.current_amount, 700)
        self.assertEqual(redeem_daily.remaining_after, 200)

        stale_window = account_values(
            "UsageWindow",
            {
                "window_start_unix_timestamp": 0,
                "gross_in": [999, 0],
                "action_count": 3,
            },
        )
        rolled = observe_limit_policy(
            policy,
            "mint",
            100,
            {"daily": stale_window},
            90_000,
        )
        rolled_daily = next(window for window in rolled.windows if window.name == "daily")
        self.assertTrue(rolled_daily.rolled_before_check)
        self.assertEqual(rolled_daily.current_amount, 0)
        self.assertEqual(rolled_daily.current_action_count, 0)
        self.assertTrue(rolled_daily.allowed)

        future_window = account_values(
            "UsageWindow",
            {"window_start_unix_timestamp": 172_800},
        )
        regressed = observe_limit_policy(
            policy,
            "mint",
            100,
            {"daily": future_window},
            90_000,
        )
        regressed_daily = next(window for window in regressed.windows if window.name == "daily")
        self.assertTrue(regressed_daily.clock_regression)
        self.assertFalse(regressed_daily.allowed)
        self.assertFalse(regressed_daily.action_allowed)

    def test_effective_quotes_include_asset_transfer_fees(self) -> None:
        asset_values = account_values(
            "AssetConfig",
            {
                "deposit_rate_e9": 1_000_000_000,
                "redeem_rate_e9": 1_000_000_000,
            },
        )
        mint_values = decode_token_mint(
            token_2022_mint_with_transfer_fee(0, 10_000, 100, 20, 10_000, 200)
        )
        mint_fee_policy = account_values(
            "FeePolicy",
            {
                "fee_policy_flags": FEE_ACTIVE | FEE_IN_ISSUED_TOKEN,
                "flat_fee_in_issued_token": 100,
                "fee_recipient_key": ZERO_ADDRESS,
                "net_fee_floor_zero": 1,
            },
        )
        mint = compute_settlement_effective_quote(
            "mint",
            10_000,
            asset_values,
            mint_values,
            mint_fee_policy,
            1_000,
            10,
        )
        self.assertEqual(mint.effective_quote.input_asset_transfer.fee_amount, 100)
        self.assertEqual(mint.gross_output, 9_900)
        self.assertEqual(mint.effective_quote.chancery_fee_amount, 100)
        self.assertEqual(mint.effective_quote.principal_received_amount, 9_800)
        self.assertEqual(mint.effective_quote.all_in_output_reduction, 200)
        self.assertEqual(mint.effective_quote.all_in_fee_basis_points, 200)

        redeem_fee_policy = account_values(
            "FeePolicy",
            {
                "fee_policy_flags": FEE_ACTIVE | FEE_IN_ASSET,
                "flat_fee_in_asset": 100,
                "fee_recipient_policy": 1,
                "fee_recipient_key": public_key(99),
                "net_fee_floor_zero": 1,
            },
        )
        redeem = compute_settlement_effective_quote(
            "redeem",
            10_000,
            asset_values,
            mint_values,
            redeem_fee_policy,
            1_000,
            10,
        )
        self.assertEqual(redeem.gross_output, 10_000)
        self.assertEqual(redeem.effective_quote.output_before_principal_transfer, 9_900)
        self.assertEqual(redeem.effective_quote.principal_asset_transfer.fee_amount, 99)
        self.assertEqual(redeem.effective_quote.principal_received_amount, 9_801)
        self.assertIsNotNone(redeem.effective_quote.routed_fee_transfer)
        if redeem.effective_quote.routed_fee_transfer is None:
            raise AssertionError("Routed fee transfer was not calculated")
        self.assertEqual(redeem.effective_quote.routed_fee_transfer.fee_amount, 1)
        self.assertEqual(redeem.effective_quote.fee_recipient_received_amount, 99)

    def test_deployment_discovery_inventories_and_links_chancery_accounts(self) -> None:
        rpc = FixtureRpc("mint")
        remote_domain_id = 771
        remote_chain_kind = 5
        remote_nonce_scope_key = bytes([63]) * 32
        remote_domain_policy = derive_remote_domain_policy_address(
            remote_chain_kind,
            remote_domain_id,
        )
        remote_nonce = derive_remote_nonce_address(
            remote_chain_kind,
            remote_domain_id,
            remote_nonce_scope_key,
        )
        rpc.accounts[remote_domain_policy.address] = chancery_account(
            "RemoteDomainPolicy",
            account_values(
                "RemoteDomainPolicy",
                {
                    "version": 1,
                    "bump": remote_domain_policy.bump,
                    "remote_chain_kind": remote_chain_kind,
                    "remote_domain_id": remote_domain_id,
                },
            ),
        )
        rpc.accounts[remote_nonce.address] = chancery_account(
            "RemoteNonce",
            account_values(
                "RemoteNonce",
                {
                    "version": 1,
                    "bump": remote_nonce.bump,
                    "remote_domain_id": remote_domain_id,
                    "scope_key": remote_nonce_scope_key,
                },
            ),
        )
        client = ChanceryClient(rpc)
        discovery = client.discover()
        self.assertIsNotNone(discovery.chancery_config)
        self.assertIsNotNone(discovery.issued_token_control)
        self.assertEqual(len(discovery.assets), 1)
        self.assertEqual(discovery.assets[0].asset_mint, rpc.asset_mint)
        self.assertEqual(len(discovery.assets[0].pathways), 1)
        self.assertEqual(discovery.pathways[0].address, rpc.pathway_address)
        self.assertEqual(len(discovery.accounts_by_type["PermissionRecord"]), 1)
        self.assertFalse(
            discovery.settlement_limit_model.global_settlement_volume_accumulator_exists
        )
        self.assertEqual(
            discovery.settlement_limit_model.volume_scopes,
            ("pathway", "asset", "counterparty", "executor"),
        )
        mint_authority = next(
            (entry for entry in discovery.known_pdas if entry.name == "mint_authority_pda"),
            None,
        )
        self.assertIsNotNone(mint_authority)
        if mint_authority is None:
            raise AssertionError("Mint-authority PDA was not included")
        self.assertEqual(mint_authority.address, rpc.mint_authority)
        discovered_remote_nonce = discovery.accounts_by_type["RemoteNonce"][0]
        self.assertIsNotNone(discovered_remote_nonce.canonical_pda)
        if discovered_remote_nonce.canonical_pda is None:
            raise AssertionError("Remote nonce canonical PDA was not resolved")
        self.assertTrue(discovered_remote_nonce.canonical_pda.address_matches)
        self.assertTrue(discovered_remote_nonce.canonical_pda.stored_bump_matches)
        self.assertEqual(client.decode_transaction_evidence(public_key(92)), ())

    def test_all_chancery_account_pda_families_use_canonical_seed_encodings(self) -> None:
        signer_set_id = bytes([43]) * 32
        change_id = bytes([44]) * 32
        scope_key = bytes([45]) * 32
        issued_token_account = public_key(46)
        asset_mint = public_key(47)
        destination_token_account = public_key(48)
        remote_domain_id = 0x0102_0304_0506_0708
        source_nonce = 0x1112_1314_1516_1718
        vectors = (
            (
                derive_authority_transfer_address(7),
                (b"authority-transfer", bytes([7])),
            ),
            (
                derive_basic_freeze_record_address(issued_token_account),
                (b"basic-freeze-record", decode_public_key(issued_token_account)),
            ),
            (
                derive_cross_chain_signer_set_address(signer_set_id),
                (b"cross-chain-signer-set", signer_set_id),
            ),
            (
                derive_outbound_reclaim_record_address(2, remote_domain_id, source_nonce),
                (
                    b"outbound-reclaim",
                    bytes([2]),
                    remote_domain_id.to_bytes(8, "big"),
                    source_nonce.to_bytes(8, "big"),
                ),
            ),
            (
                derive_pending_config_change_address(change_id),
                (b"pending-config-change", change_id),
            ),
            (
                derive_remote_domain_policy_address(3, remote_domain_id),
                (
                    b"remote-domain-policy",
                    bytes([3]),
                    remote_domain_id.to_bytes(8, "big"),
                ),
            ),
            (
                derive_remote_nonce_address(4, remote_domain_id, scope_key),
                (
                    b"remote-nonce",
                    bytes([4]),
                    remote_domain_id.to_bytes(8, "big"),
                    scope_key,
                ),
            ),
            (
                derive_reserve_destination_address(asset_mint, destination_token_account),
                (
                    b"reserve-destination",
                    decode_public_key(asset_mint),
                    decode_public_key(destination_token_account),
                ),
            ),
        )
        for actual, seeds in vectors:
            expected = find_program_address(seeds, CHANCERY_PROGRAM_ADDRESS)
            self.assertEqual(actual.address, expected.address)
            self.assertEqual(actual.bump, expected.bump)

    def test_direct_mint_resolves_and_builds_complete_transaction(self) -> None:
        self._assert_direct_operation("mint", "mint_direct")

    def test_direct_redeem_resolves_and_builds_complete_transaction(self) -> None:
        self._assert_direct_operation("redeem", "redeem_direct")

    def test_delegated_mint_resolves_intent_and_builds_version_zero_transaction(self) -> None:
        self._assert_intent_operation("mint", "delegated", "mint_delegated")

    def test_delegated_redeem_resolves_intent_and_builds_version_zero_transaction(self) -> None:
        self._assert_intent_operation("redeem", "delegated", "redeem_delegated")

    def test_trilateral_mint_resolves_parties_and_builds_version_zero_transaction(self) -> None:
        self._assert_intent_operation("mint", "trilateral", "mint_trilateral")

    def test_trilateral_redeem_resolves_parties_and_builds_version_zero_transaction(self) -> None:
        self._assert_intent_operation("redeem", "trilateral", "redeem_trilateral")

    def _assert_direct_operation(self, action: str, expected_instruction_name: str) -> None:
        rpc = FixtureRpc(action)
        client = ChanceryClient(rpc)
        inspection = client.inspect(
            SettlementOperationRequest(
                action=action,
                mode="direct",
                asset_mint=rpc.asset_mint,
                principal=rpc.principal,
                amount=1000,
                now_unix_timestamp=1000,
            )
        )
        self.assertTrue(inspection.ready, inspection.blocking_issues)
        self.assertEqual(inspection.instruction_name, expected_instruction_name)
        self.assertEqual(inspection.amounts.gross_output, 1000)
        self.assertEqual(inspection.amounts.minimum_output, 1000)
        self.assertEqual(inspection.pathway.address, rpc.pathway_address)
        self.assertEqual(inspection.token_accounts["reserve"].address, rpc.reserve_token)
        instruction = client.build_instruction(inspection)
        expected_schema = CHANCERY_SCHEMA["instructions"][expected_instruction_name]
        self.assertIsInstance(expected_schema, dict)
        expected_accounts = expected_schema["accounts"]
        self.assertIsInstance(expected_accounts, list)
        self.assertEqual(
            [account.name for account in instruction.accounts],
            [account["name"] for account in expected_accounts],
        )
        prepared = client.prepare_transaction(
            inspection,
            SettlementTransactionRequest(
                fee_payer=rpc.principal,
                keypairs=(rpc.signer,),
                commitment="confirmed",
            ),
        )
        self.assertGreater(len(prepared.transaction.bytes), 100)
        self.assertEqual(prepared.transaction.primary_signature, encode_base58(next(iter(prepared.transaction.signatures.values()))))
        simulated = client.simulate_transaction(
            inspection,
            SettlementTransactionRequest(
                fee_payer=rpc.principal,
                keypairs=(rpc.signer,),
                commitment="confirmed",
            ),
        )
        self.assertIsNone(simulated.simulation.error)
        submitted = client.submit_transaction(
            inspection,
            SettlementTransactionRequest(
                fee_payer=rpc.principal,
                keypairs=(rpc.signer,),
                commitment="confirmed",
            ),
        )
        self.assertEqual(submitted.status.confirmation_status, "confirmed")

    def _assert_intent_operation(
        self,
        action: str,
        mode: str,
        expected_instruction_name: str,
    ) -> None:
        rpc = IntentFixtureRpc(action, mode)
        client = ChanceryClient(rpc)
        inspection = client.inspect(
            SettlementOperationRequest(
                action=action,
                mode=mode,
                asset_mint=rpc.asset_mint,
                principal=rpc.principal_a,
                principal_b=rpc.principal_b,
                executor=rpc.executor,
                intent_id=rpc.intent_id,
                now_unix_timestamp=1000,
            )
        )
        self.assertTrue(inspection.ready, inspection.blocking_issues)
        self.assertEqual(inspection.instruction_name, expected_instruction_name)
        self.assertIsNotNone(inspection.intent)
        if inspection.intent is None:
            raise AssertionError("Settlement intent was not resolved")
        self.assertEqual(inspection.intent.address, rpc.intent_address)
        settlement_policy = inspection.policies["settlement_policy"]
        self.assertIsNotNone(settlement_policy)
        if settlement_policy is None:
            raise AssertionError("Settlement policy was not resolved")
        self.assertEqual(settlement_policy.address, rpc.settlement_policy_address)
        self.assertIsNotNone(inspection.settlement_policy_observation)
        if inspection.settlement_policy_observation is None:
            raise AssertionError("Settlement policy observation was not produced")
        self.assertTrue(inspection.settlement_policy_observation.usable)
        self.assertEqual(inspection.amounts.input_amount, 1000)
        self.assertEqual(inspection.amounts.minimum_output, 900)

        instruction = client.build_instruction(inspection)
        instructions = CHANCERY_SCHEMA["instructions"]
        if not isinstance(instructions, dict):
            raise AssertionError("Instruction schema is invalid")
        expected_schema = instructions[expected_instruction_name]
        if not isinstance(expected_schema, dict):
            raise AssertionError("Expected instruction schema is invalid")
        expected_accounts = expected_schema["accounts"]
        if not isinstance(expected_accounts, list):
            raise AssertionError("Expected instruction account schema is invalid")
        self.assertEqual(
            [account.name for account in instruction.accounts],
            [account["name"] for account in expected_accounts],
        )
        rpc.install_lookup_table(
            tuple(account.address for account in instruction.accounts if not account.is_signer)
        )
        keypairs = (
            (rpc.executor_signer,)
            if mode == "delegated"
            else (rpc.executor_signer, rpc.principal_a_signer, rpc.principal_b_signer)
        )
        transaction_request = SettlementTransactionRequest(
            fee_payer=rpc.executor,
            keypairs=keypairs,
            address_lookup_table_addresses=(rpc.lookup_table_address,),
            commitment="confirmed",
        )
        prepared = client.prepare_transaction(inspection, transaction_request)
        self.assertEqual(prepared.transaction.message.version, 0)
        self.assertLessEqual(len(prepared.transaction.bytes), 1232)
        simulated = client.simulate_transaction(inspection, transaction_request)
        self.assertIsNone(simulated.simulation.error)
        submitted = client.submit_transaction(inspection, transaction_request)
        self.assertEqual(submitted.status.confirmation_status, "confirmed")

    def test_settlement_instruction_account_counts_are_exact(self) -> None:
        instructions = CHANCERY_SCHEMA["instructions"]
        if not isinstance(instructions, dict):
            raise AssertionError("Instruction schema is invalid")
        expected_counts = {
            "mint_direct": 31,
            "redeem_direct": 31,
            "mint_delegated": 38,
            "redeem_delegated": 38,
            "mint_trilateral": 41,
            "redeem_trilateral": 41,
        }
        for instruction_name, expected_count in expected_counts.items():
            instruction_schema = instructions[instruction_name]
            if not isinstance(instruction_schema, dict):
                raise AssertionError(f"{instruction_name} schema is invalid")
            accounts = instruction_schema["accounts"]
            if not isinstance(accounts, list):
                raise AssertionError(f"{instruction_name} accounts are invalid")
            self.assertEqual(len(accounts), expected_count)


if __name__ == "__main__":
    unittest.main()
