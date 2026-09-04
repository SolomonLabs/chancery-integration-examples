import { assertPublicKey } from "./base58.ts";
import type {
    AccountMetaSpec,
    DirectSettlementPolicyAccountsInput,
    InstructionSpec,
    MintDirectOperationInput,
    RedeemDirectOperationInput,
} from "./model.ts";

export const CHANCERY_PROGRAM_ID = "ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz";
export const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
export const MAXIMUM_U64 = 18_446_744_073_709_551_615n;

const MINT_DIRECT_DISCRIMINATOR = Uint8Array.of(4, 1);
const REDEEM_DIRECT_DISCRIMINATOR = Uint8Array.of(4, 2);

function requiredAccount(name: string, address: string, isWritable: boolean): AccountMetaSpec {
    assertPublicKey(address, `accounts.${name}`, false);
    return { name, address, isSigner: name === "principal", isWritable };
}

function optionalAccount(
    name: string,
    address: string | null,
    isWritable: boolean,
): AccountMetaSpec {
    if (address === null) {
        return {
            name,
            address: DEFAULT_PUBLIC_KEY,
            isSigner: false,
            isWritable,
        };
    }
    assertPublicKey(address, `accounts.policyAccounts.${name}`, false);
    return { name, address, isSigner: false, isWritable };
}

function policyAccountMetas(
    policyAccounts: DirectSettlementPolicyAccountsInput,
): readonly AccountMetaSpec[] {
    return [
        optionalAccount("feePolicy", policyAccounts.feePolicy, false),
        optionalAccount(
            "feeRecipientTokenAccount",
            policyAccounts.feeRecipientTokenAccount,
            true,
        ),
        optionalAccount("limitPolicy", policyAccounts.limitPolicy, false),
        optionalAccount("hourlyUsageWindow", policyAccounts.hourlyUsageWindow, true),
        optionalAccount("dailyUsageWindow", policyAccounts.dailyUsageWindow, true),
        optionalAccount("weeklyUsageWindow", policyAccounts.weeklyUsageWindow, true),
        optionalAccount("monthlyUsageWindow", policyAccounts.monthlyUsageWindow, true),
        optionalAccount("evidencePolicy", policyAccounts.evidencePolicy, false),
        optionalAccount("assetLimitPolicy", policyAccounts.assetLimitPolicy, false),
        optionalAccount(
            "assetDailyUsageWindow",
            policyAccounts.assetDailyUsageWindow,
            true,
        ),
        optionalAccount(
            "counterpartyLimitPolicy",
            policyAccounts.counterpartyLimitPolicy,
            false,
        ),
        optionalAccount(
            "counterpartyDailyUsageWindow",
            policyAccounts.counterpartyDailyUsageWindow,
            true,
        ),
    ];
}

export function parsePathwayId(pathwayId: string): Uint8Array {
    const normalized = pathwayId.startsWith("0x") ? pathwayId.slice(2) : pathwayId;
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error("pathwayId must contain exactly 64 hexadecimal characters");
    }
    return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function parseUnsignedU64(value: string, fieldName: string, allowZero: boolean): bigint {
    if (!/^[0-9]+$/.test(value)) {
        throw new Error(`${fieldName} must be an unsigned decimal string`);
    }
    const parsed = BigInt(value);
    if ((!allowZero && parsed === 0n) || parsed > MAXIMUM_U64) {
        const rangeStart = allowZero ? "0" : "1";
        throw new Error(`${fieldName} must be between ${rangeStart} and ${MAXIMUM_U64}`);
    }
    return parsed;
}

function encodeDirectSettlementData(
    discriminator: Uint8Array,
    pathwayId: string,
    amount: string,
    minimumOutput: string,
): Uint8Array {
    const data = new Uint8Array(50);
    data.set(discriminator, 0);
    data.set(parsePathwayId(pathwayId), 2);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setBigUint64(34, parseUnsignedU64(amount, "amount", false), true);
    view.setBigUint64(42, parseUnsignedU64(minimumOutput, "minimumOutput", true), true);
    return data;
}

export function buildMintDirectInstruction(
    operation: MintDirectOperationInput,
): InstructionSpec {
    const accounts = operation.accounts;
    const metas: AccountMetaSpec[] = [
        requiredAccount("moduleActivationState", accounts.moduleActivationState, false),
        requiredAccount("chanceryConfig", accounts.chanceryConfig, true),
        requiredAccount("eventAuthority", accounts.eventAuthority, false),
        requiredAccount("pauseState", accounts.pauseState, false),
        requiredAccount("assetConfig", accounts.assetConfig, false),
        requiredAccount("pathwayPolicy", accounts.pathwayPolicy, false),
        requiredAccount("permissionRecord", accounts.permissionRecord, false),
        requiredAccount("sourceAssetTokenAccount", accounts.sourceAssetTokenAccount, true),
        requiredAccount("reserveAssetTokenAccount", accounts.reserveAssetTokenAccount, true),
        requiredAccount(
            "destinationIssuedTokenAccount",
            accounts.destinationIssuedTokenAccount,
            true,
        ),
        requiredAccount("assetMint", accounts.assetMint, false),
        requiredAccount("issuedTokenMint", accounts.issuedTokenMint, true),
        requiredAccount("mintAuthorityPda", accounts.mintAuthorityPda, false),
        requiredAccount("assetTokenProgram", accounts.assetTokenProgram, false),
        requiredAccount("issuedTokenProgram", accounts.issuedTokenProgram, false),
        requiredAccount("principal", accounts.principal, false),
        requiredAccount("assetPauseState", accounts.assetPauseState, false),
        requiredAccount("issuedTokenControl", accounts.issuedTokenControl, false),
        ...policyAccountMetas(accounts.policyAccounts),
        {
            name: "eventProgram",
            address: CHANCERY_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
    ];

    if (metas.length !== 31) {
        throw new Error(`mint_direct must contain 31 account positions, received ${metas.length}`);
    }
    return {
        programId: CHANCERY_PROGRAM_ID,
        accounts: metas,
        data: encodeDirectSettlementData(
            MINT_DIRECT_DISCRIMINATOR,
            operation.pathwayId,
            operation.amount,
            operation.minimumOutput,
        ),
    };
}

export function buildRedeemDirectInstruction(
    operation: RedeemDirectOperationInput,
): InstructionSpec {
    const accounts = operation.accounts;
    const metas: AccountMetaSpec[] = [
        requiredAccount("moduleActivationState", accounts.moduleActivationState, false),
        requiredAccount("chanceryConfig", accounts.chanceryConfig, true),
        requiredAccount("eventAuthority", accounts.eventAuthority, false),
        requiredAccount("pauseState", accounts.pauseState, false),
        requiredAccount("assetConfig", accounts.assetConfig, false),
        requiredAccount("pathwayPolicy", accounts.pathwayPolicy, false),
        requiredAccount("permissionRecord", accounts.permissionRecord, false),
        requiredAccount("sourceIssuedTokenAccount", accounts.sourceIssuedTokenAccount, true),
        requiredAccount("reserveAssetTokenAccount", accounts.reserveAssetTokenAccount, true),
        requiredAccount("destinationAssetTokenAccount", accounts.destinationAssetTokenAccount, true),
        requiredAccount("assetMint", accounts.assetMint, false),
        requiredAccount("issuedTokenMint", accounts.issuedTokenMint, true),
        requiredAccount("reserveAuthorityPda", accounts.reserveAuthorityPda, false),
        requiredAccount("assetTokenProgram", accounts.assetTokenProgram, false),
        requiredAccount("issuedTokenProgram", accounts.issuedTokenProgram, false),
        requiredAccount("principal", accounts.principal, false),
        requiredAccount("assetPauseState", accounts.assetPauseState, false),
        requiredAccount("issuedTokenControl", accounts.issuedTokenControl, false),
        ...policyAccountMetas(accounts.policyAccounts),
        {
            name: "eventProgram",
            address: CHANCERY_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
    ];

    if (metas.length !== 31) {
        throw new Error(`redeem_direct must contain 31 account positions, received ${metas.length}`);
    }
    return {
        programId: CHANCERY_PROGRAM_ID,
        accounts: metas,
        data: encodeDirectSettlementData(
            REDEEM_DIRECT_DISCRIMINATOR,
            operation.pathwayId,
            operation.amount,
            operation.minimumOutput,
        ),
    };
}
