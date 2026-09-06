import { decodeChanceryAccount } from "../../../typescript/src/ChanceryAccount.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import type { ChanceryRpc } from "../../../typescript/src/ChanceryRpc.js";

export async function readChanceryAccount(rpc: ChanceryRpc, address: string, expectedName: string): Promise<Readonly<Record<string, unknown>> | null> {
    const account = await rpc.getAccountInfo(address, "confirmed");
    if (account === null) return null;
    if (account.owner !== CHANCERY_DEVNET_PROGRAM_ADDRESS || account.executable) throw new Error("Invalid Chancery account owner or executable flag: " + address);
    const decoded = decodeChanceryAccount(account.data);
    if (decoded.name !== expectedName) throw new Error("Expected " + expectedName + " at " + address);
    return decoded.values;
}
