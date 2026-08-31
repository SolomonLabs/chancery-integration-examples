import { normalizePublicKey } from "./Base58Codec.js";
import { decodeBase64, encodeBase64 } from "./BinaryCodec.js";
import { decodeChanceryAccount, type DecodedChanceryAccount } from "./ChanceryAccount.js";
import {
    decodeChanceryEventsFromRpcTransaction,
    type ChanceryEventOccurrence,
} from "./ChanceryEvent.js";

export type RpcCommitment = "processed" | "confirmed" | "finalized";

export interface RpcAccountInfo {
    readonly data: Uint8Array;
    readonly executable: boolean;
    readonly lamports: bigint;
    readonly owner: string;
    readonly rentEpoch: bigint;
    readonly space: number;
}

export interface RpcAddressAccountInfo {
    readonly address: string;
    readonly account: RpcAccountInfo;
}

export interface RpcMemcmpFilter {
    readonly memcmp: {
        readonly offset: number;
        readonly bytes: string;
        readonly encoding?: "base58" | "base64";
    };
}

export interface RpcDataSizeFilter {
    readonly dataSize: number;
}

export type RpcProgramAccountFilter = RpcMemcmpFilter | RpcDataSizeFilter;

export interface RpcLatestBlockhash {
    readonly blockhash: string;
    readonly lastValidBlockHeight: bigint;
}

export interface RpcEpochInfo {
    readonly epoch: bigint;
    readonly slotIndex: bigint;
    readonly slotsInEpoch: bigint;
    readonly absoluteSlot: bigint;
    readonly blockHeight: bigint | null;
    readonly transactionCount: bigint | null;
}

export interface RpcClock {
    readonly slot: bigint;
    readonly epochStartUnixTimestamp: bigint;
    readonly epoch: bigint;
    readonly leaderScheduleEpoch: bigint;
    readonly unixTimestamp: bigint;
}

export interface RpcSimulationResult {
    readonly err: unknown;
    readonly logs: readonly string[] | null;
    readonly unitsConsumed: bigint | null;
    readonly returnData: unknown;
    readonly accounts: unknown;
    readonly raw: Readonly<Record<string, unknown>>;
}

export interface RpcSignatureStatus {
    readonly slot: bigint;
    readonly confirmations: bigint | null;
    readonly err: unknown;
    readonly confirmationStatus: RpcCommitment | null;
}

interface RpcErrorValue {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}

export class ChanceryRpc {
    readonly #endpoint: string;
    #requestId = 0;
    #minimumContextSlot: bigint | null = null;

    constructor(endpoint: string) {
        const parsedEndpoint = new URL(endpoint);
        if (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") {
            throw new Error("RPC endpoint must use HTTP or HTTPS");
        }
        this.#endpoint = parsedEndpoint.toString();
    }

    setMinimumContextSlot(slot: bigint | null): void {
        if (slot !== null && slot < 0n) {
            throw new Error("Minimum context slot must be nonnegative");
        }
        this.#minimumContextSlot = slot;
    }

    async request<Result>(method: string, parameters: readonly unknown[]): Promise<Result> {
        this.#requestId++;
        const response = await fetch(this.#endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: this.#requestId,
                method,
                params: parameters,
            }),
        });
        if (!response.ok) {
            throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`);
        }
        const responseValue: unknown = (await response.json()) as unknown;
        if (typeof responseValue !== "object" || responseValue === null) {
            throw new Error("RPC response root must be an object");
        }
        const responseRecord = responseValue as Readonly<Record<string, unknown>>;
        if (responseRecord.error !== undefined) {
            const rpcError = parseRpcError(responseRecord.error);
            const detail = rpcError.data === undefined ? "" : ` ${JSON.stringify(rpcError.data)}`;
            throw new Error(`RPC ${rpcError.code}: ${rpcError.message}${detail}`);
        }
        if (!("result" in responseRecord)) {
            throw new Error("RPC response has no result field");
        }
        return responseRecord.result as Result;
    }

    async getAccountInfo(
        address: string | Uint8Array,
        commitment: RpcCommitment = "confirmed",
    ): Promise<RpcAccountInfo | null> {
        const result = await this.request<unknown>("getAccountInfo", [
            normalizePublicKey(address),
            this.#contextConfiguration({ encoding: "base64", commitment }),
        ]);
        return parseAccountInfoResult(result);
    }

    async getMultipleAccounts(
        addresses: readonly (string | Uint8Array)[],
        commitment: RpcCommitment = "confirmed",
    ): Promise<readonly (RpcAccountInfo | null)[]> {
        const normalizedAddresses: string[] = [];
        for (let index = 0, length = addresses.length; index < length; index++) {
            const address = addresses[index];
            if (address !== undefined) {
                normalizedAddresses.push(normalizePublicKey(address));
            }
        }
        const result = await this.request<unknown>("getMultipleAccounts", [
            normalizedAddresses,
            this.#contextConfiguration({ encoding: "base64", commitment }),
        ]);
        const resultRecord = recordFromUnknown(result, "getMultipleAccounts result");
        const values = resultRecord.value;
        if (!Array.isArray(values)) {
            throw new Error("getMultipleAccounts result.value must be an array");
        }
        const accounts: (RpcAccountInfo | null)[] = [];
        for (let index = 0, length = values.length; index < length; index++) {
            const value = values[index];
            accounts.push(value === null ? null : parseAccountInfoValue(value));
        }
        return accounts;
    }

    async getProgramAccounts(
        programAddress: string | Uint8Array,
        filters: readonly RpcProgramAccountFilter[] = [],
        commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        const result = await this.request<unknown>("getProgramAccounts", [
            normalizePublicKey(programAddress),
            this.#contextConfiguration({
                encoding: "base64",
                commitment,
                filters,
            }),
        ]);
        if (!Array.isArray(result)) {
            throw new Error("getProgramAccounts result must be an array");
        }
        const accounts: RpcAddressAccountInfo[] = [];
        for (let index = 0, length = result.length; index < length; index++) {
            const item = recordFromUnknown(result[index], `getProgramAccounts[${index}]`);
            if (typeof item.pubkey !== "string") {
                throw new Error(`getProgramAccounts[${index}].pubkey must be a string`);
            }
            accounts.push({
                address: normalizePublicKey(item.pubkey),
                account: parseAccountInfoValue(item.account),
            });
        }
        return accounts;
    }

    async getTokenAccountsByOwner(
        owner: string | Uint8Array,
        mint: string | Uint8Array,
        commitment: RpcCommitment = "confirmed",
    ): Promise<readonly RpcAddressAccountInfo[]> {
        const result = await this.request<unknown>("getTokenAccountsByOwner", [
            normalizePublicKey(owner),
            { mint: normalizePublicKey(mint) },
            this.#contextConfiguration({ encoding: "base64", commitment }),
        ]);
        const resultRecord = recordFromUnknown(result, "getTokenAccountsByOwner result");
        const values = resultRecord.value;
        if (!Array.isArray(values)) {
            throw new Error("getTokenAccountsByOwner result.value must be an array");
        }
        const accounts: RpcAddressAccountInfo[] = [];
        for (let index = 0, length = values.length; index < length; index++) {
            const item = recordFromUnknown(values[index], `getTokenAccountsByOwner.value[${index}]`);
            if (typeof item.pubkey !== "string") {
                throw new Error(`getTokenAccountsByOwner.value[${index}].pubkey must be a string`);
            }
            accounts.push({
                address: normalizePublicKey(item.pubkey),
                account: parseAccountInfoValue(item.account),
            });
        }
        return accounts;
    }

    async getLatestBlockhash(
        commitment: RpcCommitment = "confirmed",
    ): Promise<RpcLatestBlockhash> {
        const result = await this.request<unknown>(
            "getLatestBlockhash",
            [this.#contextConfiguration({ commitment })],
        );
        const resultRecord = recordFromUnknown(result, "getLatestBlockhash result");
        const valueRecord = recordFromUnknown(resultRecord.value, "getLatestBlockhash result.value");
        if (typeof valueRecord.blockhash !== "string") {
            throw new Error("getLatestBlockhash blockhash must be a string");
        }
        return {
            blockhash: normalizePublicKey(valueRecord.blockhash),
            lastValidBlockHeight: parseUnsignedBigInteger(
                valueRecord.lastValidBlockHeight,
                "getLatestBlockhash lastValidBlockHeight",
            ),
        };
    }

    async getBlockHeight(commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        const result = await this.request<unknown>("getBlockHeight", [{ commitment }]);
        return parseUnsignedBigInteger(result, "getBlockHeight result");
    }

    async getSlot(commitment: RpcCommitment = "confirmed"): Promise<bigint> {
        const result = await this.request<unknown>("getSlot", [{ commitment }]);
        return parseUnsignedBigInteger(result, "getSlot result");
    }

    async getBlockTime(slot: bigint): Promise<bigint | null> {
        if (slot < 0n || slot > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("getBlockTime slot exceeds the safe integer range");
        }
        const result = await this.request<unknown>("getBlockTime", [Number(slot)]);
        if (result === null) {
            return null;
        }
        if (typeof result === "number" && Number.isSafeInteger(result)) {
            return BigInt(result);
        }
        if (typeof result === "string" && /^-?(0|[1-9][0-9]*)$/.test(result)) {
            return BigInt(result);
        }
        throw new Error("getBlockTime result must be an integer or null");
    }

    async getClock(commitment: RpcCommitment = "confirmed"): Promise<RpcClock> {
        const account = await this.getAccountInfo(
            "SysvarC1ock11111111111111111111111111111111",
            commitment,
        );
        if (account === null || account.data.length < 40) {
            throw new Error("Clock sysvar account is unavailable or truncated");
        }
        const view = new DataView(
            account.data.buffer,
            account.data.byteOffset,
            account.data.byteLength,
        );
        return {
            slot: view.getBigUint64(0, true),
            epochStartUnixTimestamp: view.getBigInt64(8, true),
            epoch: view.getBigUint64(16, true),
            leaderScheduleEpoch: view.getBigUint64(24, true),
            unixTimestamp: view.getBigInt64(32, true),
        };
    }

    async getEpochInfo(commitment: RpcCommitment = "confirmed"): Promise<RpcEpochInfo> {
        const result = await this.request<unknown>(
            "getEpochInfo",
            [this.#contextConfiguration({ commitment })],
        );
        const resultRecord = recordFromUnknown(result, "getEpochInfo result");
        return {
            epoch: parseUnsignedBigInteger(resultRecord.epoch, "getEpochInfo epoch"),
            slotIndex: parseUnsignedBigInteger(resultRecord.slotIndex, "getEpochInfo slotIndex"),
            slotsInEpoch: parseUnsignedBigInteger(resultRecord.slotsInEpoch, "getEpochInfo slotsInEpoch"),
            absoluteSlot: parseUnsignedBigInteger(resultRecord.absoluteSlot, "getEpochInfo absoluteSlot"),
            blockHeight: resultRecord.blockHeight === undefined || resultRecord.blockHeight === null
                ? null
                : parseUnsignedBigInteger(resultRecord.blockHeight, "getEpochInfo blockHeight"),
            transactionCount: resultRecord.transactionCount === undefined || resultRecord.transactionCount === null
                ? null
                : parseUnsignedBigInteger(resultRecord.transactionCount, "getEpochInfo transactionCount"),
        };
    }

    async simulateTransaction(
        transaction: Uint8Array,
        commitment: RpcCommitment = "confirmed",
        signatureVerification = true,
    ): Promise<RpcSimulationResult> {
        const result = await this.request<unknown>("simulateTransaction", [
            encodeBase64(transaction),
            {
                encoding: "base64",
                commitment,
                sigVerify: signatureVerification,
                replaceRecentBlockhash: false,
            },
        ]);
        const resultRecord = recordFromUnknown(result, "simulateTransaction result");
        const valueRecord = recordFromUnknown(resultRecord.value, "simulateTransaction result.value");
        const logsValue = valueRecord.logs;
        let logs: readonly string[] | null = null;
        if (logsValue !== null && logsValue !== undefined) {
            if (!Array.isArray(logsValue)) {
                throw new Error("simulateTransaction logs must be an array or null");
            }
            const parsedLogs: string[] = [];
            for (let index = 0, length = logsValue.length; index < length; index++) {
                const logValue = logsValue[index];
                if (typeof logValue !== "string") {
                    throw new Error(`simulateTransaction logs[${index}] must be a string`);
                }
                parsedLogs.push(logValue);
            }
            logs = parsedLogs;
        }
        const unitsConsumed = valueRecord.unitsConsumed === undefined || valueRecord.unitsConsumed === null
            ? null
            : parseUnsignedBigInteger(valueRecord.unitsConsumed, "simulateTransaction unitsConsumed");
        return {
            err: valueRecord.err ?? null,
            logs,
            unitsConsumed,
            returnData: valueRecord.returnData ?? null,
            accounts: valueRecord.accounts ?? null,
            raw: valueRecord,
        };
    }

    async sendTransaction(
        transaction: Uint8Array,
        commitment: RpcCommitment = "confirmed",
        skipPreflight = false,
        maximumRetries = 5,
    ): Promise<string> {
        const result = await this.request<unknown>("sendTransaction", [
            encodeBase64(transaction),
            {
                encoding: "base64",
                preflightCommitment: commitment,
                skipPreflight,
                maxRetries: maximumRetries,
            },
        ]);
        if (typeof result !== "string") {
            throw new Error("sendTransaction result must be a signature string");
        }
        return result;
    }

    async getSignatureStatus(signature: string): Promise<RpcSignatureStatus | null> {
        const result = await this.request<unknown>("getSignatureStatuses", [[signature], {
            searchTransactionHistory: true,
        }]);
        const resultRecord = recordFromUnknown(result, "getSignatureStatuses result");
        const values = resultRecord.value;
        if (!Array.isArray(values) || values.length !== 1) {
            throw new Error("getSignatureStatuses result.value must contain one entry");
        }
        const statusValue = values[0];
        if (statusValue === null) {
            return null;
        }
        const statusRecord = recordFromUnknown(statusValue, "getSignatureStatuses status");
        const confirmationStatus = statusRecord.confirmationStatus;
        if (
            confirmationStatus !== undefined &&
            confirmationStatus !== null &&
            confirmationStatus !== "processed" &&
            confirmationStatus !== "confirmed" &&
            confirmationStatus !== "finalized"
        ) {
            throw new Error("getSignatureStatuses confirmationStatus is invalid");
        }
        const confirmations = statusRecord.confirmations === null
            ? null
            : parseUnsignedBigInteger(statusRecord.confirmations, "getSignatureStatuses confirmations");
        return {
            slot: parseUnsignedBigInteger(statusRecord.slot, "getSignatureStatuses slot"),
            confirmations,
            err: statusRecord.err ?? null,
            confirmationStatus: confirmationStatus ?? null,
        };
    }

    async getTransaction(signature: string, commitment: RpcCommitment = "confirmed"): Promise<unknown | null> {
        return this.request<unknown | null>("getTransaction", [signature, {
            encoding: "json",
            commitment,
            maxSupportedTransactionVersion: 0,
        }]);
    }

    async getDecodedChanceryAccount(
        address: string | Uint8Array,
        commitment: RpcCommitment = "confirmed",
    ): Promise<DecodedChanceryAccount | null> {
        const accountInfo = await this.getAccountInfo(address, commitment);
        return accountInfo === null ? null : decodeChanceryAccount(accountInfo.data);
    }

    async getChanceryEvents(
        signature: string,
        commitment: RpcCommitment = "confirmed",
    ): Promise<readonly ChanceryEventOccurrence[] | null> {
        const result = await this.getTransaction(signature, commitment);
        if (result === null) {
            return null;
        }
        return decodeChanceryEventsFromRpcTransaction(result);
    }

    #contextConfiguration(
        configuration: Readonly<Record<string, unknown>>,
    ): Readonly<Record<string, unknown>> {
        if (this.#minimumContextSlot === null) {
            return configuration;
        }
        if (this.#minimumContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("Minimum context slot exceeds the safe integer range");
        }
        return {
            ...configuration,
            minContextSlot: Number(this.#minimumContextSlot),
        };
    }
}

function recordFromUnknown(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function parseRpcError(value: unknown): RpcErrorValue {
    const errorRecord = recordFromUnknown(value, "RPC error");
    if (typeof errorRecord.code !== "number" || typeof errorRecord.message !== "string") {
        throw new Error("RPC error requires numeric code and string message fields");
    }
    const parsed: RpcErrorValue = {
        code: errorRecord.code,
        message: errorRecord.message,
    };
    if (errorRecord.data !== undefined) {
        return { ...parsed, data: errorRecord.data };
    }
    return parsed;
}

function parseAccountInfoResult(result: unknown): RpcAccountInfo | null {
    const resultRecord = recordFromUnknown(result, "getAccountInfo result");
    const value = resultRecord.value;
    return value === null ? null : parseAccountInfoValue(value);
}

function parseAccountInfoValue(value: unknown): RpcAccountInfo {
    const accountRecord = recordFromUnknown(value, "RPC account value");
    if (
        !Array.isArray(accountRecord.data) ||
        typeof accountRecord.data[0] !== "string" ||
        accountRecord.data[1] !== "base64" ||
        typeof accountRecord.executable !== "boolean" ||
        typeof accountRecord.owner !== "string"
    ) {
        throw new Error("RPC account value has an unsupported shape");
    }
    const lamports = parseUnsignedBigInteger(accountRecord.lamports, "RPC account lamports");
    const rentEpoch = parseUnsignedBigInteger(accountRecord.rentEpoch, "RPC account rentEpoch");
    const spaceValue = accountRecord.space;
    const data = decodeBase64(accountRecord.data[0]);
    let space = data.length;
    if (spaceValue !== undefined) {
        const parsedSpace = parseUnsignedBigInteger(spaceValue, "RPC account space");
        if (parsedSpace > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("RPC account space exceeds the safe integer range");
        }
        space = Number(parsedSpace);
    }
    return {
        data,
        executable: accountRecord.executable,
        lamports,
        owner: normalizePublicKey(accountRecord.owner),
        rentEpoch,
        space,
    };
}

function parseUnsignedBigInteger(value: unknown, fieldName: string): bigint {
    if (typeof value === "bigint") {
        if (value < 0n) {
            throw new Error(`${fieldName} must be an unsigned integer`);
        }
        return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return BigInt(value);
    }
    if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
        return BigInt(value);
    }
    throw new Error(`${fieldName} must be an unsigned integer`);
}
