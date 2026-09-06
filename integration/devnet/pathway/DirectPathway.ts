import { createHash } from "node:crypto";
import { decodePublicKey } from "../../../typescript/src/Base58Codec.js";
import { buildChanceryInstruction } from "../../../typescript/src/ChanceryInstruction.js";
import { ZERO_ADDRESS } from "../../../typescript/src/ChancerySchema.js";
import { bytes32FromInput, derivePathwayPolicyAddress, isZeroBytes32, pathwayIsActive, requireNumberField, requirePublicKeyField } from "../../../typescript/src/client/ChanceryProtocol.js";
import { ISSUED_TOKEN_MINT, type TestAsset } from "../configuration/Deployment.js";
import { controllerAuthority } from "../controller/Authority.js";
import { readChanceryAccount } from "../execution/Account.js";
import type { DevnetContext } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { executeChanceryInstruction } from "../instructions/ExecuteChancery.js";

const POLICY_IDENTIFIERS = ["reserve_compartment_policy_id", "limit_policy_id", "evidence_policy_id", "fee_policy_id", "insurance_policy_id",
    "asset_mint_limit_policy_id", "asset_redeem_limit_policy_id", "counterparty_limit_policy_id", "executor_limit_policy_id"] as const;

export function directPathwayId(assetMint: string, principal: string, explicitId?: string): Uint8Array {
    const identifier = explicitId === undefined
        ? createHash("sha256").update("chancery-devnet:direct-pathway:v1").update(decodePublicKey(assetMint))
            .update(decodePublicKey(ISSUED_TOKEN_MINT)).update(decodePublicKey(principal)).digest()
        : bytes32FromInput(explicitId, "pathway id");
    if (identifier.every((value) => value === 0)) throw new Error("Pathway id must be nonzero");
    return identifier;
}

export async function registerDirectPathway(context: DevnetContext, asset: TestAsset, pathwayId: Uint8Array): Promise<string> {
    const pathway = derivePathwayPolicyAddress(pathwayId);
    let current = await readChanceryAccount(context.rpc, pathway.address, "PathwayPolicy");
    if (current === null) {
        const zero = new Uint8Array(32);
        const instruction = buildChanceryInstruction("register_pathway_policy", {
            pathway_id: pathwayId, pathway_kind: 0, asset_mint: asset.mint, issued_token_mint: ISSUED_TOKEN_MINT,
            designated_executor: ZERO_ADDRESS, reserve_compartment_policy_id: zero, limit_policy_id: zero,
            evidence_policy_id: zero, fee_policy_id: zero, insurance_policy_id: zero, asset_mint_limit_policy_id: zero,
            asset_redeem_limit_policy_id: zero, counterparty_limit_policy_id: zero, executor_limit_policy_id: zero,
        }, { payer: context.signer.publicKey, operations_authority: controllerAuthority(1),
            limit_policy: ZERO_ADDRESS, evidence_policy: ZERO_ADDRESS, fee_policy: ZERO_ADDRESS, insurance_policy: ZERO_ADDRESS,
            asset_mint_limit_policy: ZERO_ADDRESS, asset_redeem_limit_policy: ZERO_ADDRESS,
            counterparty_limit_policy: ZERO_ADDRESS, executor_limit_policy: ZERO_ADDRESS });
        await submitInstructions(context, "pathway-register", [executeChanceryInstruction(context.signer.publicKey, instruction)]);
        current = await readChanceryAccount(context.rpc, pathway.address, "PathwayPolicy");
    }
    if (current === null || requireNumberField(current, "bump") !== pathway.bump
        || requireNumberField(current, "pathway_kind") !== 0 || requirePublicKeyField(current, "asset_mint") !== asset.mint
        || requirePublicKeyField(current, "issued_token_mint") !== ISSUED_TOKEN_MINT
        || requirePublicKeyField(current, "designated_executor") !== ZERO_ADDRESS || !pathwayIsActive(current)
        || POLICY_IDENTIFIERS.some((name) => !isZeroBytes32(current![name], name))) {
        throw new Error("Pathway state differs from the active direct testing profile: " + pathway.address);
    }
    return pathway.address;
}
