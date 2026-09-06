import { decodeTokenAccount, decodeTokenMint, deriveAssociatedTokenAddress } from "../../../typescript/src/SplToken.js";
import type { TestAsset } from "../configuration/Deployment.js";
import { faucetAuthority } from "../controller/Authority.js";
import type { DevnetContext } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { createAssociatedTokenAccountInstruction } from "../instructions/AssociatedTokenAccount.js";
import { mintTestAssetInstruction } from "../instructions/Faucet.js";

export async function faucetTestAsset(context: DevnetContext, asset: TestAsset, recipient: string, amountInput?: bigint): Promise<string> {
    const mintAccount = await context.rpc.getAccountInfo(asset.mint, "confirmed");
    if (mintAccount === null || mintAccount.executable || mintAccount.owner !== asset.tokenProgramAddress) throw new Error("Configured test mint is missing or owned by another token program");
    const mint = decodeTokenMint(mintAccount.data);
    if (!mint.initialized || mint.mintAuthority !== faucetAuthority()) throw new Error("Test mint is not controlled by the configured faucet authority");
    const amount = amountInput ?? 10n ** BigInt(mint.decimals);
    const destination = deriveAssociatedTokenAddress(recipient, asset.mint, asset.tokenProgramAddress).address;
    const previousAccount = await context.rpc.getAccountInfo(destination, "confirmed");
    if (previousAccount !== null && (previousAccount.owner !== asset.tokenProgramAddress || previousAccount.executable)) throw new Error("Faucet destination has the wrong token-program owner");
    const previous = previousAccount === null ? null : decodeTokenAccount(previousAccount.data);
    if (previous !== null && (previous.mint !== asset.mint || previous.owner !== recipient)) throw new Error("Faucet destination identity mismatch");
    await submitInstructions(context, "faucet-mint", [
        createAssociatedTokenAccountInstruction(context.signer.publicKey, recipient, asset.mint, asset.tokenProgramAddress),
        mintTestAssetInstruction(asset.mint, destination, asset.tokenProgramAddress, amount, mint.decimals),
    ]);
    const account = await context.rpc.getAccountInfo(destination, "confirmed");
    if (account === null || account.owner !== asset.tokenProgramAddress || account.executable) throw new Error("Faucet destination readback failed");
    const observed = decodeTokenAccount(account.data);
    if (observed.mint !== asset.mint || observed.owner !== recipient || observed.amount !== (previous?.amount ?? 0n) + amount) throw new Error("Faucet balance readback differs from the requested amount");
    return destination;
}
