import { decodePublicKey, normalizePublicKey } from "./base58.mjs";
import { concatenateBytes } from "./wire.mjs";

const SIGNATURE_BYTES = 64;

export function encodeShortVectorLength(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Short-vector length must be a safe unsigned integer");
    }
    const bytes = [];
    let remaining = value;
    do {
        let byteValue = remaining & 0x7f;
        remaining = Math.floor(remaining / 128);
        if (remaining > 0) byteValue |= 0x80;
        bytes.push(byteValue);
    } while (remaining > 0);
    return new Uint8Array(bytes);
}

function mergeAccountMeta(metas, address, isSigner, isWritable, isProgram, firstSeenIndex) {
    const existing = metas.get(address);
    if (existing === undefined) {
        metas.set(address, { address, firstSeenIndex, isSigner, isWritable, isProgram });
        return;
    }
    existing.isSigner ||= isSigner;
    existing.isWritable ||= isWritable;
    existing.isProgram ||= isProgram;
}

function aggregateAccountMetas(instructions, feePayerInput) {
    const feePayer = normalizePublicKey(feePayerInput);
    const metas = new Map();
    let firstSeenIndex = 0;
    mergeAccountMeta(metas, feePayer, true, true, false, firstSeenIndex++);
    for (const instruction of instructions) {
        for (const account of instruction.accounts) {
            mergeAccountMeta(
                metas,
                normalizePublicKey(account.address),
                account.isSigner,
                account.isWritable,
                false,
                firstSeenIndex++,
            );
        }
        mergeAccountMeta(metas, normalizePublicKey(instruction.programAddress), false, false, true, firstSeenIndex++);
    }
    return [...metas.values()];
}

function accountOrderGroup(meta) {
    if (meta.isSigner && meta.isWritable) return 0;
    if (meta.isSigner) return 1;
    if (meta.isWritable) return 2;
    return 3;
}

function orderStaticAccountMetas(metas) {
    return [...metas].sort((left, right) => {
        const groupDifference = accountOrderGroup(left) - accountOrderGroup(right);
        return groupDifference === 0 ? left.firstSeenIndex - right.firstSeenIndex : groupDifference;
    });
}

export function compileUnversionedMessage(instructions, feePayer, recentBlockhash) {
    const staticMetas = orderStaticAccountMetas(aggregateAccountMetas(instructions, feePayer));
    if (staticMetas.length > 256) {
        throw new Error("Compiled message has more than 256 static account keys");
    }
    const requiredSignatures = staticMetas.filter((meta) => meta.isSigner).length;
    const readonlySigned = staticMetas.filter((meta) => meta.isSigner && !meta.isWritable).length;
    const readonlyUnsigned = staticMetas.filter((meta) => !meta.isSigner && !meta.isWritable).length;
    if (requiredSignatures > 255 || readonlySigned > 255 || readonlyUnsigned > 255) {
        throw new Error("Compiled message header count exceeds one byte");
    }

    const accountKeys = staticMetas.map((meta) => meta.address);
    const accountIndexByAddress = new Map();
    for (let index = 0; index < accountKeys.length; index++) {
        accountIndexByAddress.set(accountKeys[index], index);
    }

    const parts = [
        new Uint8Array([requiredSignatures, readonlySigned, readonlyUnsigned]),
        encodeShortVectorLength(accountKeys.length),
    ];
    for (const address of accountKeys) {
        parts.push(decodePublicKey(address));
    }
    parts.push(decodePublicKey(recentBlockhash));
    parts.push(encodeShortVectorLength(instructions.length));

    const compiledInstructions = instructions.map((instruction) => {
        const programAddress = normalizePublicKey(instruction.programAddress);
        const programIdIndex = accountIndexByAddress.get(programAddress);
        if (programIdIndex === undefined) {
            throw new Error("Instruction program address is absent from the static account list: " + programAddress);
        }
        const accountIndexes = instruction.accounts.map((account) => {
            const address = normalizePublicKey(account.address);
            const accountIndex = accountIndexByAddress.get(address);
            if (accountIndex === undefined) {
                throw new Error("Instruction account is absent from compiled keys: " + address);
            }
            return accountIndex;
        });
        parts.push(new Uint8Array([programIdIndex]));
        parts.push(encodeShortVectorLength(accountIndexes.length));
        parts.push(new Uint8Array(accountIndexes));
        parts.push(encodeShortVectorLength(instruction.data.length));
        parts.push(instruction.data);
        return { programIdIndex, accountIndexes, data: new Uint8Array(instruction.data) };
    });

    return {
        version: "unversioned",
        bytes: concatenateBytes(parts),
        accountKeys,
        signerAddresses: accountKeys.slice(0, requiredSignatures),
        numberOfRequiredSignatures: requiredSignatures,
        numberOfReadonlySignedAccounts: readonlySigned,
        numberOfReadonlyUnsignedAccounts: readonlyUnsigned,
        instructions: compiledInstructions,
    };
}

export function createUnsignedTransaction(message) {
    const parts = [encodeShortVectorLength(message.numberOfRequiredSignatures)];
    for (let index = 0; index < message.numberOfRequiredSignatures; index++) {
        parts.push(new Uint8Array(SIGNATURE_BYTES));
    }
    parts.push(message.bytes);
    return concatenateBytes(parts);
}
