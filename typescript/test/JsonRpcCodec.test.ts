import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonRpcResponse } from "../src/JsonRpcCodec.js";

test("JSON-RPC decoding preserves unsafe decimal integers", () => {
    const parsed = parseJsonRpcResponse(
        '{"rentEpoch":18446744073709551615,"lamports":9007199254740993,"safe":9007199254740991}',
    );

    assert.deepEqual(parsed, {
        rentEpoch: 18_446_744_073_709_551_615n,
        lamports: 9_007_199_254_740_993n,
        safe: 9_007_199_254_740_991,
    });
});
