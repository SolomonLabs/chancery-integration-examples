# Validation

The distribution gate covers the Chancery external integration surface in both implementations.

## Release-correctness gates

Settlement validation covers these requirements in TypeScript and Python:

- `ready` includes settlement-module activation, asset action enablement, asset extension chronology/freshness/approval, pathway extension restrictions, issued-token settlement readiness, issued-token extension chronology/freshness/restrictions, and evidence-policy binding;
- an external fee-recipient account is required only when the effective net fee is greater than zero and the recipient policy routes externally;
- redeem reserve sufficiency uses principal pre-transfer output plus only an externally routed net fee;
- inspection uses the on-chain Clock sysvar for policy time, expiry, usage-window rollover, and extension freshness;
- dependent RPC reads carry a minimum context slot and each inspection records its slot, Clock timestamp, epoch, commitment, and expiry slot;
- transaction preparation rejects an expired inspection.

## Devnet tooling

~~~bash
yarn test:devnet
~~~

Offline tests cover target and genesis checks, controller instruction encoding, faucet limits, permission payloads, argument validation, local wallet creation, and operation-document export into the existing TypeScript builders. Tests use synthetic state and mocked RPC responses. Live onboarding and settlement use the same example entry points with `CHANCERY_TARGET=devnet`, as described in [Devnet integration testing](integration/DEVNET-TESTING.md).

## TypeScript

The repository-selected installation and strict typecheck commands are:

```bash
corepack enable
yarn install --immutable
yarn typecheck
```

Compile the test suite to JavaScript and run it through the Node.js test runner:

```bash
yarn build:typescript
node --test dist/typescript/test/*.test.js
```

The compiled JavaScript tree loads its emitted Chancery schema and exercises the same runtime tests.

Coverage includes:

- direct mint and redeem transaction construction;
- delegated mint and redeem transaction construction;
- trilateral mint and redeem transaction construction;
- exact ordered instruction-account resolution for each settlement mode;
- unversioned and version-zero message compilation;
- address lookup tables and Ed25519 signing;
- simulation, submission, confirmation, and confirmed-transaction retrieval through deterministic JSON-RPC fixtures;
- exact preservation of unsafe decimal JSON-RPC integers, including account lamports and the rent-exempt `rentEpoch` value `u64::MAX`;
- complete `getProgramAccounts` discovery and grouping across all 22 Chancery account layouts;
- preservation of unknown Chancery-owned discriminators;
- canonical address and stored-bump verification for every derivable Chancery PDA family;
- event, mint, reserve-authority, config, activation, pause, and issued-token singleton PDAs;
- linked asset, pathway, fee, limit, evidence, permission, settlement, usage-window, and reserve-destination state;
- canonical self-CPI evidence extraction from static and loaded message addresses;
- rejection of failed-transaction evidence and noncanonical event-authority or CPI-prefix data;
- `gross_in` mint accounting and `gross_output_amount` redeem accounting;
- hourly, daily, seven-day, and thirty-day period rollover;
- before-and-after volume and action-count capacity;
- missing-window and future-window fail-closed behavior;
- pathway, asset, counterparty, and executor limit-policy binding checks;
- Token-2022 `TransferFeeConfig` decoding, epoch selection, ceiling division, and maximum-fee capping;
- transfer-aware mint and redeem effective amounts, routed-fee receipt, all-in basis points, and effective output rate;
- all 68 instructions, 22 fixed account layouts, 52 event layouts, 390 constants, and 219 program errors in the checked-in Chancery schema;
- Squads vault, transaction, proposal, and ephemeral-signer PDA derivation;
- Squads vault-message encoding, decoding, account ordering, address lookup table placement, and execution remaining accounts;
- Squads proposal creation, optional activation, approval, and execution instruction construction;
- Chancery authority instructions compiled with the Squads vault as the signer.

Use the repository toolchain: Node.js 24, Yarn 4.2.2, TypeScript 6.0.3, and `tsx` 4.21.0.

## Static instruction builder

```bash
yarn test:instruction-builder
```

The test loads the checked-in Chancery schema and Squads IDL, verifies every template against its declared instruction fields, constructs and PDA-verifies all 68 Chancery instructions, verifies the Squads program address and required lifecycle instructions, derives the vault PDA, compiles a Squads proposal with an address lookup table, and verifies the generated execution account order.

The command and example gate also checks that:

- `app.mjs` and `serve.mjs` pass Node syntax checking;
- the local server returns the HTML, application module, Chancery schema, and Squads IDL and rejects a traversal request;
- the browser and TypeScript encoders produce identical Squads vault-message bytes and lifecycle instructions for the same Chancery input;
- both checked-in Squads TypeScript examples execute from compiled JavaScript and emit complete proposal bundles.

The application checks use the local server and deterministic fixtures. Wallet connection, live RPC, proposal submission, approval, and execution belong to deployment validation.

## Command and example surface

```bash
yarn test:commands
```

The gate validates every Yarn script and direct Node or Python path referenced by the Bash blocks in `README.md`, `VALIDATION.md`, and `integration/README.md`. It then executes the compiled TypeScript CLI help, deterministic `discover` and `decode-transaction` calls against a local JSON-RPC fixture, the compiled read-only example, both compiled Squads proposal examples, the instruction-builder server, the build compatibility verifier, the ProgramData verifier against deterministic upgradeable-loader account fixtures, and the direct-settlement runner help surface. The discovery fixture includes raw JSON integer literals above `Number.MAX_SAFE_INTEGER` for lamports and `rentEpoch`.

Live ProgramData inspection and direct settlement use the deployment gate with a deployed program, RPC endpoint, and authorized signer material.

## Python

```bash
PYTHONPATH=python python -m unittest discover \
  -s python/tests \
  -t python \
  -p 'test_*.py'
```

The Python suite covers the same discovery, PDA, limit, quote, transaction, and evidence behavior. It also verifies the standard-library Ed25519 implementation against an RFC 8032 test vector.

## Build and source binding

Compare the reference surface against its bound Chancery source tree with both compatibility verifiers:

```bash
node compatibility/VerifyBuildCompatibility.mjs \
  --source-root /path/to/chancery/source

python compatibility/verify_build_compatibility.py \
  --source-root /path/to/chancery/source
```

The compatibility record binds:

- Chancery program address;
- complete schema SHA-256;
- instruction, account, event, type, constant, error, wire, and PDA-surface hashes;
- aggregate SHA-256 and file count for the bound Chancery Rust source tree.

`compatibility/VerifyProgramData.mjs` parses the deployed upgradeable program and ProgramData accounts, hashes the deployed SBF bytes, and can enforce a supplied expected binary hash through a live RPC endpoint.

## Direct-settlement conformance gate

`integration/RunDirectSettlement.mjs` is included as the deployment-bound release gate. With an initialized deployment and authorized signers, it performs:

1. TypeScript direct mint, decoded by Python;
2. TypeScript direct redeem, decoded by Python;
3. Python direct mint, decoded by TypeScript;
4. Python direct redeem, decoded by TypeScript.

The runner fails on inspection, simulation, submission, confirmation, or canonical self-CPI evidence-decoding failure. Run it with deployment RPC credentials, initialized deployment configuration, and authorized signer material.

## Repository boundaries

The production reference schema is shared by the TypeScript, Python, and browser implementations. The compatibility gate checks the checked-in schemas against the production reference surface. Target selection supplies the command-line program identity and derived Chancery PDAs at runtime. Devnet preparation and public-controller instructions live separately under `integration/devnet/` and reuse the local reference codecs.

## Execution boundary

Deterministic fixtures test transaction construction, signing, simulation, submission, confirmation, and evidence-decoding control flow. Deployment conformance then verifies the target ProgramData, runs `discover`, `inspect`, and `quote-mint` or `quote-redeem`, and passes the supplied direct-settlement gate with authorized signers before submission is enabled.

## Rust reference and market-maker adapters

The top-level `rust/` crate is a direct-settlement reference for `mint_direct` and `redeem_direct`. The `integration/typescript`, `integration/python`, and `integration/rust` packages cover market-maker preparation and host execution for those two instructions.

Run the TypeScript integration tests directly with Node.js:

```bash
node --experimental-strip-types --test integration/typescript/test/*.test.ts
```

The tests cover both shared wire vectors, strict operation parsing, input bounds, market-maker mint and redeem preparation, reuse of one prepared transaction for simulation and submission, rejection before submission, and preservation of a submitted signature on confirmation failure.

When checking the direct mint and redeem builders against the bound Chancery IDL, compare the program address, discriminator bytes, all 31 ordered account names, signer flags, writable flags, and 50-byte payload length.

The language packages include tests and documented commands for Node.js 24+, Python 3.11+, and Rust 1.85+.
