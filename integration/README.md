# Direct settlement conformance gate

`RunDirectSettlement.mjs` executes four confirmed direct settlements against an initialized Chancery deployment:

1. TypeScript mint, decoded by Python.
2. TypeScript redeem, decoded by Python.
3. Python mint, decoded by TypeScript.
4. Python redeem, decoded by TypeScript.

Each submission must confirm and the other implementation must decode at least one canonical Chancery self-CPI event. The runner exits nonzero on inspection, simulation, submission, confirmation, or evidence-decoding failure.

Copy `integration/live-direct-settlement.example.json` to `integration/live-direct-settlement.json`, replace every placeholder, install the TypeScript development dependencies, and run from the repository root:

```bash
yarn integration:direct integration/live-direct-settlement.json
```

Relative keypair paths are resolved from the configuration file directory. The configuration refers to keypair paths but does not contain key material. Do not add signer files to this repository.
