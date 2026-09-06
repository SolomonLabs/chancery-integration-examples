import { readFileSync, writeFileSync } from "node:fs";
import { normalizePublicKey } from "../../../typescript/src/Base58Codec.js";
import { chanceryJsonReplacer, type StructValues } from "../../../typescript/src/BinaryCodec.js";
import { buildChanceryInstruction, type InstructionAccountInputs } from "../../../typescript/src/ChanceryInstruction.js";
import { CHANCERY_SCHEMA, getChanceryConstant, getInstructionSchema, ZERO_ADDRESS } from "../../../typescript/src/ChancerySchema.js";
import { CHANCERY_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { ChanceryClient } from "../../../typescript/src/client/ChanceryClient.js";
import { derivePathwayPolicyAddress, SCOPE } from "../../../typescript/src/client/ChanceryProtocol.js";
import { FAUCET_PROGRAM_ADDRESS, ISSUED_TOKEN_MINT, requireDevnetTarget, testAssetForSymbol } from "../configuration/Deployment.js";
import { CONTROLLER_ROLES, controllerAuthority, faucetAuthority } from "../controller/Authority.js";
import { assertPublicDeployment, loadDevnetContext } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { executeChanceryInstruction } from "../instructions/ExecuteChancery.js";
import { scheduleConfigChangeInstruction } from "../instructions/ScheduleConfigChange.js";
import { createWallet } from "../wallet/CreateWallet.js";
import { fundWallet } from "../wallet/FundWallet.js";
import { faucetTestAsset } from "../assets/Faucet.js";
import { directPathwayId, registerDirectPathway } from "../pathway/DirectPathway.js";
import { grantPermission } from "../permissions/Grant.js";
import { setupDirectTesting } from "../setup/Setup.js";
import { directOperationDocument } from "../operation/Document.js";
import { parseDevnetArguments } from "./Arguments.js";

function output(value: unknown): void {
    process.stdout.write(JSON.stringify(value, chanceryJsonReplacer, 2) + "\n");
}

async function main(): Promise<void> {
    if (process.argv.includes("--help") || process.argv.length < 3) {
        process.stdout.write([
            "Usage: yarn devnet:<command> [options]", "Commands: wallet, fund, setup, faucet, pathway, grant, operation, admin, addresses",
            "Set CHANCERY_TARGET=devnet before running commands. RPC defaults to RPC_URL or the public devnet endpoint.",
            "Common: --keypair <local-file> --rpc <url>", "Assets: --symbol USDC|USDT|USDG|PYUSD --amount <base-units> --pathway-id <32-byte-id>",
            "fund: --lamports <minimum-balance> --skip-airdrop", "faucet: --subject <recipient>",
            "grant: --subject <address> --roles <CAN_...,CAN_...> --scope-kind <u8> --scope-key <address> --expiry <unix-seconds>",
            "operation: --action mint|redeem --amount <base-units> --minimum-output <base-units> --output <new-file>",
            "admin: --instruction <schema-name> --arguments <json-file> --accounts <json-file> --schedule",
        ].join("\n") + "\n");
        return;
    }
    const options = parseDevnetArguments(process.argv.slice(2));
    requireDevnetTarget();
    if (options.command === "wallet") {
        output({ principal: createWallet(options.keypair), keypair: options.keypair });
        return;
    }
    const context = await loadDevnetContext(options.rpc, options.keypair);
    if (options.command === "fund") {
        output({ principal: context.signer.publicKey, lamports: await fundWallet(context, options.lamports, options.skipAirdrop) });
        return;
    }
    const configuration = await assertPublicDeployment(context);
    if (options.command === "addresses") {
        output({ target: "devnet", programAddress: CHANCERY_PROGRAM_ADDRESS, faucetProgramAddress: FAUCET_PROGRAM_ADDRESS,
            principal: context.signer.publicKey, issuedTokenMint: ISSUED_TOKEN_MINT, knownPdas: CHANCERY_SCHEMA.known_pdas,
            faucetAuthority: faucetAuthority(), controllerAuthorities: CONTROLLER_ROLES.map((role) => ({ role, address: controllerAuthority(role) })) });
        return;
    }
    if (options.command === "admin") {
        const instructionName = options.instruction!;
        const schema = getInstructionSchema(instructionName);
        const argumentsValue = JSON.parse(readFileSync(options.argumentsFile!, "utf8")) as StructValues;
        const accounts = JSON.parse(readFileSync(options.accountsFile!, "utf8")) as InstructionAccountInputs;
        for (const name of Object.keys(argumentsValue)) {
            if (!schema.args.some((field) => field.name === name)) throw new Error("Unknown instruction argument: " + name);
        }
        for (const name of Object.keys(accounts)) {
            if (!schema.accounts.some((account) => account.name === name)) throw new Error("Unknown instruction account: " + name);
        }
        const instruction = buildChanceryInstruction(instructionName, argumentsValue, accounts);
        const wrapped = options.schedule ? scheduleConfigChangeInstruction(context.signer.publicKey, instruction)
            : executeChanceryInstruction(context.signer.publicKey, instruction);
        output({ signature: await submitInstructions(context, instructionName, [wrapped]) });
        return;
    }
    const asset = testAssetForSymbol(options.symbol);
    const pathwayId = directPathwayId(asset.mint, context.signer.publicKey, options.pathwayId);
    const pathwayPolicy = derivePathwayPolicyAddress(pathwayId).address;
    const identity = { target: "devnet", programAddress: CHANCERY_PROGRAM_ADDRESS, rpc: options.rpc,
        principal: context.signer.publicKey, assetMint: asset.mint, issuedTokenMint: ISSUED_TOKEN_MINT,
        pathwayId: Buffer.from(pathwayId).toString("hex"), pathwayPolicy };
    switch (options.command) {
        case "setup": output({ ...identity, ...await setupDirectTesting(context, configuration, asset, pathwayId, options.amount) }); return;
        case "pathway": output({ ...identity, pathwayPolicy: await registerDirectPathway(context, asset, pathwayId) }); return;
        case "faucet": output({ ...identity, assetTokenAccount: await faucetTestAsset(context, asset,
            normalizePublicKey(options.subject ?? context.signer.publicKey), options.amount) }); return;
        case "grant": {
            let roleBits = 0n;
            for (const name of options.roles) {
                if (!/^CAN_[A-Z0-9_]+$/.test(name)) throw new Error("Roles must use the declared CAN_ names");
                roleBits |= BigInt(getChanceryConstant("role." + name).value);
            }
            const scopeKey = options.scopeKey ?? (options.scopeKind === SCOPE.GLOBAL ? ZERO_ADDRESS
                : options.scopeKind === SCOPE.PATHWAY ? pathwayPolicy : undefined);
            if (scopeKey === undefined) throw new Error("This scope requires an explicit --scope-key");
            const subject = normalizePublicKey(options.subject ?? context.signer.publicKey);
            const permissionRecord = await grantPermission(context, { subject, scopeKind: options.scopeKind, scopeKey, roleBits,
                ...(options.expiry === undefined ? {} : { expiryUnixTimestamp: options.expiry }) });
            output({ ...identity, subject, permissionRecord }); return;
        }
        case "operation": {
            const inspection = await new ChanceryClient(context.rpc).inspect({ action: options.action, mode: "direct", assetMint: asset.mint,
                principal: context.signer.publicKey, pathwayId, amount: options.amount!,
                ...(options.minimumOutput === undefined ? {} : { minimumOutput: options.minimumOutput }) });
            const document = directOperationDocument(inspection);
            if (options.output === undefined) output(document);
            else {
                writeFileSync(options.output, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
                output({ ...identity, action: options.action, output: options.output });
            }
            return;
        }
    }
}

main().catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
});
