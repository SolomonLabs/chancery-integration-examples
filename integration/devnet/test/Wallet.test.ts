import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSolanaKeypairFile } from "../../../typescript/src/SolanaTransaction.js";
import { createWallet } from "../wallet/CreateWallet.js";

test("wallet creation writes a loadable local keypair and preserves an existing file", () => {
    const directory = mkdtempSync(join(tmpdir(), "chancery-wallet-"));
    const path = join(directory, "tester", "keypair.json");
    try {
        const address = createWallet(path);
        const original = readFileSync(path);
        assert.equal((JSON.parse(original.toString("utf8")) as number[]).length, 64);
        assert.equal(loadSolanaKeypairFile(path).publicKey, address);
        if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.throws(() => createWallet(path), { code: "EEXIST" });
        assert.deepEqual(readFileSync(path), original);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
