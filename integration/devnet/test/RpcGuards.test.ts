import assert from "node:assert/strict";
import test from "node:test";
import { ChanceryRpc } from "../../../typescript/src/ChanceryRpc.js";
import { keypairFromSecretKeyBytes } from "../../../typescript/src/SolanaTransaction.js";
import { DEVNET_GENESIS_HASH } from "../configuration/Deployment.js";
import { assertDevnetRpc, assertPublicDeployment } from "../execution/Context.js";
import { submitInstructions } from "../execution/Transaction.js";
import { fundWallet } from "../wallet/FundWallet.js";

interface RpcStep {
    readonly method: string;
    readonly result: unknown;
}

class ScriptedRpc extends ChanceryRpc {
    readonly calls: { readonly method: string; readonly parameters: readonly unknown[] }[] = [];
    readonly #steps: readonly RpcStep[];

    constructor(steps: readonly RpcStep[]) {
        super("https://rpc.example.test");
        this.#steps = steps;
    }

    override async request<Result>(method: string, parameters: readonly unknown[]): Promise<Result> {
        const expected = this.#steps[this.calls.length];
        assert.ok(expected, "Unexpected RPC call: " + method);
        assert.equal(method, expected.method);
        this.calls.push({ method, parameters });
        return expected.result as Result;
    }
}

const signer = keypairFromSecretKeyBytes(new Uint8Array(32).fill(9));
const genesis: RpcStep = { method: "getGenesisHash", result: DEVNET_GENESIS_HASH };
const wrongGenesis: RpcStep = { method: "getGenesisHash", result: "mainnet-genesis" };

test("RPC guard accepts the configured devnet genesis and rejects other clusters", async () => {
    await assert.doesNotReject(assertDevnetRpc(new ScriptedRpc([genesis])));
    await assert.rejects(assertDevnetRpc(new ScriptedRpc([wrongGenesis])), /genesis/);
});

test("transaction submission rejects another cluster before blockhash, simulation, or send", async () => {
    const rpc = new ScriptedRpc([wrongGenesis]);
    await assert.rejects(submitInstructions({ rpc, signer }, "test", []), /genesis/);
    assert.equal(rpc.calls.length, 1);
});

test("SOL funding rejects another cluster before requesting an airdrop", async () => {
    const rpc = new ScriptedRpc([wrongGenesis]);
    await assert.rejects(fundWallet({ rpc, signer }, 100n, false), /genesis/);
    assert.equal(rpc.calls.length, 1);
});

test("SOL funding preserves a sufficient balance and reports an unfunded skip request", async () => {
    const sufficient = new ScriptedRpc([genesis, { method: "getBalance", result: { value: 200 } }]);
    assert.equal(await fundWallet({ rpc: sufficient, signer }, 100n, false), 200n);
    assert.equal(sufficient.calls.length, 2);
    const insufficient = new ScriptedRpc([genesis, { method: "getBalance", result: { value: 20 } }]);
    await assert.rejects(fundWallet({ rpc: insufficient, signer }, 100n, true), /Insufficient devnet SOL/);
    assert.equal(insufficient.calls.length, 2);
});

test("SOL funding requests only the shortfall and checks confirmed balance", async () => {
    const rpc = new ScriptedRpc([
        genesis, { method: "getBalance", result: { value: 20 } }, { method: "requestAirdrop", result: "fixture-signature" },
        { method: "getSignatureStatuses", result: { context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }] } },
        { method: "getBalance", result: { value: 100 } },
    ]);
    assert.equal(await fundWallet({ rpc, signer }, 100n, false), 100n);
    assert.equal(rpc.calls[2]!.parameters[1], 80);
    assert.equal(rpc.calls.length, 5);
});

test("public deployment checks reject a missing executable program", async () => {
    const rpc = new ScriptedRpc([{ method: "getAccountInfo", result: { context: { slot: 1 }, value: null } }]);
    await assert.rejects(assertPublicDeployment({ rpc, signer }), /Executable devnet program is missing/);
});
