import assert from "node:assert/strict";
import test from "node:test";
import { parseDevnetArguments } from "../commands/Arguments.js";

test("devnet arguments select the local wallet and direct testing defaults", () => {
    const options = parseDevnetArguments(["setup"]);
    assert.equal(options.keypair, ".devnet/tester/keypair.json");
    assert.equal(options.symbol, "USDC");
    assert.equal(options.scopeKind, 2);
    assert.deepEqual(options.roles, ["CAN_MINT_DIRECT", "CAN_REDEEM_DIRECT"]);
});

test("devnet arguments preserve full-width integer values and explicit identities", () => {
    const options = parseDevnetArguments(["operation", "--action", "redeem", "--amount", "18446744073709551615",
        "--minimum-output", "0", "--pathway-id", "01".repeat(32), "--rpc", "https://rpc.example.test", "--output", "operation.json"]);
    assert.equal(options.amount, (1n << 64n) - 1n);
    assert.equal(options.minimumOutput, 0n);
    assert.equal(options.action, "redeem");
    assert.equal(options.pathwayId, "01".repeat(32));
    assert.equal(options.output, "operation.json");
    assert.equal(options.rpc, "https://rpc.example.test");
});

test("devnet arguments reject unsupported commands, irrelevant flags, and repetitions", () => {
    assert.throws(() => parseDevnetArguments([]), /Expected/);
    assert.throws(() => parseDevnetArguments(["settle"]), /Expected/);
    assert.throws(() => parseDevnetArguments(["wallet", "--rpc", "https://rpc.example.test"]), /does not apply/);
    assert.throws(() => parseDevnetArguments(["setup", "--symbol", "USDC", "--symbol", "USDT"]), /only once/);
    assert.throws(() => parseDevnetArguments(["setup", "--unknown"]));
});

test("devnet arguments reject missing and malformed operation amounts", () => {
    assert.throws(() => parseDevnetArguments(["operation"]), /requires --amount/);
    for (const amount of ["0", "-1", "1.5", "1e6", "18446744073709551616"]) {
        assert.throws(() => parseDevnetArguments(["operation", "--amount", amount]));
    }
    assert.throws(() => parseDevnetArguments(["operation", "--amount", "1", "--action", "trade"]), /mint or redeem/);
    assert.throws(() => parseDevnetArguments(["grant", "--scope-kind", "256"]), /exceeds u8/);
});

test("administration requires the existing schema input documents", () => {
    assert.throws(() => parseDevnetArguments(["admin"]), /requires --instruction/);
    const options = parseDevnetArguments(["admin", "--instruction", "propose_config_change",
        "--arguments", "proposal.arguments.json", "--accounts", "proposal.accounts.json", "--schedule"]);
    assert.equal(options.instruction, "propose_config_change");
    assert.equal(options.argumentsFile, "proposal.arguments.json");
    assert.equal(options.accountsFile, "proposal.accounts.json");
    assert.equal(options.schedule, true);
});
