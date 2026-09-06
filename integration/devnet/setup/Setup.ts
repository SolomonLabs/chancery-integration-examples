import { requirePublicKeyField, knownPdaAddress, ROLE, SCOPE } from "../../../typescript/src/client/ChanceryProtocol.js";
import { ISSUED_TOKEN_MINT, type TestAsset } from "../configuration/Deployment.js";
import type { DevnetContext } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { createAssociatedTokenAccountInstruction } from "../instructions/AssociatedTokenAccount.js";
import { registerDirectPathway } from "../pathway/DirectPathway.js";
import { grantPermission } from "../permissions/Grant.js";
import { faucetTestAsset } from "../assets/Faucet.js";

export async function setupDirectTesting(context: DevnetContext, configuration: Readonly<Record<string, unknown>>, asset: TestAsset,
    pathwayId: Uint8Array, amount?: bigint): Promise<{ readonly pathwayPolicy: string; readonly permissionRecord: string; readonly assetTokenAccount: string }> {
    const pathwayPolicy = await registerDirectPathway(context, asset, pathwayId);
    const permissionRecord = await grantPermission(context, {
        subject: context.signer.publicKey, scopeKind: SCOPE.PATHWAY, scopeKey: pathwayPolicy,
        roleBits: ROLE.CAN_MINT_DIRECT | ROLE.CAN_REDEEM_DIRECT,
    });
    await submitInstructions(context, "token-accounts-create", [
        createAssociatedTokenAccountInstruction(context.signer.publicKey, context.signer.publicKey, ISSUED_TOKEN_MINT, requirePublicKeyField(configuration, "issued_token_program")),
        createAssociatedTokenAccountInstruction(context.signer.publicKey, knownPdaAddress("reserve_authority_pda"), asset.mint, asset.tokenProgramAddress),
    ]);
    const assetTokenAccount = await faucetTestAsset(context, asset, context.signer.publicKey, amount);
    return { pathwayPolicy, permissionRecord, assetTokenAccount };
}
