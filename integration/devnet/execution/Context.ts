import { ChanceryRpc } from "../../../typescript/src/ChanceryRpc.js";
import { CHANCERY_DEVNET_PROGRAM_ADDRESS } from "../../../typescript/src/ChanceryTarget.js";
import { loadSolanaKeypairFile, type SolanaKeypair } from "../../../typescript/src/SolanaTransaction.js";
import { knownPdaAddress, requirePublicKeyField } from "../../../typescript/src/client/ChanceryProtocol.js";
import { DEVNET_GENESIS_HASH, FAUCET_PROGRAM_ADDRESS, ISSUED_TOKEN_MINT, requireDevnetTarget } from "../configuration/Deployment.js";
import { CONTROLLER_ROLES, controllerAuthority } from "../controller/Authority.js";
import { readChanceryAccount } from "./Account.js";

export interface DevnetContext {
    readonly rpc: ChanceryRpc;
    readonly signer: SolanaKeypair;
}

const AUTHORITY_FIELDS = ["governance_authority", "operations_authority", "emergency_authority", "enforcement_authority", "insurance_admin_authority"] as const;

export async function assertDevnetRpc(rpc: ChanceryRpc): Promise<void> {
    requireDevnetTarget();
    if (await rpc.request<string>("getGenesisHash", []) !== DEVNET_GENESIS_HASH) throw new Error("RPC genesis hash does not match Solana devnet");
}

export async function loadDevnetContext(endpoint: string, keypairPath: string): Promise<DevnetContext> {
    requireDevnetTarget();
    const rpc = new ChanceryRpc(endpoint);
    await assertDevnetRpc(rpc);
    return { rpc, signer: loadSolanaKeypairFile(keypairPath) };
}

export async function assertPublicDeployment(context: DevnetContext): Promise<Readonly<Record<string, unknown>>> {
    for (const address of [CHANCERY_DEVNET_PROGRAM_ADDRESS, FAUCET_PROGRAM_ADDRESS]) {
        const account = await context.rpc.getAccountInfo(address, "confirmed");
        if (account === null || !account.executable) throw new Error("Executable devnet program is missing: " + address);
    }
    const configuration = await readChanceryAccount(context.rpc, knownPdaAddress("chancery_config"), "ChanceryConfig");
    if (configuration === null) throw new Error("Chancery devnet configuration is missing");
    if (requirePublicKeyField(configuration, "issued_token_mint") !== ISSUED_TOKEN_MINT) throw new Error("Issued mint differs from the configured devnet deployment");
    for (const role of CONTROLLER_ROLES) {
        if (requirePublicKeyField(configuration, AUTHORITY_FIELDS[role]) !== controllerAuthority(role)) {
            throw new Error("Public controller handoff is incomplete for " + AUTHORITY_FIELDS[role]);
        }
    }
    return configuration;
}
