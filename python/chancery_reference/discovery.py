from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from .account import DecodedChanceryAccount, decode_chancery_account
from .chancery_protocol import (
    NamedProgramAddress,
    bytes32_hex,
    derive_authority_transfer_address,
    derive_asset_config_address,
    derive_asset_pause_state_address,
    derive_basic_freeze_record_address,
    derive_cross_chain_signer_set_address,
    derive_evidence_policy_address,
    derive_fee_policy_address,
    derive_limit_policy_address,
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
    derive_usage_window_address,
    known_pda_address,
    require_bytes,
    require_int_field,
    require_public_key_field,
)
from .rpc import ChanceryRpc, RpcAccountInfo, RpcCommitment
from .schema import CHANCERY_PROGRAM_ADDRESS, CHANCERY_SCHEMA


@dataclass(frozen=True)
class ChanceryCanonicalPdaObservation:
    expected_address: str
    bump: int
    seeds: tuple[str, ...]
    address_matches: bool
    stored_bump: int | None
    stored_bump_matches: bool | None


@dataclass(frozen=True)
class DiscoveredChanceryAccount:
    address: str
    name: str
    values: dict[str, object]
    owner: str
    lamports: int
    data_length: int
    canonical_pda: ChanceryCanonicalPdaObservation | None


@dataclass(frozen=True)
class UnrecognizedChanceryAccount:
    address: str
    byte_length: int
    discriminator_hex: str


@dataclass(frozen=True)
class ChanceryKnownPdaInventory:
    name: str
    address: str
    kind: str
    present: bool
    account_name: str | None


@dataclass(frozen=True)
class ChanceryPathwayInventory:
    address: str
    pathway_id: str
    pathway_kind: int
    asset_mint: str
    issued_token_mint: str
    designated_executor: str
    status_flags: int
    fee_policy: DiscoveredChanceryAccount | None
    pathway_limit_policy: DiscoveredChanceryAccount | None
    asset_mint_limit_policy: DiscoveredChanceryAccount | None
    asset_redeem_limit_policy: DiscoveredChanceryAccount | None
    counterparty_limit_policy: DiscoveredChanceryAccount | None
    executor_limit_policy: DiscoveredChanceryAccount | None
    evidence_policy: DiscoveredChanceryAccount | None
    reserve_destinations: tuple[DiscoveredChanceryAccount, ...]


@dataclass(frozen=True)
class ChanceryAssetInventory:
    asset_config: DiscoveredChanceryAccount
    asset_pause_state: DiscoveredChanceryAccount | None
    asset_mint: str
    asset_token_program: str
    deposit_rate_e9: int
    redeem_rate_e9: int
    pathways: tuple[ChanceryPathwayInventory, ...]
    reserve_destinations: tuple[DiscoveredChanceryAccount, ...]


@dataclass(frozen=True)
class ChancerySettlementLimitModel:
    volume_scopes: tuple[str, str, str, str]
    global_settlement_volume_accumulator_exists: bool
    global_pause_account: str


@dataclass(frozen=True)
class ChanceryStateDiscovery:
    program_address: str
    commitment: RpcCommitment
    account_count: int
    recognized_accounts: tuple[DiscoveredChanceryAccount, ...]
    accounts_by_type: dict[str, tuple[DiscoveredChanceryAccount, ...]]
    unrecognized_accounts: tuple[UnrecognizedChanceryAccount, ...]
    known_pdas: tuple[ChanceryKnownPdaInventory, ...]
    chancery_config: DiscoveredChanceryAccount | None
    issued_token_control: DiscoveredChanceryAccount | None
    assets: tuple[ChanceryAssetInventory, ...]
    pathways: tuple[ChanceryPathwayInventory, ...]
    settlement_limit_model: ChancerySettlementLimitModel


def discover_chancery_state(
    rpc: ChanceryRpc,
    commitment: RpcCommitment = "confirmed",
) -> ChanceryStateDiscovery:
    program_accounts = rpc.get_program_accounts(CHANCERY_PROGRAM_ADDRESS, [], commitment)
    recognized_accounts: list[DiscoveredChanceryAccount] = []
    unrecognized_accounts: list[UnrecognizedChanceryAccount] = []
    for program_account in program_accounts:
        _validate_program_account(program_account.address, program_account.account)
        try:
            decoded: DecodedChanceryAccount = decode_chancery_account(program_account.account.data)
        except ValueError as error:
            if str(error) != "Unknown Chancery account discriminator":
                raise
            unrecognized_accounts.append(
                UnrecognizedChanceryAccount(
                    address=program_account.address,
                    byte_length=len(program_account.account.data),
                    discriminator_hex="0x" + program_account.account.data[:8].hex(),
                )
            )
            continue
        recognized_accounts.append(
            DiscoveredChanceryAccount(
                address=program_account.address,
                name=decoded.name,
                values=decoded.values,
                owner=program_account.account.owner,
                lamports=program_account.account.lamports,
                data_length=len(program_account.account.data),
                canonical_pda=_observe_canonical_pda(
                    program_account.address,
                    decoded.name,
                    decoded.values,
                ),
            )
        )
    remote_domain_policies = tuple(
        account for account in recognized_accounts if account.name == "RemoteDomainPolicy"
    )
    for index, account in enumerate(recognized_accounts):
        if account.name != "RemoteNonce":
            continue
        recognized_accounts[index] = DiscoveredChanceryAccount(
            address=account.address,
            name=account.name,
            values=account.values,
            owner=account.owner,
            lamports=account.lamports,
            data_length=account.data_length,
            canonical_pda=_observe_canonical_pda(
                account.address,
                account.name,
                account.values,
                remote_domain_policies,
            ),
        )
    recognized_accounts.sort(key=lambda account: (account.name, account.address))
    unrecognized_accounts.sort(key=lambda account: account.address)
    accounts_by_type = _group_accounts_by_type(recognized_accounts)
    fee_index = _index_accounts_by_bytes32(accounts_by_type.get("FeePolicy", ()), "fee_policy_id")
    limit_index = _index_accounts_by_bytes32(accounts_by_type.get("LimitPolicy", ()), "limit_policy_id")
    evidence_index = _index_accounts_by_bytes32(
        accounts_by_type.get("EvidencePolicy", ()),
        "evidence_policy_id",
    )
    reserve_destinations = accounts_by_type.get("ReserveDestination", ())
    pathways = tuple(
        sorted(
            (
                _build_pathway_inventory(
                    pathway,
                    fee_index,
                    limit_index,
                    evidence_index,
                    reserve_destinations,
                )
                for pathway in accounts_by_type.get("PathwayPolicy", ())
            ),
            key=lambda pathway: pathway.address,
        )
    )
    assets_list: list[ChanceryAssetInventory] = []
    asset_pause_states = accounts_by_type.get("AssetPauseState", ())
    for asset_config in accounts_by_type.get("AssetConfig", ()):
        asset_mint = require_public_key_field(asset_config.values, "asset_mint")
        assets_list.append(
            ChanceryAssetInventory(
                asset_config=asset_config,
                asset_pause_state=_find_by_public_key_field(
                    asset_pause_states,
                    "asset_mint",
                    asset_mint,
                ),
                asset_mint=asset_mint,
                asset_token_program=require_public_key_field(
                    asset_config.values,
                    "asset_token_program",
                ),
                deposit_rate_e9=require_int_field(asset_config.values, "deposit_rate_e9"),
                redeem_rate_e9=require_int_field(asset_config.values, "redeem_rate_e9"),
                pathways=tuple(pathway for pathway in pathways if pathway.asset_mint == asset_mint),
                reserve_destinations=tuple(
                    destination
                    for destination in reserve_destinations
                    if require_public_key_field(destination.values, "asset_mint") == asset_mint
                ),
            )
        )
    assets = tuple(sorted(assets_list, key=lambda asset: asset.asset_mint))
    by_address = {account.address: account for account in recognized_accounts}
    return ChanceryStateDiscovery(
        program_address=CHANCERY_PROGRAM_ADDRESS,
        commitment=commitment,
        account_count=len(program_accounts),
        recognized_accounts=tuple(recognized_accounts),
        accounts_by_type=accounts_by_type,
        unrecognized_accounts=tuple(unrecognized_accounts),
        known_pdas=_build_known_pda_inventory(by_address),
        chancery_config=_first_account(accounts_by_type.get("ChanceryConfig", ())),
        issued_token_control=_first_account(accounts_by_type.get("IssuedTokenControl", ())),
        assets=assets,
        pathways=pathways,
        settlement_limit_model=ChancerySettlementLimitModel(
            volume_scopes=("pathway", "asset", "counterparty", "executor"),
            global_settlement_volume_accumulator_exists=False,
            global_pause_account=known_pda_address("pause_state"),
        ),
    )


def _build_pathway_inventory(
    pathway: DiscoveredChanceryAccount,
    fee_index: dict[str, DiscoveredChanceryAccount],
    limit_index: dict[str, DiscoveredChanceryAccount],
    evidence_index: dict[str, DiscoveredChanceryAccount],
    reserve_destinations: tuple[DiscoveredChanceryAccount, ...],
) -> ChanceryPathwayInventory:
    asset_mint = require_public_key_field(pathway.values, "asset_mint")
    return ChanceryPathwayInventory(
        address=pathway.address,
        pathway_id=bytes32_hex(pathway.values.get("pathway_id"), "pathway id"),
        pathway_kind=require_int_field(pathway.values, "pathway_kind"),
        asset_mint=asset_mint,
        issued_token_mint=require_public_key_field(pathway.values, "issued_token_mint"),
        designated_executor=require_public_key_field(pathway.values, "designated_executor"),
        status_flags=require_int_field(pathway.values, "status_flags"),
        fee_policy=_linked_policy(fee_index, pathway.values.get("fee_policy_id"), "fee policy id"),
        pathway_limit_policy=_linked_policy(
            limit_index,
            pathway.values.get("limit_policy_id"),
            "limit policy id",
        ),
        asset_mint_limit_policy=_linked_policy(
            limit_index,
            pathway.values.get("asset_mint_limit_policy_id"),
            "asset mint limit policy id",
        ),
        asset_redeem_limit_policy=_linked_policy(
            limit_index,
            pathway.values.get("asset_redeem_limit_policy_id"),
            "asset redeem limit policy id",
        ),
        counterparty_limit_policy=_linked_policy(
            limit_index,
            pathway.values.get("counterparty_limit_policy_id"),
            "counterparty limit policy id",
        ),
        executor_limit_policy=_linked_policy(
            limit_index,
            pathway.values.get("executor_limit_policy_id"),
            "executor limit policy id",
        ),
        evidence_policy=_linked_policy(
            evidence_index,
            pathway.values.get("evidence_policy_id"),
            "evidence policy id",
        ),
        reserve_destinations=tuple(
            destination
            for destination in reserve_destinations
            if require_public_key_field(destination.values, "asset_mint") == asset_mint
        ),
    )


def _observe_canonical_pda(
    actual_address: str,
    account_name: str,
    values: dict[str, object],
    remote_domain_policies: tuple[DiscoveredChanceryAccount, ...] = (),
) -> ChanceryCanonicalPdaObservation | None:
    derived = (
        _derive_remote_nonce_canonical_pda(actual_address, values, remote_domain_policies)
        if account_name == "RemoteNonce"
        else _derive_canonical_pda(account_name, values)
    )
    if derived is None:
        return None
    stored_bump_value = values.get("bump")
    stored_bump = stored_bump_value if isinstance(stored_bump_value, int) and not isinstance(stored_bump_value, bool) else None
    return ChanceryCanonicalPdaObservation(
        expected_address=derived.address,
        bump=derived.bump,
        seeds=derived.seeds,
        address_matches=derived.address == actual_address,
        stored_bump=stored_bump,
        stored_bump_matches=None if stored_bump is None else stored_bump == derived.bump,
    )


def _derive_canonical_pda(
    account_name: str,
    values: dict[str, object],
) -> NamedProgramAddress | None:
    if account_name == "AuthorityTransfer":
        return derive_authority_transfer_address(require_int_field(values, "role_kind"))
    if account_name == "AssetConfig":
        return derive_asset_config_address(require_public_key_field(values, "asset_mint"))
    if account_name == "AssetPauseState":
        return derive_asset_pause_state_address(require_public_key_field(values, "asset_mint"))
    if account_name == "BasicFreezeRecord":
        return derive_basic_freeze_record_address(
            require_public_key_field(values, "issued_token_account")
        )
    if account_name == "CrossChainSignerSet":
        return derive_cross_chain_signer_set_address(
            require_bytes(values.get("signer_set_id"), "signer set id", 32)
        )
    if account_name == "PathwayPolicy":
        return derive_pathway_policy_address(require_bytes(values.get("pathway_id"), "pathway id", 32))
    if account_name == "PermissionRecord":
        return derive_permission_record_address(
            require_public_key_field(values, "subject"),
            require_int_field(values, "scope_kind"),
            require_public_key_field(values, "scope_key"),
        )
    if account_name == "FeePolicy":
        return derive_fee_policy_address(require_bytes(values.get("fee_policy_id"), "fee policy id", 32))
    if account_name == "LimitPolicy":
        return derive_limit_policy_address(require_bytes(values.get("limit_policy_id"), "limit policy id", 32))
    if account_name == "EvidencePolicy":
        return derive_evidence_policy_address(
            require_bytes(values.get("evidence_policy_id"), "evidence policy id", 32)
        )
    if account_name == "OutboundReclaimRecord":
        return derive_outbound_reclaim_record_address(
            require_int_field(values, "remote_chain_kind"),
            require_int_field(values, "remote_domain_id"),
            require_int_field(values, "source_nonce"),
        )
    if account_name == "PendingConfigChange":
        return derive_pending_config_change_address(
            require_bytes(values.get("change_id"), "change id", 32)
        )
    if account_name == "RemoteDomainPolicy":
        return derive_remote_domain_policy_address(
            require_int_field(values, "remote_chain_kind"),
            require_int_field(values, "remote_domain_id"),
        )
    if account_name == "ReserveDestination":
        return derive_reserve_destination_address(
            require_public_key_field(values, "asset_mint"),
            require_public_key_field(values, "destination_token_account"),
        )
    if account_name == "UsageWindow":
        return derive_usage_window_address(
            require_bytes(values.get("scope_hash"), "scope hash", 32),
            require_int_field(values, "window_kind"),
        )
    if account_name == "SettlementIntent":
        return derive_settlement_intent_address(require_bytes(values.get("intent_id"), "intent id", 32))
    if account_name == "SettlementPolicy":
        return derive_settlement_policy_address(
            require_bytes(values.get("policy_id"), "settlement policy id", 32)
        )
    singleton = _singleton_for_account(account_name)
    if singleton is None:
        return None
    return derive_singleton_address(singleton[0], singleton[1])


def _derive_remote_nonce_canonical_pda(
    actual_address: str,
    values: dict[str, object],
    remote_domain_policies: tuple[DiscoveredChanceryAccount, ...],
) -> NamedProgramAddress | None:
    remote_domain_id = require_int_field(values, "remote_domain_id")
    scope_key = require_bytes(values.get("scope_key"), "remote nonce scope key", 32)
    candidates: list[NamedProgramAddress] = []
    for policy in remote_domain_policies:
        if require_int_field(policy.values, "remote_domain_id") != remote_domain_id:
            continue
        candidate = derive_remote_nonce_address(
            require_int_field(policy.values, "remote_chain_kind"),
            remote_domain_id,
            scope_key,
        )
        if candidate.address == actual_address:
            return candidate
        candidates.append(candidate)
    return candidates[0] if len(candidates) == 1 else None


def _singleton_for_account(account_name: str) -> tuple[str, str] | None:
    mapping = {
        "ModuleActivationState": ("module_activation_state", "module-activation-state"),
        "ChanceryConfig": ("chancery_config", "chancery-config"),
        "PauseState": ("pause_state", "pause-state"),
        "IssuedTokenControl": ("issued_token_control", "issued-token-control"),
    }
    return mapping.get(account_name)


def _build_known_pda_inventory(
    by_address: dict[str, DiscoveredChanceryAccount],
) -> tuple[ChanceryKnownPdaInventory, ...]:
    known_pdas_value = CHANCERY_SCHEMA.get("known_pdas")
    if not isinstance(known_pdas_value, dict):
        raise ValueError("Chancery schema known_pdas must be an object")
    inventory: list[ChanceryKnownPdaInventory] = []
    for name in sorted(cast(dict[str, object], known_pdas_value)):
        address = known_pda_address(name)
        account = by_address.get(address)
        inventory.append(
            ChanceryKnownPdaInventory(
                name=name,
                address=address,
                kind=_known_pda_kind(name),
                present=account is not None,
                account_name=None if account is None else account.name,
            )
        )
    mint_authority = derive_singleton_address("mint_authority_pda", "mint-authority")
    if not any(entry.name == mint_authority.name for entry in inventory):
        account = by_address.get(mint_authority.address)
        inventory.append(
            ChanceryKnownPdaInventory(
                name=mint_authority.name,
                address=mint_authority.address,
                kind="signer_pda",
                present=account is not None,
                account_name=None if account is None else account.name,
            )
        )
    inventory.sort(key=lambda entry: entry.name)
    return tuple(inventory)


def _known_pda_kind(name: str) -> str:
    if name in ("event_authority", "reserve_authority_pda", "mint_authority_pda"):
        return "signer_pda"
    return "state_account"


def _validate_program_account(address: str, account: RpcAccountInfo) -> None:
    if account.owner != CHANCERY_PROGRAM_ADDRESS:
        raise ValueError(
            f"Program account {address} is owned by {account.owner}; expected {CHANCERY_PROGRAM_ADDRESS}"
        )
    if account.executable:
        raise ValueError(f"Program account {address} must not be executable")


def _group_accounts_by_type(
    accounts: list[DiscoveredChanceryAccount],
) -> dict[str, tuple[DiscoveredChanceryAccount, ...]]:
    account_schemas_value = CHANCERY_SCHEMA.get("accounts")
    if not isinstance(account_schemas_value, dict):
        raise ValueError("Chancery schema accounts must be an object")
    grouped_lists: dict[str, list[DiscoveredChanceryAccount]] = {
        name: [] for name in sorted(cast(dict[str, object], account_schemas_value))
    }
    for account in accounts:
        entries = grouped_lists.get(account.name)
        if entries is None:
            raise ValueError(f"Decoded unknown Chancery account type: {account.name}")
        entries.append(account)
    return {name: tuple(entries) for name, entries in grouped_lists.items()}


def _index_accounts_by_bytes32(
    accounts: tuple[DiscoveredChanceryAccount, ...],
    field_name: str,
) -> dict[str, DiscoveredChanceryAccount]:
    result: dict[str, DiscoveredChanceryAccount] = {}
    for account in accounts:
        key = bytes32_hex(account.values.get(field_name), f"{account.name}.{field_name}")
        if key in result:
            raise ValueError(f"Duplicate {account.name}.{field_name}: {key}")
        result[key] = account
    return result


def _linked_policy(
    index: dict[str, DiscoveredChanceryAccount],
    identifier: object,
    label: str,
) -> DiscoveredChanceryAccount | None:
    identifier_bytes = require_bytes(identifier, label, 32)
    if not any(identifier_bytes):
        return None
    return index.get("0x" + identifier_bytes.hex())


def _find_by_public_key_field(
    accounts: tuple[DiscoveredChanceryAccount, ...],
    field_name: str,
    key: str,
) -> DiscoveredChanceryAccount | None:
    for account in accounts:
        if require_public_key_field(account.values, field_name) == key:
            return account
    return None


def _first_account(
    accounts: tuple[DiscoveredChanceryAccount, ...],
) -> DiscoveredChanceryAccount | None:
    return None if not accounts else accounts[0]
