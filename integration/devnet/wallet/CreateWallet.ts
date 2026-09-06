import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodePublicKey } from "../../../typescript/src/Base58Codec.js";
import { keypairFromSecretKeyBytes } from "../../../typescript/src/SolanaTransaction.js";
import { requireDevnetTarget } from "../configuration/Deployment.js";

export function createWallet(path: string): string {
    requireDevnetTarget();
    const signer = keypairFromSecretKeyBytes(randomBytes(32));
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const bytes = [...signer.secretKeySeed, ...decodePublicKey(signer.publicKey)];
    writeFileSync(path, JSON.stringify(bytes) + "\n", { flag: "wx", mode: 0o600 });
    return signer.publicKey;
}
