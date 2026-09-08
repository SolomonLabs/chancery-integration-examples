# Oracle and data-provider integrations

This directory is the narrow read-only integration surface for oracle operators, indexers, data providers, and price/rate monitors that only need Chancery's current configured assets and settlement rates.

It reuses the top-level TypeScript and Python reference clients. It adds no RPC, codec, Solana, or other external dependency.

## Data surface

The examples publish only:

- the Chancery program address and issued-token mint;
- every current `AssetConfig` with its asset mint;
- the asset mode and token program;
- `deposit_rate_e9` and `redeem_rate_e9`, both as raw fixed-point integers and exact nine-decimal strings; and
- whether any pathway-scoped fee policies are currently referenced.

The output deliberately excludes permissions, limits, reserves, settlement intents, transaction construction, signing, and execution.

## Rates

Chancery stores both rates at e9 precision:

```text
1_000_000_000 = 1.000000000
```

For a basic approximately-$1 check, compare the raw rate directly with `1_000_000_000`. Do not convert to binary floating point for validation. Both language examples include an exact basis-point tolerance helper so the caller selects its own acceptable deviation.

The rate fields are the canonical settlement multipliers used by the Chancery client:

```text
mint gross output   = rate input × deposit_rate_e9 / 1_000_000_000
redeem gross output = issued-token input × redeem_rate_e9 / 1_000_000_000
```

Asset mode values are reported with the schema names `active`, `wind_down`, and `frozen`. The examples retain the raw numeric mode as well.

## Fees

The current Chancery schema has no program-wide fee-policy reference in `ChanceryConfig`. A `FeePolicy` becomes applicable through a specific `PathwayPolicy.fee_policy_id`.

For that reason the focused snapshot reports `globalFeePolicy: null` in TypeScript and `global_fee_policy: null` in Python. It also reports whether pathway-scoped fee policies are present so a consumer does not mistake the absence of a global fee for the absence of all settlement fees.

Do not infer a global fee from the set of registered `FeePolicy` accounts. A settlement-specific fee requires pathway resolution and belongs in the broader settlement/integration workflow rather than this oracle surface.

## TypeScript

From the repository root:

```bash
export RPC_URL=https://api.mainnet-beta.solana.com
yarn example:oracle:typescript
```

Use `CHANCERY_TARGET=devnet` with a devnet RPC endpoint to read the specialized devnet deployment.

Reusable code is in `oracles/typescript/src/OracleSnapshot.ts`; the runnable example is `oracles/typescript/examples/ReadOracleSnapshot.ts`.

## Python

From the repository root:

```bash
export RPC_URL=https://api.mainnet-beta.solana.com
yarn example:oracle:python
```

Reusable code is in `oracles/python/oracle_snapshot.py`; the runnable example is `oracles/python/examples/read_oracle_snapshot.py`.

## Consumer practices

- Use the asset mint as the asset identity. Do not infer symbols or off-chain metadata from addresses.
- Preserve the raw e9 integer rates in stored observations; format decimal strings only for display or downstream text formats.
- Record the asset mode alongside each rate observation so a historical feed does not erase wind-down or frozen transitions.
- Select the RPC commitment appropriate for the feed's publication policy; the supplied examples use `confirmed`, matching the existing read-only examples.
- Treat the complete result of one `discover()` call as one observation. Do not combine asset rates from different discovery runs into a synthetic state snapshot.
- Do not treat unreferenced or pathway-specific fee policies as globally applicable.