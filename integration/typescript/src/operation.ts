import { readFileSync } from "node:fs";
import type {
    DirectSettlementPolicyAccountsInput,
    MintDirectAccountsInput,
    MintDirectOperationInput,
    RedeemDirectAccountsInput,
    RedeemDirectOperationInput,
} from "./model.ts";

const ROOT_FIELDS = new Set(["pathwayId", "amount", "minimumOutput", "accounts"]);
const POLICY_FIELDS = new Set([
    "feePolicy",
    "feeRecipientTokenAccount",
    "limitPolicy",
    "hourlyUsageWindow",
    "dailyUsageWindow",
    "weeklyUsageWindow",
    "monthlyUsageWindow",
    "evidencePolicy",
    "assetLimitPolicy",
    "assetDailyUsageWindow",
    "counterpartyLimitPolicy",
    "counterpartyDailyUsageWindow",
]);
const MINT_ACCOUNT_FIELDS = new Set([
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceAssetTokenAccount",
    "reserveAssetTokenAccount",
    "destinationIssuedTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "mintAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "policyAccounts",
]);
const REDEEM_ACCOUNT_FIELDS = new Set([
    "moduleActivationState",
    "chanceryConfig",
    "eventAuthority",
    "pauseState",
    "assetConfig",
    "pathwayPolicy",
    "permissionRecord",
    "sourceIssuedTokenAccount",
    "reserveAssetTokenAccount",
    "destinationAssetTokenAccount",
    "assetMint",
    "issuedTokenMint",
    "reserveAuthorityPda",
    "assetTokenProgram",
    "issuedTokenProgram",
    "principal",
    "assetPauseState",
    "issuedTokenControl",
    "policyAccounts",
]);

function readDocument(filePath: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Operation document must be a JSON object");
    }
    return parsed as Record<string, unknown>;
}

function rejectUnknownFields(
    document: Record<string, unknown>,
    allowedFields: ReadonlySet<string>,
    location: string,
): void {
    for (const field of Object.keys(document)) {
        if (!allowedFields.has(field)) {
            throw new Error(`Unknown field ${location}.${field}`);
        }
    }
}

function readPolicyAccounts(value: unknown): DirectSettlementPolicyAccountsInput {
    if (value === null || Array.isArray(value) || typeof value !== "object") {
        throw new Error("accounts.policyAccounts must be a JSON object");
    }
    const policy = value as Record<string, unknown>;
    rejectUnknownFields(policy, POLICY_FIELDS, "accounts.policyAccounts");

    for (const field of POLICY_FIELDS) {
        const account = policy[field];
        if (account !== null && typeof account !== "string") {
            throw new Error(`accounts.policyAccounts.${field} must be a string or null`);
        }
    }
    return policy as unknown as DirectSettlementPolicyAccountsInput;
}

function readRequiredString(
    document: Record<string, unknown>,
    field: string,
    location: string,
): string {
    const value = document[field];
    if (typeof value !== "string") {
        throw new Error(`${location}.${field} must be a string`);
    }
    return value;
}

export function loadMintDirectOperation(filePath: string): MintDirectOperationInput {
    const root = readDocument(filePath);
    rejectUnknownFields(root, ROOT_FIELDS, "operation");
    const accountsValue = root.accounts;
    if (accountsValue === null || Array.isArray(accountsValue) || typeof accountsValue !== "object") {
        throw new Error("operation.accounts must be a JSON object");
    }
    const accountsDocument = accountsValue as Record<string, unknown>;
    rejectUnknownFields(accountsDocument, MINT_ACCOUNT_FIELDS, "accounts");

    const accounts: MintDirectAccountsInput = {
        moduleActivationState: readRequiredString(accountsDocument, "moduleActivationState", "accounts"),
        chanceryConfig: readRequiredString(accountsDocument, "chanceryConfig", "accounts"),
        eventAuthority: readRequiredString(accountsDocument, "eventAuthority", "accounts"),
        pauseState: readRequiredString(accountsDocument, "pauseState", "accounts"),
        assetConfig: readRequiredString(accountsDocument, "assetConfig", "accounts"),
        pathwayPolicy: readRequiredString(accountsDocument, "pathwayPolicy", "accounts"),
        permissionRecord: readRequiredString(accountsDocument, "permissionRecord", "accounts"),
        sourceAssetTokenAccount: readRequiredString(
            accountsDocument,
            "sourceAssetTokenAccount",
            "accounts",
        ),
        reserveAssetTokenAccount: readRequiredString(
            accountsDocument,
            "reserveAssetTokenAccount",
            "accounts",
        ),
        destinationIssuedTokenAccount: readRequiredString(
            accountsDocument,
            "destinationIssuedTokenAccount",
            "accounts",
        ),
        assetMint: readRequiredString(accountsDocument, "assetMint", "accounts"),
        issuedTokenMint: readRequiredString(accountsDocument, "issuedTokenMint", "accounts"),
        mintAuthorityPda: readRequiredString(accountsDocument, "mintAuthorityPda", "accounts"),
        assetTokenProgram: readRequiredString(accountsDocument, "assetTokenProgram", "accounts"),
        issuedTokenProgram: readRequiredString(
            accountsDocument,
            "issuedTokenProgram",
            "accounts",
        ),
        principal: readRequiredString(accountsDocument, "principal", "accounts"),
        assetPauseState: readRequiredString(accountsDocument, "assetPauseState", "accounts"),
        issuedTokenControl: readRequiredString(
            accountsDocument,
            "issuedTokenControl",
            "accounts",
        ),
        policyAccounts: readPolicyAccounts(accountsDocument.policyAccounts),
    };

    return {
        pathwayId: readRequiredString(root, "pathwayId", "operation"),
        amount: readRequiredString(root, "amount", "operation"),
        minimumOutput: readRequiredString(root, "minimumOutput", "operation"),
        accounts,
    };
}

export function loadRedeemDirectOperation(filePath: string): RedeemDirectOperationInput {
    const root = readDocument(filePath);
    rejectUnknownFields(root, ROOT_FIELDS, "operation");
    const accountsValue = root.accounts;
    if (accountsValue === null || Array.isArray(accountsValue) || typeof accountsValue !== "object") {
        throw new Error("operation.accounts must be a JSON object");
    }
    const accountsDocument = accountsValue as Record<string, unknown>;
    rejectUnknownFields(accountsDocument, REDEEM_ACCOUNT_FIELDS, "accounts");

    const accounts: RedeemDirectAccountsInput = {
        moduleActivationState: readRequiredString(accountsDocument, "moduleActivationState", "accounts"),
        chanceryConfig: readRequiredString(accountsDocument, "chanceryConfig", "accounts"),
        eventAuthority: readRequiredString(accountsDocument, "eventAuthority", "accounts"),
        pauseState: readRequiredString(accountsDocument, "pauseState", "accounts"),
        assetConfig: readRequiredString(accountsDocument, "assetConfig", "accounts"),
        pathwayPolicy: readRequiredString(accountsDocument, "pathwayPolicy", "accounts"),
        permissionRecord: readRequiredString(accountsDocument, "permissionRecord", "accounts"),
        sourceIssuedTokenAccount: readRequiredString(
            accountsDocument,
            "sourceIssuedTokenAccount",
            "accounts",
        ),
        reserveAssetTokenAccount: readRequiredString(
            accountsDocument,
            "reserveAssetTokenAccount",
            "accounts",
        ),
        destinationAssetTokenAccount: readRequiredString(
            accountsDocument,
            "destinationAssetTokenAccount",
            "accounts",
        ),
        assetMint: readRequiredString(accountsDocument, "assetMint", "accounts"),
        issuedTokenMint: readRequiredString(accountsDocument, "issuedTokenMint", "accounts"),
        reserveAuthorityPda: readRequiredString(
            accountsDocument,
            "reserveAuthorityPda",
            "accounts",
        ),
        assetTokenProgram: readRequiredString(accountsDocument, "assetTokenProgram", "accounts"),
        issuedTokenProgram: readRequiredString(
            accountsDocument,
            "issuedTokenProgram",
            "accounts",
        ),
        principal: readRequiredString(accountsDocument, "principal", "accounts"),
        assetPauseState: readRequiredString(accountsDocument, "assetPauseState", "accounts"),
        issuedTokenControl: readRequiredString(
            accountsDocument,
            "issuedTokenControl",
            "accounts",
        ),
        policyAccounts: readPolicyAccounts(accountsDocument.policyAccounts),
    };

    return {
        pathwayId: readRequiredString(root, "pathwayId", "operation"),
        amount: readRequiredString(root, "amount", "operation"),
        minimumOutput: readRequiredString(root, "minimumOutput", "operation"),
        accounts,
    };
}
