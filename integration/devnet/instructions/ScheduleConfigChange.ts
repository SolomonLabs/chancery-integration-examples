import { encodeType } from "../../../typescript/src/BinaryCodec.js";
import type { SolanaInstruction } from "../../../typescript/src/SolanaTransaction.js";
import { executeChanceryInstruction } from "./ExecuteChancery.js";

export function scheduleConfigChangeInstruction(caller: string, proposal: SolanaInstruction,
    delaySeconds: bigint = 1n, lifetimeSeconds: bigint = 3600n): SolanaInstruction {
    const wrapped = executeChanceryInstruction(caller, proposal);
    if (wrapped.data[1] !== 1 || proposal.data[0] !== 9 || proposal.data[1] !== 7) {
        throw new Error("Scheduling requires a governance config-change proposal");
    }
    if (delaySeconds < 1n || lifetimeSeconds <= 0n) throw new Error("Config-change delay and lifetime must be positive");
    encodeType("i64", delaySeconds, "delaySeconds");
    encodeType("i64", lifetimeSeconds, "lifetimeSeconds");
    return {
        ...wrapped,
        data: Uint8Array.from([2, 1, ...encodeType("u64", delaySeconds, "delaySeconds"),
            ...encodeType("u64", lifetimeSeconds, "lifetimeSeconds"), ...proposal.data]),
    };
}
