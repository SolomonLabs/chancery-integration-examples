# Validation

The distribution gate covers the Chancery external integration surface in both implementations.

## Release-correctness gates

The release tree contains the following settlement corrections in TypeScript and Python:

- `ready` includes settlement-module activation, asset action enablement, asset extension chronology/freshness/approval, pathway extension restrictions, issued-token settlement readiness, issued-token extension chronology/freshness/restrictions, and evidence-policy binding;
- an external fee-recipient account is required only when the effective net fee is greater than zero and the recipient policy routes externally;
- redeem reserve sufficiency uses principal pre-transfer output plus only an externally routed net fee;
- inspection uses the on-chain Clock sysvar for policy time, expiry, usage-window rollover, and extension freshness;
- dependent RPC reads carry a minimum context slot and each inspection records its slot, Clock timestamp, epoch, commitment, and expiry slot;
- transaction preparation rejects an expired inspection.

## TypeScript

The clean source tree was checked using the repository TypeScript configuration:

```bash
tsc --noEmit -p tsconfig.json
```

The test suite was also compiled to JavaScript and run through the Node.js test runner:

```bash
tsc --outDir /tmp/chancery-integration-ts-build -p tsconfig.json
node --test /tmp/chancery-integration-ts-build/typescript/test/*.test.js
```

Result: **27 tests pass**. Strict typechecking passes. The compiled JavaScript tree loads its emitted Chancery schema and passes the same runtime tests.

Coverage includes:

- direct mint and redeem transaction construction;
- delegated mint and redeem transaction construction;
- trilateral mint and redeem transaction construction;
- exact ordered instruction-account resolution for each settlement mode;
- unversioned and version-zero message compilation;
- address lookup tables and Ed25519 signing;
- simulation, submission, confirmation, and confirmed-transaction retrieval through deterministic JSON-RPC fixtures;
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
- all 68 instructions, 22 fixed account layouts, 52 event layouts, 390 constants, and 219 program errors in the checked-in Chancery schema.

The packaging environment used Node.js 22.16.0 and TypeScript 5.8.3 for these checks. The repository itself pins Node.js 24, Yarn 4.2.2, TypeScript 6.0.3, and `tsx` 4.21.0 for consumers.

## Python

```bash
PYTHONPATH=python python -m unittest discover \
  -s python/tests \
  -t python \
  -p 'test_*.py'
```

Result: **28 tests pass** under Python 3.13.5.

The Python suite covers the same discovery, PDA, limit, quote, transaction, and evidence behavior. It also verifies the standard-library Ed25519 implementation against an RFC 8032 test vector.

## Build and source binding

Both compatibility verifiers pass against the Chancery source tree used to produce this distribution:

```bash
node compatibility/VerifyBuildCompatibility.mjs \
  --source-root /path/to/chancery/source

python compatibility/verify_build_compatibility.py \
  --source-root /path/to/chancery/source
```

The verified compatibility record includes:

- Chancery program address;
- complete schema SHA-256;
- instruction, account, event, type, constant, error, wire, and PDA-surface hashes;
- aggregate SHA-256 and file count for the bound Chancery Rust source tree.

`compatibility/VerifyProgramData.mjs` parses the deployed upgradeable program and ProgramData accounts, hashes the deployed SBF bytes, and can enforce a supplied expected binary hash. It requires a live RPC endpoint and was syntax-checked, but no live deployment hash is claimed by this package.

## Direct-settlement conformance gate

`integration/RunDirectSettlement.mjs` is included as the deployment-bound release gate. With an initialized deployment and authorized signers, it performs:

1. TypeScript direct mint, decoded by Python;
2. TypeScript direct redeem, decoded by Python;
3. Python direct mint, decoded by TypeScript;
4. Python direct redeem, decoded by TypeScript.

The runner fails on inspection, simulation, submission, confirmation, or canonical self-CPI evidence-decoding failure. Its command surface was syntax-checked. It was not executed against a live deployment because the package contains no RPC credentials, initialized deployment configuration, or authorized signer material.

## Distribution checks

- `typescript/chancery.schema.json` and `python/chancery_reference/chancery.schema.json` are byte-identical.
- Both schema files have SHA-256 `135b5a6453250101a5c1ea3751bac6382efa32a6d88eeb815c721bf1fdb26aaa`.
- The TypeScript runtime has no package dependencies.
- The Python runtime uses the standard library only.
- Source scans enforce the Chancery-only scope and prohibited-package boundary.
- Generated dependency directories, Python caches, compiled output, keypairs, and environment files are excluded from the archive.
- `MANIFEST.sha256` records every distributed file except the manifest itself.
- The final archive is tested once with `unzip -t`, extracted once into a clean directory, compared byte-for-byte with the release tree, and verified against its archive SHA-256.

## Execution boundary

Deterministic fixtures test transaction construction, signing, simulation, submission, confirmation, and evidence-decoding control flow. They do not substitute for deployment conformance. External consumers must verify the target ProgramData, run `discover`, `inspect`, and `quote-mint` or `quote-redeem`, then pass the supplied direct-settlement conformance gate with authorized signers before enabling submission.
