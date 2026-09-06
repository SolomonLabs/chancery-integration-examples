import { setTimeout as delay } from "node:timers/promises";
import { chanceryJsonReplacer } from "../../../typescript/src/BinaryCodec.js";
import type { ChanceryRpc } from "../../../typescript/src/ChanceryRpc.js";
import { compileUnversionedMessage, signSolanaTransaction, type SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { assertDevnetRpc, type DevnetContext } from "./Context.js";

export async function confirmSignature(rpc: ChanceryRpc, signature: string, lastValidBlockHeight?: bigint): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const status = await rpc.getSignatureStatus(signature);
        if (status !== null && status.err !== null) throw new Error("Transaction failed: " + signature + " " + JSON.stringify(status.err, chanceryJsonReplacer));
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
        if (lastValidBlockHeight !== undefined && await rpc.getBlockHeight("confirmed") > lastValidBlockHeight) throw new Error("Transaction blockhash expired: " + signature);
        await delay(500);
    }
    throw new Error("Transaction confirmation timed out: " + signature);
}

export async function submitInstructions(context: DevnetContext, stage: string, instructions: readonly SolanaInstruction[]): Promise<string> {
    await assertDevnetRpc(context.rpc);
    const latest = await context.rpc.getLatestBlockhash("confirmed");
    const message = compileUnversionedMessage(instructions, context.signer.publicKey, latest.blockhash);
    const signed = signSolanaTransaction(message, [context.signer]);
    const simulation = await context.rpc.simulateTransaction(signed.bytes, "confirmed");
    if (simulation.err !== null) throw new Error(stage + " simulation failed: " + JSON.stringify(simulation, chanceryJsonReplacer));
    const signature = await context.rpc.sendTransaction(signed.bytes, "confirmed", false, 0);
    if (signature !== signed.primarySignature) throw new Error(stage + " returned a different transaction signature");
    await confirmSignature(context.rpc, signature, latest.lastValidBlockHeight);
    process.stderr.write(JSON.stringify({ stage, signature }) + "\n");
    return signature;
}
