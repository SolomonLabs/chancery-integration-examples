import { normalizePublicKey } from "./base58.mjs";

function mergeAccountMeta(metas, address, isSigner, isWritable, isProgram, isPayer, firstSeenIndex) {
    const existing = metas.get(address);
    if (existing === undefined) {
        metas.set(address, {
            address,
            isSigner,
            isWritable,
            isProgram,
            isPayer,
            firstSeenIndex,
        });
        return;
    }
    existing.isSigner ||= isSigner;
    existing.isWritable ||= isWritable;
    existing.isProgram ||= isProgram;
    existing.isPayer ||= isPayer;
}

function aggregateAccountMetas(instructions, payerAddress) {
    const payer = normalizePublicKey(payerAddress);
    const metas = new Map();
    let firstSeenIndex = 0;
    mergeAccountMeta(metas, payer, true, true, false, true, firstSeenIndex++);
    for (const instruction of instructions) {
        for (const account of instruction.accounts) {
            mergeAccountMeta(
                metas,
                normalizePublicKey(account.address),
                account.isSigner,
                account.isWritable,
                false,
                false,
                firstSeenIndex++,
            );
        }
        mergeAccountMeta(
            metas,
            normalizePublicKey(instruction.programAddress),
            false,
            false,
            true,
            false,
            firstSeenIndex++,
        );
    }
    return [...metas.values()];
}

function accountOrderGroup(meta) {
    if (meta.isSigner && meta.isWritable) return 0;
    if (meta.isSigner) return 1;
    if (meta.isWritable) return 2;
    return 3;
}

function orderStaticMetas(metas) {
    return [...metas].sort((left, right) => {
        const groupDifference = accountOrderGroup(left) - accountOrderGroup(right);
        return groupDifference === 0 ? left.firstSeenIndex - right.firstSeenIndex : groupDifference;
    });
}

function normalizeLookupTables(addressLookupTables) {
    return addressLookupTables.map((table) => {
        if (!Array.isArray(table.addresses) || table.addresses.length > 256) {
            throw new Error("Address lookup table must contain no more than 256 addresses");
        }
        return {
            address: normalizePublicKey(table.address),
            addresses: table.addresses.map((address) => normalizePublicKey(address)),
        };
    });
}

function placeAccountsInLookupTables(metas, addressLookupTables) {
    const tables = normalizeLookupTables(addressLookupTables);
    const indexesByTable = tables.map((table) => {
        const indexes = new Map();
        for (let index = 0; index < table.addresses.length; index++) {
            if (!indexes.has(table.addresses[index])) indexes.set(table.addresses[index], index);
        }
        return indexes;
    });
    const writableIndexesByTable = tables.map(() => []);
    const readonlyIndexesByTable = tables.map(() => []);
    const staticMetas = [];

    for (const meta of metas) {
        if (meta.isSigner || meta.isProgram || meta.isPayer) {
            staticMetas.push(meta);
            continue;
        }
        let placement;
        for (let tableIndex = 0; tableIndex < indexesByTable.length; tableIndex++) {
            const addressIndex = indexesByTable[tableIndex].get(meta.address);
            if (addressIndex !== undefined) {
                placement = { tableIndex, addressIndex };
                break;
            }
        }
        if (placement === undefined) {
            staticMetas.push(meta);
            continue;
        }
        const indexes = meta.isWritable
            ? writableIndexesByTable[placement.tableIndex]
            : readonlyIndexesByTable[placement.tableIndex];
        indexes.push(placement.addressIndex);
    }

    const writableLoadedAddresses = [];
    const readonlyLoadedAddresses = [];
    const addressTableLookups = [];
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
        const table = tables[tableIndex];
        const writableIndexes = writableIndexesByTable[tableIndex];
        const readonlyIndexes = readonlyIndexesByTable[tableIndex];
        if (writableIndexes.length === 0 && readonlyIndexes.length === 0) continue;
        for (const addressIndex of writableIndexes) {
            writableLoadedAddresses.push(table.addresses[addressIndex]);
        }
        for (const addressIndex of readonlyIndexes) {
            readonlyLoadedAddresses.push(table.addresses[addressIndex]);
        }
        addressTableLookups.push({
            accountKey: table.address,
            writableIndexes,
            readonlyIndexes,
        });
    }
    return {
        staticMetas,
        writableLoadedAddresses,
        readonlyLoadedAddresses,
        addressTableLookups,
    };
}

export function compileSquadsVaultMessage(instructions, vaultAddress, addressLookupTables = []) {
    const aggregated = aggregateAccountMetas(instructions, vaultAddress);
    const placement = placeAccountsInLookupTables(aggregated, addressLookupTables);
    const staticMetas = orderStaticMetas(placement.staticMetas);
    const accountKeys = staticMetas.map((meta) => meta.address);
    const numSigners = staticMetas.filter((meta) => meta.isSigner).length;
    const numWritableSigners = staticMetas.filter((meta) => meta.isSigner && meta.isWritable).length;
    const numWritableNonSigners = staticMetas.filter((meta) => !meta.isSigner && meta.isWritable).length;
    if (accountKeys.length > 255 || instructions.length > 255 || placement.addressTableLookups.length > 255) {
        throw new Error("Squads small-vector count exceeds 255");
    }

    const accountIndexByAddress = new Map();
    for (let index = 0; index < accountKeys.length; index++) {
        accountIndexByAddress.set(accountKeys[index], index);
    }
    let nextIndex = accountKeys.length;
    for (const address of placement.writableLoadedAddresses) {
        accountIndexByAddress.set(address, nextIndex++);
    }
    for (const address of placement.readonlyLoadedAddresses) {
        accountIndexByAddress.set(address, nextIndex++);
    }
    if (nextIndex > 256) {
        throw new Error("Squads vault message exceeds 256 total account keys");
    }

    const compiledInstructions = instructions.map((instruction) => {
        const programAddress = normalizePublicKey(instruction.programAddress);
        const programIdIndex = accountIndexByAddress.get(programAddress);
        if (programIdIndex === undefined || programIdIndex >= accountKeys.length) {
            throw new Error("Instruction program address is absent from static account keys");
        }
        if (instruction.accounts.length > 255 || instruction.data.length > 65535) {
            throw new Error("Instruction exceeds Squads small-vector limits");
        }
        const accountIndexes = instruction.accounts.map((account) => {
            const address = normalizePublicKey(account.address);
            const accountIndex = accountIndexByAddress.get(address);
            if (accountIndex === undefined) {
                throw new Error("Instruction account is absent from compiled account keys: " + address);
            }
            return accountIndex;
        });
        return {
            programIdIndex,
            accountIndexes,
            data: new Uint8Array(instruction.data),
        };
    });

    return {
        numSigners,
        numWritableSigners,
        numWritableNonSigners,
        accountKeys,
        instructions: compiledInstructions,
        addressTableLookups: placement.addressTableLookups,
    };
}
