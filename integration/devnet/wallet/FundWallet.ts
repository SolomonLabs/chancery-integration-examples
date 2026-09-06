import { assertDevnetRpc, type DevnetContext } from "../execution/Context.js";
import { confirmSignature } from "../execution/Transaction.js";

interface BalanceResult { readonly value: number | bigint; }

export async function fundWallet(context: DevnetContext, minimumLamports: bigint, skipAirdrop: boolean): Promise<bigint> {
    if (minimumLamports <= 0n || minimumLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SOL funding target is outside the supported range");
    await assertDevnetRpc(context.rpc);
    const address = context.signer.publicKey;
    const balance = BigInt((await context.rpc.request<BalanceResult>("getBalance", [address, { commitment: "confirmed" }])).value);
    if (balance >= minimumLamports) return balance;
    if (skipAirdrop) throw new Error("Insufficient devnet SOL for " + address + "; required lamports: " + minimumLamports);
    const signature = await context.rpc.request<string>("requestAirdrop", [address, Number(minimumLamports - balance), { commitment: "confirmed" }]);
    await confirmSignature(context.rpc, signature);
    const observed = BigInt((await context.rpc.request<BalanceResult>("getBalance", [address, { commitment: "confirmed" }])).value);
    if (observed < minimumLamports) throw new Error("Devnet SOL balance remains below the requested target");
    return observed;
}
