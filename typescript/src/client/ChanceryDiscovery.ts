import { bytesToHex } from "../BinaryCodec.js";
import { decodeChanceryAccount, type DecodedChanceryAccount } from "../ChanceryAccount.js";
import {
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
} from "../ChancerySchema.js";
import {
    ChanceryRpc,
    type RpcAccountInfo,
    type RpcCommitment,
} from "../ChanceryRpc.js";
import {
    bytes32Hex,
    deriveAuthorityTransferAddress,
    deriveAssetConfigAddress,
    deriveAssetPauseStateAddress,
    deriveBasicFreezeRecordAddress,
    deriveCrossChainSignerSetAddress,
    deriveEvidencePolicyAddress,
    deriveFeePolicyAddress,
    deriveLimitPolicyAddress,
    deriveOutboundReclaimRecordAddress,
    derivePathwayPolicyAddress,
    derivePendingConfigChangeAddress,
    derivePermissionRecordAddress,
    deriveRemoteDomainPolicyAddress,
    deriveRemoteNonceAddress,
    deriveReserveDestinationAddress,
    deriveSettlementIntentAddress,
    deriveSettlementPolicyAddress,
    deriveSingletonAddress,
    deriveUsageWindowAddress,
    knownPdaAddress,
    requireBigIntField,
    requireBytes,
    requireNumberField,
    requirePublicKeyField,
    type NamedProgramAddress,
} from "./ChanceryProtocol.js";

export interface ChanceryCanonicalPdaObservation {
    readonly expectedAddress: string;
    readonly bump: number;
    readonly seeds: readonly string[];
    readonly addressMatches: boolean;
    readonly storedBump: number | null;
    readonly storedBumpMatches: boolean | null;
}

export interface DiscoveredChanceryAccount {
    readonly address: string;
    readonly name: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly owner: string;
    readonly lamports: bigint;
    readonly dataLength: number;
    readonly canonicalPda: ChanceryCanonicalPdaObservation | null;
}

export interface UnrecognizedChanceryAccount {
    readonly address: string;
    readonly byteLength: number;
    readonly discriminatorHex: string;
}

export interface ChanceryKnownPdaInventory {
    readonly name: string;
    readonly address: string;
    readonly kind: "state_account" | "signer_pda";
    readonly present: boolean;
    readonly accountName: string | null;
}

export interface ChanceryPathwayInventory {
    readonly address: string;
    readonly pathwayId: string;
    readonly pathwayKind: number;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly designatedExecutor: string;
    readonly statusFlags: bigint;
    readonly feePolicy: DiscoveredChanceryAccount | null;
    readonly pathwayLimitPolicy: DiscoveredChanceryAccount | null;
    readonly assetMintLimitPolicy: DiscoveredChanceryAccount | null;
    readonly assetRedeemLimitPolicy: DiscoveredChanceryAccount | null;
    readonly counterpartyLimitPolicy: DiscoveredChanceryAccount | null;
    readonly executorLimitPolicy: DiscoveredChanceryAccount | null;
    readonly evidencePolicy: DiscoveredChanceryAccount | null;
    readonly reserveDestinations: readonly DiscoveredChanceryAccount[];
}

export interface ChanceryAssetInventory {
    readonly assetConfig: DiscoveredChanceryAccount;
    readonly assetPauseState: DiscoveredChanceryAccount | null;
    readonly assetMint: string;
    readonly assetTokenProgram: string;
    readonly depositRateE9: bigint;
    readonly redeemRateE9: bigint;
    readonly pathways: readonly ChanceryPathwayInventory[];
    readonly reserveDestinations: readonly DiscoveredChanceryAccount[];
}

export interface ChanceryStateDiscovery {
    readonly programAddress: string;
    readonly commitment: RpcCommitment;
    readonly accountCount: number;
    readonly recognizedAccounts: readonly DiscoveredChanceryAccount[];
    readonly accountsByType: Readonly<Record<string, readonly DiscoveredChanceryAccount[]>>;
    readonly unrecognizedAccounts: readonly UnrecognizedChanceryAccount[];
    readonly knownPdas: readonly ChanceryKnownPdaInventory[];
    readonly chanceryConfig: DiscoveredChanceryAccount | null;
    readonly issuedTokenControl: DiscoveredChanceryAccount | null;
    readonly assets: readonly ChanceryAssetInventory[];
    readonly pathways: readonly ChanceryPathwayInventory[];
    readonly settlementLimitModel: {
        readonly volumeScopes: readonly ["pathway", "asset", "counterparty", "executor"];
        readonly globalSettlementVolumeAccumulatorExists: false;
        readonly globalPauseAccount: string;
    };
}

export async function discoverChanceryState(
    rpc: ChanceryRpc,
    commitment: RpcCommitment = "confirmed",
): Promise<ChanceryStateDiscovery> {
    const programAccounts = await rpc.getProgramAccounts(CHANCERY_PROGRAM_ADDRESS, [], commitment);
    const recognizedAccounts: DiscoveredChanceryAccount[] = [];
    const unrecognizedAccounts: UnrecognizedChanceryAccount[] = [];
    for (let index = 0, length = programAccounts.length; index < length; index++) {
        const programAccount = programAccounts[index];
        if (programAccount === undefined) {
            continue;
        }
        validateProgramAccount(programAccount.address, programAccount.account);
        let decoded: DecodedChanceryAccount;
        try {
            decoded = decodeChanceryAccount(programAccount.account.data);
        } catch (error: unknown) {
            if (!(error instanceof Error) || error.message !== "Unknown Chancery account discriminator") {
                throw error;
            }
            unrecognizedAccounts.push({
                address: programAccount.address,
                byteLength: programAccount.account.data.length,
                discriminatorHex: `0x${bytesToHex(programAccount.account.data.slice(0, 8))}`,
            });
            continue;
        }
        recognizedAccounts.push({
            address: programAccount.address,
            name: decoded.name,
            values: decoded.values,
            owner: programAccount.account.owner,
            lamports: programAccount.account.lamports,
            dataLength: programAccount.account.data.length,
            canonicalPda: observeCanonicalPda(programAccount.address, decoded.name, decoded.values),
        });
    }
    const remoteDomainPolicies = recognizedAccounts.filter(
        (account) => account.name === "RemoteDomainPolicy",
    );
    for (let index = 0, length = recognizedAccounts.length; index < length; index++) {
        const account = recognizedAccounts[index];
        if (account === undefined || account.name !== "RemoteNonce") {
            continue;
        }
        recognizedAccounts[index] = {
            ...account,
            canonicalPda: observeCanonicalPda(
                account.address,
                account.name,
                account.values,
                remoteDomainPolicies,
            ),
        };
    }
    recognizedAccounts.sort(compareDiscoveredAccounts);
    unrecognizedAccounts.sort((left, right) => left.address.localeCompare(right.address));
    const accountsByType = groupAccountsByType(recognizedAccounts);
    const policyIndexes = buildPolicyIndexes(accountsByType);
    const reserveDestinations = accountsByType.ReserveDestination ?? [];
    const pathwayAccounts = accountsByType.PathwayPolicy ?? [];
    const pathways: ChanceryPathwayInventory[] = [];
    for (let index = 0, length = pathwayAccounts.length; index < length; index++) {
        const pathwayAccount = pathwayAccounts[index];
        if (pathwayAccount !== undefined) {
            pathways.push(buildPathwayInventory(pathwayAccount, policyIndexes, reserveDestinations));
        }
    }
    pathways.sort((left, right) => left.address.localeCompare(right.address));
    const assetAccounts = accountsByType.AssetConfig ?? [];
    const assetPauseAccounts = accountsByType.AssetPauseState ?? [];
    const assets: ChanceryAssetInventory[] = [];
    for (let index = 0, length = assetAccounts.length; index < length; index++) {
        const assetAccount = assetAccounts[index];
        if (assetAccount === undefined) {
            continue;
        }
        const assetMint = requirePublicKeyField(assetAccount.values, "asset_mint");
        assets.push({
            assetConfig: assetAccount,
            assetPauseState: findByPublicKeyField(assetPauseAccounts, "asset_mint", assetMint),
            assetMint,
            assetTokenProgram: requirePublicKeyField(assetAccount.values, "asset_token_program"),
            depositRateE9: requireBigIntField(assetAccount.values, "deposit_rate_e9"),
            redeemRateE9: requireBigIntField(assetAccount.values, "redeem_rate_e9"),
            pathways: pathways.filter((pathway) => pathway.assetMint === assetMint),
            reserveDestinations: reserveDestinations.filter(
                (destination) => requirePublicKeyField(destination.values, "asset_mint") === assetMint,
            ),
        });
    }
    assets.sort((left, right) => left.assetMint.localeCompare(right.assetMint));
    const byAddress = new Map<string, DiscoveredChanceryAccount>();
    for (let index = 0, length = recognizedAccounts.length; index < length; index++) {
        const account = recognizedAccounts[index];
        if (account !== undefined) {
            byAddress.set(account.address, account);
        }
    }
    return {
        programAddress: CHANCERY_PROGRAM_ADDRESS,
        commitment,
        accountCount: programAccounts.length,
        recognizedAccounts,
        accountsByType,
        unrecognizedAccounts,
        knownPdas: buildKnownPdaInventory(byAddress),
        chanceryConfig: firstAccount(accountsByType.ChanceryConfig),
        issuedTokenControl: firstAccount(accountsByType.IssuedTokenControl),
        assets,
        pathways,
        settlementLimitModel: {
            volumeScopes: ["pathway", "asset", "counterparty", "executor"],
            globalSettlementVolumeAccumulatorExists: false,
            globalPauseAccount: knownPdaAddress("pause_state"),
        },
    };
}

interface PolicyIndexes {
    readonly fee: ReadonlyMap<string, DiscoveredChanceryAccount>;
    readonly limit: ReadonlyMap<string, DiscoveredChanceryAccount>;
    readonly evidence: ReadonlyMap<string, DiscoveredChanceryAccount>;
}

function buildPolicyIndexes(
    accountsByType: Readonly<Record<string, readonly DiscoveredChanceryAccount[]>>,
): PolicyIndexes {
    return {
        fee: indexAccountsByBytes32(accountsByType.FeePolicy ?? [], "fee_policy_id"),
        limit: indexAccountsByBytes32(accountsByType.LimitPolicy ?? [], "limit_policy_id"),
        evidence: indexAccountsByBytes32(accountsByType.EvidencePolicy ?? [], "evidence_policy_id"),
    };
}

function buildPathwayInventory(
    pathway: DiscoveredChanceryAccount,
    policyIndexes: PolicyIndexes,
    reserveDestinations: readonly DiscoveredChanceryAccount[],
): ChanceryPathwayInventory {
    const assetMint = requirePublicKeyField(pathway.values, "asset_mint");
    return {
        address: pathway.address,
        pathwayId: bytes32Hex(pathway.values.pathway_id, "pathway id"),
        pathwayKind: requireNumberField(pathway.values, "pathway_kind"),
        assetMint,
        issuedTokenMint: requirePublicKeyField(pathway.values, "issued_token_mint"),
        designatedExecutor: requirePublicKeyField(pathway.values, "designated_executor"),
        statusFlags: requireBigIntField(pathway.values, "status_flags"),
        feePolicy: linkedPolicy(policyIndexes.fee, pathway.values.fee_policy_id, "fee policy id"),
        pathwayLimitPolicy: linkedPolicy(policyIndexes.limit, pathway.values.limit_policy_id, "limit policy id"),
        assetMintLimitPolicy: linkedPolicy(
            policyIndexes.limit,
            pathway.values.asset_mint_limit_policy_id,
            "asset mint limit policy id",
        ),
        assetRedeemLimitPolicy: linkedPolicy(
            policyIndexes.limit,
            pathway.values.asset_redeem_limit_policy_id,
            "asset redeem limit policy id",
        ),
        counterpartyLimitPolicy: linkedPolicy(
            policyIndexes.limit,
            pathway.values.counterparty_limit_policy_id,
            "counterparty limit policy id",
        ),
        executorLimitPolicy: linkedPolicy(
            policyIndexes.limit,
            pathway.values.executor_limit_policy_id,
            "executor limit policy id",
        ),
        evidencePolicy: linkedPolicy(
            policyIndexes.evidence,
            pathway.values.evidence_policy_id,
            "evidence policy id",
        ),
        reserveDestinations: reserveDestinations.filter(
            (destination) => requirePublicKeyField(destination.values, "asset_mint") === assetMint,
        ),
    };
}

function observeCanonicalPda(
    actualAddress: string,
    accountName: string,
    values: Readonly<Record<string, unknown>>,
    remoteDomainPolicies: readonly DiscoveredChanceryAccount[] = [],
): ChanceryCanonicalPdaObservation | null {
    const derived = accountName === "RemoteNonce"
        ? deriveRemoteNonceCanonicalPda(actualAddress, values, remoteDomainPolicies)
        : deriveCanonicalPda(accountName, values);
    if (derived === null) {
        return null;
    }
    const storedBumpValue = values.bump;
    const storedBump = typeof storedBumpValue === "number" && Number.isInteger(storedBumpValue)
        ? storedBumpValue
        : null;
    return {
        expectedAddress: derived.address,
        bump: derived.bump,
        seeds: derived.seeds,
        addressMatches: derived.address === actualAddress,
        storedBump,
        storedBumpMatches: storedBump === null ? null : storedBump === derived.bump,
    };
}

function deriveCanonicalPda(
    accountName: string,
    values: Readonly<Record<string, unknown>>,
): NamedProgramAddress | null {
    if (accountName === "AuthorityTransfer") {
        return deriveAuthorityTransferAddress(requireNumberField(values, "role_kind"));
    }
    if (accountName === "AssetConfig") {
        return deriveAssetConfigAddress(requirePublicKeyField(values, "asset_mint"));
    }
    if (accountName === "AssetPauseState") {
        return deriveAssetPauseStateAddress(requirePublicKeyField(values, "asset_mint"));
    }
    if (accountName === "BasicFreezeRecord") {
        return deriveBasicFreezeRecordAddress(requirePublicKeyField(values, "issued_token_account"));
    }
    if (accountName === "CrossChainSignerSet") {
        return deriveCrossChainSignerSetAddress(requireBytes(values.signer_set_id, "signer set id", 32));
    }
    if (accountName === "PathwayPolicy") {
        return derivePathwayPolicyAddress(requireBytes(values.pathway_id, "pathway id", 32));
    }
    if (accountName === "PermissionRecord") {
        return derivePermissionRecordAddress(
            requirePublicKeyField(values, "subject"),
            requireNumberField(values, "scope_kind"),
            requirePublicKeyField(values, "scope_key"),
        );
    }
    if (accountName === "FeePolicy") {
        return deriveFeePolicyAddress(requireBytes(values.fee_policy_id, "fee policy id", 32));
    }
    if (accountName === "LimitPolicy") {
        return deriveLimitPolicyAddress(requireBytes(values.limit_policy_id, "limit policy id", 32));
    }
    if (accountName === "EvidencePolicy") {
        return deriveEvidencePolicyAddress(requireBytes(values.evidence_policy_id, "evidence policy id", 32));
    }
    if (accountName === "OutboundReclaimRecord") {
        return deriveOutboundReclaimRecordAddress(
            requireNumberField(values, "remote_chain_kind"),
            requireBigIntField(values, "remote_domain_id"),
            requireBigIntField(values, "source_nonce"),
        );
    }
    if (accountName === "PendingConfigChange") {
        return derivePendingConfigChangeAddress(requireBytes(values.change_id, "change id", 32));
    }
    if (accountName === "RemoteDomainPolicy") {
        return deriveRemoteDomainPolicyAddress(
            requireNumberField(values, "remote_chain_kind"),
            requireBigIntField(values, "remote_domain_id"),
        );
    }
    if (accountName === "ReserveDestination") {
        return deriveReserveDestinationAddress(
            requirePublicKeyField(values, "asset_mint"),
            requirePublicKeyField(values, "destination_token_account"),
        );
    }
    if (accountName === "UsageWindow") {
        return deriveUsageWindowAddress(
            requireBytes(values.scope_hash, "scope hash", 32),
            requireNumberField(values, "window_kind"),
        );
    }
    if (accountName === "SettlementIntent") {
        return deriveSettlementIntentAddress(requireBytes(values.intent_id, "intent id", 32));
    }
    if (accountName === "SettlementPolicy") {
        return deriveSettlementPolicyAddress(requireBytes(values.policy_id, "settlement policy id", 32));
    }
    const singleton = singletonForAccount(accountName);
    return singleton === null ? null : deriveSingletonAddress(singleton.name, singleton.seed);
}

function deriveRemoteNonceCanonicalPda(
    actualAddress: string,
    values: Readonly<Record<string, unknown>>,
    remoteDomainPolicies: readonly DiscoveredChanceryAccount[],
): NamedProgramAddress | null {
    const remoteDomainId = requireBigIntField(values, "remote_domain_id");
    const scopeKey = requireBytes(values.scope_key, "remote nonce scope key", 32);
    const candidates: NamedProgramAddress[] = [];
    for (let index = 0, length = remoteDomainPolicies.length; index < length; index++) {
        const policy = remoteDomainPolicies[index];
        if (policy === undefined || requireBigIntField(policy.values, "remote_domain_id") !== remoteDomainId) {
            continue;
        }
        const candidate = deriveRemoteNonceAddress(
            requireNumberField(policy.values, "remote_chain_kind"),
            remoteDomainId,
            scopeKey,
        );
        if (candidate.address === actualAddress) {
            return candidate;
        }
        candidates.push(candidate);
    }
    return candidates.length === 1 ? candidates[0] ?? null : null;
}

function singletonForAccount(accountName: string): { readonly name: string; readonly seed: string } | null {
    const mapping: Readonly<Record<string, { readonly name: string; readonly seed: string }>> = {
        ModuleActivationState: { name: "module_activation_state", seed: "module-activation-state" },
        ChanceryConfig: { name: "chancery_config", seed: "chancery-config" },
        PauseState: { name: "pause_state", seed: "pause-state" },
        IssuedTokenControl: { name: "issued_token_control", seed: "issued-token-control" },
    };
    return mapping[accountName] ?? null;
}

function buildKnownPdaInventory(
    byAddress: ReadonlyMap<string, DiscoveredChanceryAccount>,
): readonly ChanceryKnownPdaInventory[] {
    const inventory: ChanceryKnownPdaInventory[] = [];
    const names = Object.keys(CHANCERY_SCHEMA.known_pdas).sort();
    for (let index = 0, length = names.length; index < length; index++) {
        const name = names[index];
        if (name === undefined) {
            continue;
        }
        const address = knownPdaAddress(name);
        const account = byAddress.get(address) ?? null;
        inventory.push({
            name,
            address,
            kind: knownPdaKind(name),
            present: account !== null,
            accountName: account?.name ?? null,
        });
    }
    const mintAuthority = deriveSingletonAddress("mint_authority_pda", "mint-authority");
    if (!inventory.some((entry) => entry.name === mintAuthority.name)) {
        const account = byAddress.get(mintAuthority.address) ?? null;
        inventory.push({
            name: mintAuthority.name,
            address: mintAuthority.address,
            kind: "signer_pda",
            present: account !== null,
            accountName: account?.name ?? null,
        });
    }
    inventory.sort((left, right) => left.name.localeCompare(right.name));
    return inventory;
}

function knownPdaKind(name: string): ChanceryKnownPdaInventory["kind"] {
    return name === "event_authority"
        || name === "reserve_authority_pda"
        || name === "mint_authority_pda"
        ? "signer_pda"
        : "state_account";
}

function validateProgramAccount(address: string, account: RpcAccountInfo): void {
    if (account.owner !== CHANCERY_PROGRAM_ADDRESS) {
        throw new Error(`Program account ${address} is owned by ${account.owner}; expected ${CHANCERY_PROGRAM_ADDRESS}`);
    }
    if (account.executable) {
        throw new Error(`Program account ${address} must not be executable`);
    }
}

function groupAccountsByType(
    accounts: readonly DiscoveredChanceryAccount[],
): Readonly<Record<string, readonly DiscoveredChanceryAccount[]>> {
    const grouped: Record<string, DiscoveredChanceryAccount[]> = {};
    const schemaNames = Object.keys(CHANCERY_SCHEMA.accounts).sort();
    for (let index = 0, length = schemaNames.length; index < length; index++) {
        const name = schemaNames[index];
        if (name !== undefined) {
            grouped[name] = [];
        }
    }
    for (let index = 0, length = accounts.length; index < length; index++) {
        const account = accounts[index];
        if (account !== undefined) {
            const entries = grouped[account.name];
            if (entries === undefined) {
                throw new Error(`Decoded unknown Chancery account type: ${account.name}`);
            }
            entries.push(account);
        }
    }
    return grouped;
}

function indexAccountsByBytes32(
    accounts: readonly DiscoveredChanceryAccount[],
    fieldName: string,
): ReadonlyMap<string, DiscoveredChanceryAccount> {
    const index = new Map<string, DiscoveredChanceryAccount>();
    for (let accountIndex = 0, length = accounts.length; accountIndex < length; accountIndex++) {
        const account = accounts[accountIndex];
        if (account === undefined) {
            continue;
        }
        const key = bytes32Hex(account.values[fieldName], `${account.name}.${fieldName}`);
        if (index.has(key)) {
            throw new Error(`Duplicate ${account.name}.${fieldName}: ${key}`);
        }
        index.set(key, account);
    }
    return index;
}

function linkedPolicy(
    index: ReadonlyMap<string, DiscoveredChanceryAccount>,
    identifier: unknown,
    label: string,
): DiscoveredChanceryAccount | null {
    const bytes = requireBytes(identifier, label, 32);
    let nonzero = false;
    for (let byteIndex = 0; byteIndex < 32; byteIndex++) {
        if (bytes[byteIndex] !== 0) {
            nonzero = true;
            break;
        }
    }
    return nonzero ? index.get(`0x${bytesToHex(bytes)}`) ?? null : null;
}

function findByPublicKeyField(
    accounts: readonly DiscoveredChanceryAccount[],
    fieldName: string,
    key: string,
): DiscoveredChanceryAccount | null {
    for (let index = 0, length = accounts.length; index < length; index++) {
        const account = accounts[index];
        if (account !== undefined && requirePublicKeyField(account.values, fieldName) === key) {
            return account;
        }
    }
    return null;
}

function firstAccount(accounts: readonly DiscoveredChanceryAccount[] | undefined): DiscoveredChanceryAccount | null {
    return accounts?.[0] ?? null;
}

function compareDiscoveredAccounts(left: DiscoveredChanceryAccount, right: DiscoveredChanceryAccount): number {
    const nameComparison = left.name.localeCompare(right.name);
    return nameComparison === 0 ? left.address.localeCompare(right.address) : nameComparison;
}
