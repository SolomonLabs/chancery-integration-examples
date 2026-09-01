import {
    buildChanceryInstruction,
    buildSquadsProposalBundle,
    chanceryJsonReplacer,
    deriveSquadsVaultAddress,
} from "../src/index.js";

function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new Error("Missing environment variable " + name);
    }
    return value;
}

function unsignedInteger(value: string, name: string): bigint {
    if (!/^[0-9]+$/.test(value)) {
        throw new Error(name + " must be an unsigned decimal integer");
    }
    return BigInt(value);
}

function main(): void {
    const multisigAddress = requiredEnvironmentVariable("SQUADS_MULTISIG_ADDRESS");
    const creatorAddress = requiredEnvironmentVariable("SQUADS_CREATOR_ADDRESS");
    const transactionIndex = unsignedInteger(
        requiredEnvironmentVariable("SQUADS_TRANSACTION_INDEX"),
        "SQUADS_TRANSACTION_INDEX",
    );
    const vaultIndex = unsignedInteger(process.env.SQUADS_VAULT_INDEX ?? "0", "SQUADS_VAULT_INDEX");
    const vaultAddress = deriveSquadsVaultAddress(multisigAddress, vaultIndex).address;

    const chanceryInstruction = buildChanceryInstruction(
        "set_global_pause",
        {
            pause_bits: unsignedInteger(process.env.PAUSE_BITS ?? "1", "PAUSE_BITS"),
            is_clear: process.env.IS_CLEAR === "true",
            reason_code: unsignedInteger(process.env.REASON_CODE ?? "0", "REASON_CODE"),
            expires_at_slot: unsignedInteger(process.env.EXPIRES_AT_SLOT ?? "0", "EXPIRES_AT_SLOT"),
        },
        { authority: vaultAddress },
    );
    const proposal = buildSquadsProposalBundle({
        multisigAddress,
        creatorAddress,
        transactionIndex,
        vaultIndex,
        instructions: [chanceryInstruction],
        memo: process.env.SQUADS_MEMO ?? "Chancery set_global_pause",
    });
    process.stdout.write(JSON.stringify(proposal, chanceryJsonReplacer, 2) + "\n");
}

try {
    main();
} catch (error: unknown) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(message + "\n");
    process.exitCode = 1;
}
