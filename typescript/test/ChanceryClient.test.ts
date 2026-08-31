import assert from "node:assert/strict";
import test from "node:test";

import {
    CHANCERY_PROGRAM_ADDRESS,
    CHANCERY_SCHEMA,
    ChanceryClient,
    FEE_FLAG,
    ChanceryRpc,
    ROLE,
    SCOPE,
    SPL_TOKEN_PROGRAM_ADDRESS,
    ZERO_ADDRESS,
    calculateTokenTransferFee,
    computeSettlementEffectiveQuote,
    decodePublicKey,
    decodeTokenMint,
    deriveAuthorityTransferAddress,
    deriveAssetConfigAddress,
    deriveAssociatedTokenAddress,
    deriveBasicFreezeRecordAddress,
    deriveCrossChainSignerSetAddress,
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
    encodeBase58,
    encodeChanceryAccount,
    findProgramAddress,
    getAccountSchema,
    keypairFromSecretKeyBytes,
    knownPdaAddress,
    observeLimitPolicy,
    zeroValueForType,
    type FieldSchema,
    type SettlementTransactionRequest,
    type RpcAccountInfo,
    type RpcAddressAccountInfo,
    type RpcCommitment,
    type RpcClock,
    type RpcLatestBlockhash,
    type RpcEpochInfo,
    type RpcProgramAccountFilter,
    type RpcSignatureStatus,
    type RpcSimulationResult,
    type SolanaKeypair,
} from "../src/index.js";

function publicKey(fill: number): string {
    return encodeBase58(new Uint8Array(32).fill(fill));
}

function activeModuleStatuses(): Uint8Array {
    const statuses = new Uint8Array(32);
    statuses[4] = 2;
    return statuses;
}

function accountValues(
    accountName: string,
    overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    const schema = getAccountSchema(accountName);
    const values: Record<string, unknown> = {};
    for (let index = 0, length = schema.fields.length; index < length; index++) {
        const field: FieldSchema | undefined = schema.fields[index];
        if (field !== undefined) {
            values[field.name] = zeroValueForType(field.type);
        }
    }
    const names = Object.keys(overrides);
    for (let index = 0, length = names.length; index < length; index++) {
        const name = names[index];
        if (name !== undefined) {
            values[name] = overrides[name];
        }
    }
    return values;
}

function chanceryAccount(accountName: string, values: Record<string, unknown>): RpcAccountInfo {
    const data = encodeChanceryAccount(accountName, values);
    return {
        data,
        executable: false,
        lamports: 1n,
        owner: CHANCERY_PROGRAM_ADDRESS,
        rentEpoch: 0n,
        space: data.length,
    };
}

function tokenMintAccount(supply = 0n, decimals = 6): RpcAccountInfo {
    const data = new Uint8Array(82);
    writeUnsigned(data, 36, 8, supply);
    data[44] = decimals;
    data[45] = 1;
    return {
        data,
        executable: false,
        lamports: 1n,
        owner: SPL_TOKEN_PROGRAM_ADDRESS,
        rentEpoch: 0n,
        space: data.length,
    };
}

function token2022MintWithTransferFee(
    olderEpoch: bigint,
    olderMaximumFee: bigint,
    olderBasisPoints: number,
    newerEpoch: bigint,
    newerMaximumFee: bigint,
    newerBasisPoints: number,
): Uint8Array {
    const data = new Uint8Array(166 + 4 + 108);
    data[44] = 6;
    data[45] = 1;
    data[165] = 1;
    writeUnsigned(data, 166, 2, 1n);
    writeUnsigned(data, 168, 2, 108n);
    const valueOffset = 170;
    writeUnsigned(data, valueOffset + 72, 8, olderEpoch);
    writeUnsigned(data, valueOffset + 80, 8, olderMaximumFee);
    writeUnsigned(data, valueOffset + 88, 2, BigInt(olderBasisPoints));
    writeUnsigned(data, valueOffset + 90, 8, newerEpoch);
    writeUnsigned(data, valueOffset + 98, 8, newerMaximumFee);
    writeUnsigned(data, valueOffset + 106, 2, BigInt(newerBasisPoints));
    return data;
}

function tokenAccount(mint: string, owner: string, amount: bigint): RpcAccountInfo {
    const data = new Uint8Array(165);
    data.set(decodePublicKey(mint), 0);
    data.set(decodePublicKey(owner), 32);
    writeUnsigned(data, 64, 8, amount);
    data[108] = 1;
    return {
        data,
        executable: false,
        lamports: 1n,
        owner: SPL_TOKEN_PROGRAM_ADDRESS,
        rentEpoch: 0n,
        space: data.length,
    };
}

function writeUnsigned(data: Uint8Array, offset: number, byteLength: number, value: bigint): void {
    let remaining = value;
    for (let index = 0; index < byteLength; index++) {
        data[offset + index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
}

function unsigned64BigEndianForTest(value: bigint): Uint8Array {
    const result = new Uint8Array(8);
    let remaining = value;
    for (let index = 7; index >= 0; index--) {
        result[index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return result;
}

class FixtureRpc extends ChanceryRpc {
    readonly signer: SolanaKeypair;
    readonly principal: string;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly pathwayId: Uint8Array;
    readonly pathwayAddress: string;
    readonly assetConfigAddress: string;
    readonly mintAuthority: string;
    readonly reserveAuthority: string;
    readonly permissionAddress: string;
    readonly reserveToken: string;
    readonly sourceToken: string;
    readonly destinationToken: string;
    readonly #accounts = new Map<string, RpcAccountInfo>();

    constructor(action: "mint" | "redeem") {
        super("http://fixture.invalid");
        this.signer = keypairFromSecretKeyBytes(new Uint8Array(32).fill(7));
        this.principal = this.signer.publicKey;
        this.assetMint = publicKey(21);
        this.issuedTokenMint = publicKey(22);
        this.pathwayId = new Uint8Array(32).fill(31);
        this.pathwayAddress = derivePathwayPolicyAddress(this.pathwayId).address;
        this.assetConfigAddress = deriveAssetConfigAddress(this.assetMint).address;
        this.mintAuthority = deriveSingletonAddress("mint_authority_pda", "mint-authority").address;
        this.reserveAuthority = deriveSingletonAddress("reserve_authority_pda", "reserve-authority").address;
        this.permissionAddress = derivePermissionRecordAddress(
            this.principal,
            SCOPE.PATHWAY,
            this.pathwayAddress,
        ).address;
        this.reserveToken = deriveAssociatedTokenAddress(
            this.reserveAuthority,
            this.assetMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;
        const sourceMint = action === "mint" ? this.assetMint : this.issuedTokenMint;
        const destinationMint = action === "mint" ? this.issuedTokenMint : this.assetMint;
        this.sourceToken = deriveAssociatedTokenAddress(
            this.principal,
            sourceMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;
        this.destinationToken = deriveAssociatedTokenAddress(
            this.principal,
            destinationMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;
        const requiredRole = action === "mint" ? ROLE.CAN_MINT_DIRECT : ROLE.CAN_REDEEM_DIRECT;

        this.#accounts.set(
            knownPdaAddress("module_activation_state"),
            chanceryAccount("ModuleActivationState", accountValues("ModuleActivationState", {
                version: 1,
                module_statuses: activeModuleStatuses(),
            })),
        );
        this.#accounts.set(
            knownPdaAddress("chancery_config"),
            chanceryAccount("ChanceryConfig", accountValues("ChanceryConfig", {
                version: 1,
                issued_token_mint: this.issuedTokenMint,
                issued_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                mint_authority_pda: this.mintAuthority,
                control_flags: 1n << 63n,
            })),
        );
        this.#accounts.set(
            knownPdaAddress("pause_state"),
            chanceryAccount("PauseState", accountValues("PauseState", { version: 1 })),
        );
        this.#accounts.set(
            this.assetConfigAddress,
            chanceryAccount("AssetConfig", accountValues("AssetConfig", {
                version: 1,
                asset_mint: this.assetMint,
                asset_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                deposit_rate_e9: 1_000_000_000n,
                redeem_rate_e9: 1_000_000_000n,
                minimum_deposit_amount: 1n,
                minimum_redeem_amount: 1n,
            })),
        );
        this.#accounts.set(
            knownPdaAddress("issued_token_control"),
            chanceryAccount("IssuedTokenControl", accountValues("IssuedTokenControl", {
                version: 1,
                issued_token_mint: this.issuedTokenMint,
                issued_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                mint_authority_pda: this.mintAuthority,
                control_flags: 1n << 63n,
            })),
        );
        this.#accounts.set(
            this.pathwayAddress,
            chanceryAccount("PathwayPolicy", accountValues("PathwayPolicy", {
                version: 1,
                pathway_kind: 0,
                pathway_id: this.pathwayId,
                asset_mint: this.assetMint,
                issued_token_mint: this.issuedTokenMint,
                designated_executor: ZERO_ADDRESS,
                status_flags: 1n,
            })),
        );
        this.#accounts.set(
            this.permissionAddress,
            chanceryAccount("PermissionRecord", accountValues("PermissionRecord", {
                version: 1,
                scope_kind: SCOPE.PATHWAY,
                subject: this.principal,
                scope_key: this.pathwayAddress,
                role_bits: [requiredRole, 0n],
                role_schema_version: 1,
            })),
        );
        this.#accounts.set(this.assetMint, tokenMintAccount(5_000_000n));
        this.#accounts.set(this.issuedTokenMint, tokenMintAccount(10_000_000n));
        this.#accounts.set(this.sourceToken, tokenAccount(sourceMint, this.principal, 1_000_000n));
        this.#accounts.set(this.destinationToken, tokenAccount(destinationMint, this.principal, 0n));
        this.#accounts.set(
            this.reserveToken,
            tokenAccount(this.assetMint, this.reserveAuthority, 1_000_000n),
        );
    }

    addChanceryAccount(
        address: string,
        accountName: string,
        overrides: Readonly<Record<string, unknown>>,
    ): void {
        this.#accounts.set(
            address,
            chanceryAccount(accountName, accountValues(accountName, overrides)),
        );
    }

    override async getSlot(_commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        return 100n;
    }

    override async getClock(_commitment: RpcCommitment = "confirmed"): Promise<RpcClock> {
        return {
            slot: 100n,
            epochStartUnixTimestamp: 0n,
            epoch: 10n,
            leaderScheduleEpoch: 10n,
            unixTimestamp: 1_700_000_000n,
        };
    }

    override async getEpochInfo(_commitment: RpcCommitment = "confirmed"): Promise<RpcEpochInfo> {
        return {
            epoch: 10n,
            slotIndex: 100n,
            slotsInEpoch: 432_000n,
            absoluteSlot: 100n,
            blockHeight: 100n,
            transactionCount: 0n,
        };
    }

    override async getAccountInfo(
        address: string | Uint8Array,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<RpcAccountInfo | null> {
        return this.#accounts.get(typeof address === "string" ? address : encodeBase58(address)) ?? null;
    }

    override async getProgramAccounts(
        _programAddress: string | Uint8Array,
        filters: readonly RpcProgramAccountFilter[] = [],
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        if (filters.length === 0) {
            const accounts: RpcAddressAccountInfo[] = [];
            for (const [address, account] of this.#accounts.entries()) {
                if (account.owner === CHANCERY_PROGRAM_ADDRESS && !account.executable) {
                    accounts.push({ address, account });
                }
            }
            return accounts;
        }
        let dataSize: number | null = null;
        for (let index = 0, length = filters.length; index < length; index++) {
            const filter = filters[index];
            if (filter !== undefined && "dataSize" in filter) {
                dataSize = filter.dataSize;
            }
        }
        if (dataSize === getAccountSchema("PathwayPolicy").size) {
            const account = this.#accounts.get(this.pathwayAddress);
            assert.ok(account !== undefined);
            return [{ address: this.pathwayAddress, account }];
        }
        return [];
    }

    override async getTokenAccountsByOwner(
        _owner: string | Uint8Array,
        _mint: string | Uint8Array,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        return [];
    }

    override async getLatestBlockhash(
        _commitment: RpcCommitment = "confirmed",
    ): Promise<RpcLatestBlockhash> {
        return { blockhash: publicKey(91), lastValidBlockHeight: 500n };
    }

    override async simulateTransaction(
        _transaction: Uint8Array,
        _commitment: RpcCommitment = "confirmed",
        _signatureVerification = true,
    ): Promise<RpcSimulationResult> {
        return {
            err: null,
            logs: ["Program log: fixture"],
            unitsConsumed: 1000n,
            returnData: null,
            accounts: null,
            raw: { err: null },
        };
    }

    override async sendTransaction(
        _transaction: Uint8Array,
        _commitment: RpcCommitment = "confirmed",
        _skipPreflight = false,
        _maximumRetries = 5,
    ): Promise<string> {
        return publicKey(92);
    }

    override async getSignatureStatus(_signature: string): Promise<RpcSignatureStatus | null> {
        return {
            slot: 101n,
            confirmations: 1n,
            err: null,
            confirmationStatus: "confirmed",
        };
    }

    override async getBlockHeight(_commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        return 101n;
    }

    override async getTransaction(
        _signature: string,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<unknown | null> {
        return { slot: 101, meta: { err: null } };
    }

    override async getChanceryEvents(
        _signature: string,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly []> {
        return [];
    }
}

class IntentFixtureRpc extends ChanceryRpc {
    readonly action: "mint" | "redeem";
    readonly mode: "delegated" | "trilateral";
    readonly principalASigner: SolanaKeypair;
    readonly principalBSigner: SolanaKeypair;
    readonly executorSigner: SolanaKeypair;
    readonly principalA: string;
    readonly principalB: string;
    readonly executor: string;
    readonly assetMint: string;
    readonly issuedTokenMint: string;
    readonly pathwayId: Uint8Array;
    readonly intentId: Uint8Array;
    readonly policyId: Uint8Array;
    readonly pathwayAddress: string;
    readonly intentAddress: string;
    readonly settlementPolicyAddress: string;
    readonly reserveToken: string;
    readonly sourceToken: string;
    readonly destinationToken: string;
    readonly lookupTableAddress: string;
    readonly #accounts = new Map<string, RpcAccountInfo>();

    constructor(action: "mint" | "redeem", mode: "delegated" | "trilateral") {
        super("http://fixture.invalid");
        this.action = action;
        this.mode = mode;
        this.principalASigner = keypairFromSecretKeyBytes(new Uint8Array(32).fill(11));
        this.principalBSigner = keypairFromSecretKeyBytes(new Uint8Array(32).fill(12));
        this.executorSigner = keypairFromSecretKeyBytes(new Uint8Array(32).fill(13));
        this.principalA = this.principalASigner.publicKey;
        this.principalB = mode === "trilateral" ? this.principalBSigner.publicKey : this.principalA;
        this.executor = this.executorSigner.publicKey;
        this.assetMint = publicKey(41);
        this.issuedTokenMint = publicKey(42);
        this.pathwayId = new Uint8Array(32).fill(mode === "delegated" ? 43 : 44);
        this.intentId = new Uint8Array(32).fill(action === "mint" ? 45 : 46);
        this.policyId = new Uint8Array(32).fill(mode === "delegated" ? 47 : 48);
        const pathwayPda = derivePathwayPolicyAddress(this.pathwayId);
        const intentPda = deriveSettlementIntentAddress(this.intentId);
        const settlementPolicyPda = deriveSettlementPolicyAddress(this.policyId);
        this.pathwayAddress = pathwayPda.address;
        this.intentAddress = intentPda.address;
        this.settlementPolicyAddress = settlementPolicyPda.address;
        this.lookupTableAddress = publicKey(49);

        const mintAuthority = deriveSingletonAddress("mint_authority_pda", "mint-authority").address;
        const reserveAuthority = deriveSingletonAddress("reserve_authority_pda", "reserve-authority").address;
        const assetConfigAddress = deriveAssetConfigAddress(this.assetMint).address;
        this.reserveToken = deriveAssociatedTokenAddress(
            reserveAuthority,
            this.assetMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;
        const sourceMint = action === "mint" ? this.assetMint : this.issuedTokenMint;
        const destinationMint = action === "mint" ? this.issuedTokenMint : this.assetMint;
        const destinationOwner = mode === "trilateral" ? this.principalB : this.principalA;
        this.sourceToken = deriveAssociatedTokenAddress(
            this.principalA,
            sourceMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;
        this.destinationToken = deriveAssociatedTokenAddress(
            destinationOwner,
            destinationMint,
            SPL_TOKEN_PROGRAM_ADDRESS,
        ).address;

        this.#accounts.set(
            knownPdaAddress("module_activation_state"),
            chanceryAccount("ModuleActivationState", accountValues("ModuleActivationState", {
                version: 1,
                module_statuses: activeModuleStatuses(),
            })),
        );
        this.#accounts.set(
            knownPdaAddress("chancery_config"),
            chanceryAccount("ChanceryConfig", accountValues("ChanceryConfig", {
                version: 1,
                issued_token_mint: this.issuedTokenMint,
                issued_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                mint_authority_pda: mintAuthority,
                control_flags: 1n << 63n,
            })),
        );
        this.#accounts.set(
            knownPdaAddress("pause_state"),
            chanceryAccount("PauseState", accountValues("PauseState", { version: 1 })),
        );
        this.#accounts.set(
            assetConfigAddress,
            chanceryAccount("AssetConfig", accountValues("AssetConfig", {
                version: 1,
                asset_mint: this.assetMint,
                asset_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                deposit_rate_e9: 1_000_000_000n,
                redeem_rate_e9: 1_000_000_000n,
                minimum_deposit_amount: 1n,
                minimum_redeem_amount: 1n,
            })),
        );
        this.#accounts.set(
            knownPdaAddress("issued_token_control"),
            chanceryAccount("IssuedTokenControl", accountValues("IssuedTokenControl", {
                version: 1,
                issued_token_mint: this.issuedTokenMint,
                issued_token_program: SPL_TOKEN_PROGRAM_ADDRESS,
                mint_authority_pda: mintAuthority,
                control_flags: 1n << 63n,
            })),
        );
        this.#accounts.set(
            this.pathwayAddress,
            chanceryAccount("PathwayPolicy", accountValues("PathwayPolicy", {
                version: 1,
                bump: pathwayPda.bump,
                pathway_kind: mode === "delegated" ? 1 : 2,
                pathway_id: this.pathwayId,
                asset_mint: this.assetMint,
                issued_token_mint: this.issuedTokenMint,
                designated_executor: this.executor,
                status_flags: 1n,
            })),
        );
        this.#accounts.set(
            this.intentAddress,
            chanceryAccount("SettlementIntent", accountValues("SettlementIntent", {
                version: 1,
                bump: intentPda.bump,
                status: 0,
                settlement_mode: mode === "delegated" ? 1 : 2,
                settlement_action: action === "mint" ? 0 : 1,
                intent_id: this.intentId,
                principal_a: this.principalA,
                principal_b: this.principalB,
                executor: this.executor,
                asset_mint: this.assetMint,
                issued_token_mint: this.issuedTokenMint,
                asset_amount: 1000n,
                issued_token_amount: 1000n,
                minimum_asset_amount: 900n,
                minimum_issued_token_amount: 900n,
                nonce: 1n,
                policy_id: this.policyId,
                pathway_id: this.pathwayId,
                rent_refund_recipient: this.principalA,
            })),
        );
        this.#accounts.set(
            this.settlementPolicyAddress,
            chanceryAccount("SettlementPolicy", accountValues("SettlementPolicy", {
                version: 1,
                bump: settlementPolicyPda.bump,
                policy_id: this.policyId,
                allowed_settlement_modes: 1 << (mode === "delegated" ? 1 : 2),
                allowed_asset_mint: this.assetMint,
                allowed_principal_a: this.principalA,
                allowed_principal_b: this.principalB,
                designated_executor: this.executor,
                min_notional: 1n,
                max_notional: 10_000n,
            })),
        );

        const principalRole = action === "mint" ? ROLE.CAN_MINT_DELEGATED : ROLE.CAN_REDEEM_DELEGATED;
        this.#setPermission(this.principalA, principalRole);
        if (mode === "trilateral") {
            this.#setPermission(this.principalB, ROLE.CAN_USE_TRILATERAL_PATHWAY);
        }
        this.#setPermission(this.executor, ROLE.CAN_EXECUTE_SETTLEMENT);
        this.#accounts.set(this.assetMint, tokenMintAccount(5_000_000n));
        this.#accounts.set(this.issuedTokenMint, tokenMintAccount(10_000_000n));
        this.#accounts.set(this.sourceToken, tokenAccount(sourceMint, this.principalA, 1_000_000n));
        this.#accounts.set(this.destinationToken, tokenAccount(destinationMint, destinationOwner, 0n));
        this.#accounts.set(
            this.reserveToken,
            tokenAccount(this.assetMint, reserveAuthority, 1_000_000n),
        );
    }

    #setPermission(subject: string, role: bigint): void {
        const permissionAddress = derivePermissionRecordAddress(
            subject,
            SCOPE.PATHWAY,
            this.pathwayAddress,
        ).address;
        this.#accounts.set(
            permissionAddress,
            chanceryAccount("PermissionRecord", accountValues("PermissionRecord", {
                version: 1,
                scope_kind: SCOPE.PATHWAY,
                subject,
                scope_key: this.pathwayAddress,
                role_bits: [role, 0n],
                role_schema_version: 1,
            })),
        );
    }

    installLookupTable(addresses: readonly string[]): void {
        const uniqueAddresses = [...new Set(addresses)];
        const data = new Uint8Array(56 + uniqueAddresses.length * 32);
        data[0] = 1;
        for (let index = 0, length = uniqueAddresses.length; index < length; index++) {
            const address = uniqueAddresses[index];
            if (address !== undefined) {
                data.set(decodePublicKey(address), 56 + index * 32);
            }
        }
        this.#accounts.set(this.lookupTableAddress, {
            data,
            executable: false,
            lamports: 1n,
            owner: publicKey(50),
            rentEpoch: 0n,
            space: data.length,
        });
    }

    override async getSlot(_commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        return 100n;
    }

    override async getClock(_commitment: RpcCommitment = "confirmed"): Promise<RpcClock> {
        return {
            slot: 100n,
            epochStartUnixTimestamp: 0n,
            epoch: 10n,
            leaderScheduleEpoch: 10n,
            unixTimestamp: 1_700_000_000n,
        };
    }

    override async getEpochInfo(_commitment: RpcCommitment = "confirmed"): Promise<RpcEpochInfo> {
        return {
            epoch: 10n,
            slotIndex: 100n,
            slotsInEpoch: 432_000n,
            absoluteSlot: 100n,
            blockHeight: 100n,
            transactionCount: 0n,
        };
    }

    override async getAccountInfo(
        address: string | Uint8Array,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<RpcAccountInfo | null> {
        return this.#accounts.get(typeof address === "string" ? address : encodeBase58(address)) ?? null;
    }

    override async getProgramAccounts(
        _programAddress: string | Uint8Array,
        filters: readonly RpcProgramAccountFilter[] = [],
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        if (filters.length === 0) {
            const accounts: RpcAddressAccountInfo[] = [];
            for (const [address, account] of this.#accounts.entries()) {
                if (account.owner === CHANCERY_PROGRAM_ADDRESS && !account.executable) {
                    accounts.push({ address, account });
                }
            }
            return accounts;
        }
        let dataSize: number | null = null;
        for (let index = 0, length = filters.length; index < length; index++) {
            const filter = filters[index];
            if (filter !== undefined && "dataSize" in filter) {
                dataSize = filter.dataSize;
            }
        }
        if (dataSize === getAccountSchema("PathwayPolicy").size) {
            const account = this.#accounts.get(this.pathwayAddress);
            assert.ok(account !== undefined);
            return [{ address: this.pathwayAddress, account }];
        }
        return [];
    }

    override async getTokenAccountsByOwner(
        _owner: string | Uint8Array,
        _mint: string | Uint8Array,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        return [];
    }

    override async getLatestBlockhash(
        _commitment: RpcCommitment = "confirmed",
    ): Promise<RpcLatestBlockhash> {
        return { blockhash: publicKey(91), lastValidBlockHeight: 500n };
    }

    override async simulateTransaction(
        _transaction: Uint8Array,
        _commitment: RpcCommitment = "confirmed",
        _signatureVerification = true,
    ): Promise<RpcSimulationResult> {
        return {
            err: null,
            logs: ["Program log: fixture"],
            unitsConsumed: 1000n,
            returnData: null,
            accounts: null,
            raw: { err: null },
        };
    }

    override async sendTransaction(
        _transaction: Uint8Array,
        _commitment: RpcCommitment = "confirmed",
        _skipPreflight = false,
        _maximumRetries = 5,
    ): Promise<string> {
        return publicKey(92);
    }

    override async getSignatureStatus(_signature: string): Promise<RpcSignatureStatus | null> {
        return {
            slot: 101n,
            confirmations: 1n,
            err: null,
            confirmationStatus: "confirmed",
        };
    }

    override async getBlockHeight(_commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        return 101n;
    }

    override async getTransaction(
        _signature: string,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<unknown | null> {
        return { slot: 101, meta: { err: null } };
    }

    override async getChanceryEvents(
        _signature: string,
        _commitment: RpcCommitment = "confirmed",
    ): Promise<readonly []> {
        return [];
    }
}

async function assertDirectOperation(
    action: "mint" | "redeem",
    expectedInstructionName: "mint_direct" | "redeem_direct",
): Promise<void> {
    const rpc = new FixtureRpc(action);
    const client = new ChanceryClient(rpc);
    const inspection = await client.inspect({
        action,
        mode: "direct",
        assetMint: rpc.assetMint,
        principal: rpc.principal,
        amount: 1000n,
        nowUnixTimestamp: 1000n,
    });
    assert.equal(inspection.ready, true, inspection.blockingIssues.join("\n"));
    assert.equal(inspection.instructionName, expectedInstructionName);
    assert.equal(inspection.amounts.grossOutput, 1000n);
    assert.equal(inspection.amounts.minimumOutput, 1000n);
    assert.equal(inspection.pathway.address, rpc.pathwayAddress);
    assert.equal(inspection.tokenAccounts.reserve?.address, rpc.reserveToken);

    const instruction = client.buildInstruction(inspection);
    const expectedSchema = CHANCERY_SCHEMA.instructions[expectedInstructionName];
    assert.ok(expectedSchema !== undefined);
    assert.deepEqual(
        instruction.accounts.map((account) => account.name),
        expectedSchema.accounts.map((account) => account.name),
    );

    const transactionRequest: SettlementTransactionRequest = {
        feePayer: rpc.principal,
        keypairs: [rpc.signer],
        commitment: "confirmed",
    };
    const prepared = await client.prepareTransaction(inspection, transactionRequest);
    assert.ok(prepared.transaction.bytes.length > 100);
    const firstSignature = Object.values(prepared.transaction.signatures)[0];
    assert.ok(firstSignature !== undefined);
    assert.equal(prepared.transaction.primarySignature, encodeBase58(firstSignature));
    const simulated = await client.simulateTransaction(inspection, transactionRequest);
    assert.equal(simulated.simulation.err, null);
    const submitted = await client.submitTransaction(inspection, transactionRequest);
    assert.equal(submitted.status.confirmationStatus, "confirmed");
}

test("direct mint resolves Chancery state and builds the complete transaction", async () => {
    await assertDirectOperation("mint", "mint_direct");
});

test("direct redeem resolves Chancery state and builds the complete transaction", async () => {
    await assertDirectOperation("redeem", "redeem_direct");
});

async function assertIntentOperation(
    action: "mint" | "redeem",
    mode: "delegated" | "trilateral",
    expectedInstructionName:
        | "mint_delegated"
        | "redeem_delegated"
        | "mint_trilateral"
        | "redeem_trilateral",
): Promise<void> {
    const rpc = new IntentFixtureRpc(action, mode);
    const client = new ChanceryClient(rpc);
    const inspection = await client.inspect({
        action,
        mode,
        assetMint: rpc.assetMint,
        principal: rpc.principalA,
        principalB: rpc.principalB,
        executor: rpc.executor,
        intentId: rpc.intentId,
        nowUnixTimestamp: 1000n,
    });
    assert.equal(inspection.ready, true, inspection.blockingIssues.join("\n"));
    assert.equal(inspection.instructionName, expectedInstructionName);
    assert.equal(inspection.intent?.address, rpc.intentAddress);
    assert.equal(inspection.policies.settlement_policy?.address, rpc.settlementPolicyAddress);
    assert.equal(inspection.settlementPolicyObservation?.usable, true);
    assert.equal(inspection.amounts.inputAmount, 1000n);
    assert.equal(inspection.amounts.minimumOutput, 900n);

    const instruction = client.buildInstruction(inspection);
    const expectedSchema = CHANCERY_SCHEMA.instructions[expectedInstructionName];
    assert.ok(expectedSchema !== undefined);
    assert.deepEqual(
        instruction.accounts.map((account) => account.name),
        expectedSchema.accounts.map((account) => account.name),
    );
    rpc.installLookupTable(
        instruction.accounts
            .filter((account) => !account.isSigner)
            .map((account) => account.address),
    );
    const keypairs = mode === "delegated"
        ? [rpc.executorSigner]
        : [rpc.executorSigner, rpc.principalASigner, rpc.principalBSigner];
    const transactionRequest: SettlementTransactionRequest = {
        feePayer: rpc.executor,
        keypairs,
        addressLookupTableAddresses: [rpc.lookupTableAddress],
        commitment: "confirmed",
    };
    const prepared = await client.prepareTransaction(inspection, transactionRequest);
    assert.equal(prepared.transaction.message.version, 0);
    assert.ok(prepared.transaction.bytes.length <= 1232);
    const simulated = await client.simulateTransaction(inspection, transactionRequest);
    assert.equal(simulated.simulation.err, null);
    const submitted = await client.submitTransaction(inspection, transactionRequest);
    assert.equal(submitted.status.confirmationStatus, "confirmed");
}

test("delegated mint resolves the intent and builds a version-zero transaction", async () => {
    await assertIntentOperation("mint", "delegated", "mint_delegated");
});

test("delegated redeem resolves the intent and builds a version-zero transaction", async () => {
    await assertIntentOperation("redeem", "delegated", "redeem_delegated");
});

test("trilateral mint resolves all parties and builds a version-zero transaction", async () => {
    await assertIntentOperation("mint", "trilateral", "mint_trilateral");
});

test("trilateral redeem resolves all parties and builds a version-zero transaction", async () => {
    await assertIntentOperation("redeem", "trilateral", "redeem_trilateral");
});

test("Token-2022 transfer-fee decoding selects the active epoch and applies ceiling plus cap", () => {
    const mint = decodeTokenMint(token2022MintWithTransferFee(0n, 500n, 100, 20n, 2_000n, 200));
    assert.equal(mint.transferFeeConfig?.olderTransferFee.transferFeeBasisPoints, 100);
    assert.equal(mint.transferFeeConfig?.newerTransferFee.transferFeeBasisPoints, 200);
    const older = calculateTokenTransferFee(101n, mint.transferFeeConfig, 10n);
    assert.equal(older.feeAmount, 2n);
    assert.equal(older.receivedAmount, 99n);
    const newer = calculateTokenTransferFee(200_000n, mint.transferFeeConfig, 20n);
    assert.equal(newer.feeAmount, 2_000n);
    assert.equal(newer.receivedAmount, 198_000n);
});

test("limit observations use action-specific accumulators and canonical period rollover", () => {
    const policy = accountValues("LimitPolicy", {
        per_transaction_maximum: 1_000n,
        per_hour_maximum: 0n,
        per_day_maximum: 1_000n,
        per_seven_day_maximum: 0n,
        per_thirty_day_maximum: 0n,
        maximum_actions_per_hour: 0,
        maximum_actions_per_day: 3,
    });
    const liveWindow = accountValues("UsageWindow", {
        window_start_unix_timestamp: 86_400n,
        gross_in: [400n, 0n],
        gross_output_amount: [700n, 0n],
        action_count: 1,
    });
    const mint = observeLimitPolicy(policy, "mint", 100n, { daily: liveWindow }, 90_000n);
    const mintDaily = mint.windows.find((window) => window.name === "daily");
    assert.equal(mint.accumulatorField, "gross_in");
    assert.equal(mintDaily?.currentAmount, 400n);
    assert.equal(mintDaily?.remainingBefore, 600n);
    assert.equal(mintDaily?.remainingAfter, 500n);
    assert.equal(mintDaily?.actionRemainingAfter, 1);

    const redeem = observeLimitPolicy(policy, "redeem", 100n, { daily: liveWindow }, 90_000n);
    const redeemDaily = redeem.windows.find((window) => window.name === "daily");
    assert.equal(redeem.accumulatorField, "gross_output_amount");
    assert.equal(redeemDaily?.currentAmount, 700n);
    assert.equal(redeemDaily?.remainingAfter, 200n);

    const staleWindow = accountValues("UsageWindow", {
        window_start_unix_timestamp: 0n,
        gross_in: [999n, 0n],
        action_count: 3,
    });
    const rolled = observeLimitPolicy(policy, "mint", 100n, { daily: staleWindow }, 90_000n);
    const rolledDaily = rolled.windows.find((window) => window.name === "daily");
    assert.equal(rolledDaily?.rolledBeforeCheck, true);
    assert.equal(rolledDaily?.currentAmount, 0n);
    assert.equal(rolledDaily?.currentActionCount, 0);
    assert.equal(rolledDaily?.allowed, true);

    const futureWindow = accountValues("UsageWindow", {
        window_start_unix_timestamp: 172_800n,
    });
    const regressed = observeLimitPolicy(policy, "mint", 100n, { daily: futureWindow }, 90_000n);
    const regressedDaily = regressed.windows.find((window) => window.name === "daily");
    assert.equal(regressedDaily?.clockRegression, true);
    assert.equal(regressedDaily?.allowed, false);
    assert.equal(regressedDaily?.actionAllowed, false);
});

test("effective quotes include asset transfer fees on mint and redeem", () => {
    const assetValues = accountValues("AssetConfig", {
        deposit_rate_e9: 1_000_000_000n,
        redeem_rate_e9: 1_000_000_000n,
    });
    const mintValues = decodeTokenMint(token2022MintWithTransferFee(0n, 10_000n, 100, 20n, 10_000n, 200));
    const mintFeePolicy = accountValues("FeePolicy", {
        fee_policy_flags: FEE_FLAG.ACTIVE | FEE_FLAG.FEE_IN_ISSUED_TOKEN,
        flat_fee_in_asset: 0n,
        flat_fee_in_issued_token: 100n,
        percent_fee_bps: 0,
        fee_cap_amount: 0n,
        minimum_fee_amount: 0n,
        rebate_flat_amount: 0n,
        rebate_bps: 0,
        rebate_cap_amount: 0n,
        fee_recipient_key: ZERO_ADDRESS,
        effective_from_unix_timestamp: 0n,
        effective_until_unix_timestamp: 0n,
        net_fee_floor_zero: 1,
    });
    const mint = computeSettlementEffectiveQuote(
        "mint",
        10_000n,
        assetValues,
        mintValues,
        mintFeePolicy,
        1_000n,
        10n,
    );
    assert.equal(mint.effectiveQuote.inputAssetTransfer.feeAmount, 100n);
    assert.equal(mint.grossOutput, 9_900n);
    assert.equal(mint.effectiveQuote.chanceryFeeAmount, 100n);
    assert.equal(mint.effectiveQuote.principalReceivedAmount, 9_800n);
    assert.equal(mint.effectiveQuote.allInOutputReduction, 200n);
    assert.equal(mint.effectiveQuote.allInFeeBasisPoints, 200n);

    const redeemFeePolicy = accountValues("FeePolicy", {
        fee_policy_flags: FEE_FLAG.ACTIVE | FEE_FLAG.FEE_IN_ASSET,
        flat_fee_in_asset: 100n,
        flat_fee_in_issued_token: 0n,
        percent_fee_bps: 0,
        fee_cap_amount: 0n,
        minimum_fee_amount: 0n,
        rebate_flat_amount: 0n,
        rebate_bps: 0,
        rebate_cap_amount: 0n,
        fee_recipient_policy: 1,
        fee_recipient_key: publicKey(99),
        effective_from_unix_timestamp: 0n,
        effective_until_unix_timestamp: 0n,
        net_fee_floor_zero: 1,
    });
    const redeem = computeSettlementEffectiveQuote(
        "redeem",
        10_000n,
        assetValues,
        mintValues,
        redeemFeePolicy,
        1_000n,
        10n,
    );
    assert.equal(redeem.grossOutput, 10_000n);
    assert.equal(redeem.effectiveQuote.outputBeforePrincipalTransfer, 9_900n);
    assert.equal(redeem.effectiveQuote.principalAssetTransfer.feeAmount, 99n);
    assert.equal(redeem.effectiveQuote.principalReceivedAmount, 9_801n);
    assert.equal(redeem.effectiveQuote.routedFeeTransfer?.feeAmount, 1n);
    assert.equal(redeem.effectiveQuote.feeRecipientReceivedAmount, 99n);
});

test("deployment discovery inventories and links Chancery accounts", async () => {
    const rpc = new FixtureRpc("mint");
    const remoteDomainId = 771n;
    const remoteChainKind = 5;
    const remoteNonceScopeKey = new Uint8Array(32).fill(63);
    const remoteDomainPolicy = deriveRemoteDomainPolicyAddress(remoteChainKind, remoteDomainId);
    const remoteNonce = deriveRemoteNonceAddress(remoteChainKind, remoteDomainId, remoteNonceScopeKey);
    rpc.addChanceryAccount(remoteDomainPolicy.address, "RemoteDomainPolicy", {
        version: 1,
        bump: remoteDomainPolicy.bump,
        remote_chain_kind: remoteChainKind,
        remote_domain_id: remoteDomainId,
    });
    rpc.addChanceryAccount(remoteNonce.address, "RemoteNonce", {
        version: 1,
        bump: remoteNonce.bump,
        remote_domain_id: remoteDomainId,
        scope_key: remoteNonceScopeKey,
    });
    const client = new ChanceryClient(rpc);
    const discovery = await client.discover();
    assert.equal(discovery.chanceryConfig?.name, "ChanceryConfig");
    assert.equal(discovery.issuedTokenControl?.name, "IssuedTokenControl");
    assert.equal(discovery.assets.length, 1);
    assert.equal(discovery.assets[0]?.assetMint, rpc.assetMint);
    assert.equal(discovery.assets[0]?.pathways.length, 1);
    assert.equal(discovery.pathways[0]?.address, rpc.pathwayAddress);
    assert.equal(discovery.accountsByType.PermissionRecord?.length, 1);
    assert.equal(discovery.settlementLimitModel.globalSettlementVolumeAccumulatorExists, false);
    assert.deepEqual(discovery.settlementLimitModel.volumeScopes, [
        "pathway",
        "asset",
        "counterparty",
        "executor",
    ]);
    const mintAuthority = discovery.knownPdas.find((entry) => entry.name === "mint_authority_pda");
    assert.equal(mintAuthority?.address, rpc.mintAuthority);
    const discoveredRemoteNonce = discovery.accountsByType.RemoteNonce?.[0];
    assert.equal(discoveredRemoteNonce?.canonicalPda?.addressMatches, true);
    assert.equal(discoveredRemoteNonce?.canonicalPda?.storedBumpMatches, true);
    assert.deepEqual(await client.decodeTransactionEvidence(publicKey(92)), []);
});

test("all Chancery account PDA families use the canonical seed encodings", () => {
    const textEncoder = new TextEncoder();
    const signerSetId = new Uint8Array(32).fill(43);
    const changeId = new Uint8Array(32).fill(44);
    const scopeKey = new Uint8Array(32).fill(45);
    const issuedTokenAccount = publicKey(46);
    const assetMint = publicKey(47);
    const destinationTokenAccount = publicKey(48);
    const remoteDomainId = 0x0102_0304_0506_0708n;
    const sourceNonce = 0x1112_1314_1516_1718n;
    const vectors: readonly {
        readonly actual: { readonly address: string; readonly bump: number };
        readonly seeds: readonly Uint8Array[];
    }[] = [
        {
            actual: deriveAuthorityTransferAddress(7),
            seeds: [textEncoder.encode("authority-transfer"), new Uint8Array([7])],
        },
        {
            actual: deriveBasicFreezeRecordAddress(issuedTokenAccount),
            seeds: [textEncoder.encode("basic-freeze-record"), decodePublicKey(issuedTokenAccount)],
        },
        {
            actual: deriveCrossChainSignerSetAddress(signerSetId),
            seeds: [textEncoder.encode("cross-chain-signer-set"), signerSetId],
        },
        {
            actual: deriveOutboundReclaimRecordAddress(2, remoteDomainId, sourceNonce),
            seeds: [
                textEncoder.encode("outbound-reclaim"),
                new Uint8Array([2]),
                unsigned64BigEndianForTest(remoteDomainId),
                unsigned64BigEndianForTest(sourceNonce),
            ],
        },
        {
            actual: derivePendingConfigChangeAddress(changeId),
            seeds: [textEncoder.encode("pending-config-change"), changeId],
        },
        {
            actual: deriveRemoteDomainPolicyAddress(3, remoteDomainId),
            seeds: [
                textEncoder.encode("remote-domain-policy"),
                new Uint8Array([3]),
                unsigned64BigEndianForTest(remoteDomainId),
            ],
        },
        {
            actual: deriveRemoteNonceAddress(4, remoteDomainId, scopeKey),
            seeds: [
                textEncoder.encode("remote-nonce"),
                new Uint8Array([4]),
                unsigned64BigEndianForTest(remoteDomainId),
                scopeKey,
            ],
        },
        {
            actual: deriveReserveDestinationAddress(assetMint, destinationTokenAccount),
            seeds: [
                textEncoder.encode("reserve-destination"),
                decodePublicKey(assetMint),
                decodePublicKey(destinationTokenAccount),
            ],
        },
    ];
    for (let index = 0, length = vectors.length; index < length; index++) {
        const vector = vectors[index];
        if (vector === undefined) {
            continue;
        }
        const expected = findProgramAddress(vector.seeds, CHANCERY_PROGRAM_ADDRESS);
        assert.equal(vector.actual.address, expected.address);
        assert.equal(vector.actual.bump, expected.bump);
    }
});

test("the settlement account schemas carry exact operational account counts", () => {
    assert.equal(CHANCERY_SCHEMA.instructions.mint_direct?.accounts.length, 31);
    assert.equal(CHANCERY_SCHEMA.instructions.redeem_direct?.accounts.length, 31);
    assert.equal(CHANCERY_SCHEMA.instructions.mint_delegated?.accounts.length, 38);
    assert.equal(CHANCERY_SCHEMA.instructions.redeem_delegated?.accounts.length, 38);
    assert.equal(CHANCERY_SCHEMA.instructions.mint_trilateral?.accounts.length, 41);
    assert.equal(CHANCERY_SCHEMA.instructions.redeem_trilateral?.accounts.length, 41);
});
