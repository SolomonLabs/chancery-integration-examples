# Chancery Integration Examples

Standalone TypeScript and Python reference clients, a top-level Rust direct-settlement example set, dependency-free Squads v4 proposal builders, a static instruction generator, and language-specific market-maker integrations.

**Program address:** `ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz`

The TypeScript and Python reference implementations directly implement public-key handling, PDA derivation, account codecs, instruction codecs, transaction messages, Ed25519 signing, token-state decoding, RPC calls, and Chancery evidence decoding. The Rust example set uses public Rust crates for Solana instruction types.

## Access and authorization

Chancery enforces authorization on-chain through `PermissionRecord` role bits, pathway policy, asset mode, module activation, and pause state. State-changing integrations use an approved permission record, eligible pathway, and associated policy configuration.

`discover` and `decode-transaction` consume public RPC data. Settlement commands use the signers required by the selected pathway.

## Intended consumers

The repository serves four integration patterns:

- **Read-only integrations** — indexers, oracles, reconciliation systems, risk and treasury reporting. These use `discover` to inventory deployment state and `decode-transaction` to read canonical self-CPI settlement evidence from public RPC data. See `typescript/examples/ReadOnlyIntegration.ts` and `python/examples/read_only_integration.py`.
- **Settlement integrations** — a principal, a delegated executor, or a trilateral counterparty set holding an on-chain permission grant. These additionally use `inspect`, `quote-mint`, `quote-redeem`, `mint`, and `redeem`. See `typescript/examples/SettlementWorkflow.ts` and `python/examples/settlement_workflow.py`.
- **Governance integrations** — Squads v4 members constructing vault transactions that contain one or more ordered Chancery instructions. See `typescript/examples/SquadsChanceryProposal.ts`, `typescript/examples/SquadsChanceryBatchProposal.ts`, and `web/instruction-builder/`.
- **External market-maker integrations:** authorized market makers, minting entities, redemption counterparties, and treasury systems embedding `mint_direct` and `redeem_direct` in their existing transaction, custody, and reconciliation systems. See `integration/` and the top-level `rust/` reference.

`--principal`, `--principal-b`, and `--executor` map directly to the identities Chancery binds in a settlement.

## Client capabilities

Both clients provide the same operational surface:

| Command | Signing key | Result |
|---|---|---|
| `discover` | not required | Fetch and decode the complete Chancery-owned account set, group all account types, verify canonical PDAs and stored bumps, and link assets, pathways, fees, limits, evidence policies, and reserve destinations. |
| `decode-transaction` | not required | Fetch a confirmed transaction and decode canonical Chancery self-CPI evidence from `meta.innerInstructions`. |
| `inspect` | not required | Resolve one mint or redeem operation, including identities, permissions, policies, windows, balances, token accounts, PDAs, rates, fees, transfer-fee effects, and blocking conditions. |
| `quote-mint` | required | Build and sign the exact mint transaction, call `simulateTransaction`, and return the simulation result. |
| `mint` | required | Inspect, build, sign, simulate, submit, confirm, fetch the transaction, and decode Chancery evidence. |
| `quote-redeem` | required | Build and sign the exact redeem transaction, call `simulateTransaction`, and return the simulation result. |
| `redeem` | required | Inspect, build, sign, simulate, submit, confirm, fetch the transaction, and decode Chancery evidence. |

Every command prints machine-readable JSON. TypeScript preserves decimal JSON-RPC integers outside the JavaScript safe-integer range as `bigint` values and serializes `bigint` values as decimal strings. This includes the rent-exempt `rentEpoch` value `u64::MAX`. Python serializes integers as JSON numbers and byte arrays as `0x` hexadecimal strings.

## Runtime foundations

The TypeScript runtime uses Node.js built-ins, `fetch`, and `Uint8Array`. `typescript`, `tsx`, and Node type definitions support development and compilation. `yarn build:typescript` emits the JSON schema beside the compiled JavaScript.

The Python runtime uses the standard library, including its direct Ed25519 implementation for Solana transaction signing.

The Rust reference set uses public Rust crates and returns `solana_sdk::instruction::Instruction` for direct mint and redeem operations. Host applications place those instructions into their RPC, signing, submission, and confirmation pipelines.

## Install and validate

### TypeScript

Requirements: Node.js 24 and Yarn 4.2.2.

```bash
corepack enable
yarn install --immutable
yarn typecheck
yarn test:typescript
yarn test:instruction-builder
yarn test:commands
```

### Python

Requirements: Python 3.11 or newer.

```bash
PYTHONPATH=python python -m unittest discover \
  -s python/tests \
  -t python \
  -p 'test_*.py'
```

### Rust direct-settlement reference

Requirements: Rust 1.85 or newer.

```bash
cargo test --manifest-path rust/Cargo.toml
```

### Market-maker TypeScript adapter

```bash
yarn test:integration:typescript
```

The Rust examples and all external market-maker adapters are documented in `rust/README.md` and `integration/README.md`.

## 1. Discover the complete Chancery state

TypeScript:

```bash
yarn cli:typescript discover \
  --rpc "$RPC_URL" \
  --commitment confirmed
```

Python:

```bash
PYTHONPATH=python python -m chancery_reference.cli discover \
  --rpc "$RPC_URL" \
  --commitment confirmed
```

`discover` calls `getProgramAccounts` for the fixed Chancery program address, rejects accounts with the wrong owner or executable flag, decodes every recognized discriminator, preserves unrecognized discriminators, and returns:

- `recognizedAccounts` / `recognized_accounts`: every decoded Chancery-owned account;
- `accountsByType` / `accounts_by_type`: a complete grouping for all 22 account layouts;
- `unrecognizedAccounts` / `unrecognized_accounts`: address, length, and discriminator for unknown Chancery-owned data;
- `knownPdas` / `known_pdas`: singleton and signer PDAs, with `state_account` or `signer_pda` classification;
- `assets`: asset config, asset pause state, token program, deposit rate, redeem rate, pathways, and reserve destinations;
- `pathways`: linked fee, pathway limit, asset mint/redeem limit, counterparty limit, executor limit, evidence policy, and reserve destinations;
- the actual settlement limit model: pathway, asset, counterparty, and executor volume scopes;
- an explicit statement that Chancery has a global pause account but no separate global settlement-volume accumulator.

The grouped account set covers:

```text
AssetConfig                AssetPauseState
AuthorityTransfer          BasicFreezeRecord
ChanceryConfig              CrossChainSignerSet
EvidencePolicy              FeePolicy
IssuedTokenControl          LimitPolicy
ModuleActivationState       OutboundReclaimRecord
PathwayPolicy               PauseState
PendingConfigChange         PermissionRecord
RemoteDomainPolicy          RemoteNonce
ReserveDestination          SettlementIntent
SettlementPolicy            UsageWindow
```

### Canonical PDA verification

For every derivable account family, discovery returns:

```text
expectedAddress
bump
seed byte sequences
addressMatches
storedBump
storedBumpMatches
```

The clients expose direct derivation functions for:

```text
authority-transfer
asset-config
asset-pause
basic-freeze-record
cross-chain-signer-set
evidence-policy
fee-policy
limit-policy
outbound-reclaim
pathway-policy
pending-config-change
permission
remote-domain-policy
remote-nonce
reserve-destination
settlement-intent
settlement-policy
usage-window
```

They also report the fixed Chancery config, module activation, pause, issued-token control, event authority, mint authority, and reserve authority PDAs.

`RemoteNonce` account data omits `remote_chain_kind`. Discovery links it to `RemoteDomainPolicy` accounts with the same domain ID, derives each candidate using the policy's chain-kind byte, and verifies the candidate that matches the nonce account address. Ambiguous policy linkage produces an unresolved canonical result.

## 2. Decode Chancery self-CPI evidence

TypeScript:

```bash
yarn cli:typescript decode-transaction \
  --rpc "$RPC_URL" \
  --signature "$TRANSACTION_SIGNATURE"
```

Python:

```bash
PYTHONPATH=python python -m chancery_reference.cli decode-transaction \
  --rpc "$RPC_URL" \
  --signature "$TRANSACTION_SIGNATURE"
```

The decoder:

1. rejects evidence extraction from a failed transaction;
2. combines static account keys with version-zero loaded writable and readonly addresses;
3. traverses `meta.innerInstructions`;
4. selects instructions invoked by the Chancery program;
5. requires the canonical event-authority PDA as account zero;
6. requires the Chancery event-CPI prefix;
7. identifies the event discriminator;
8. deserializes the complete event layout;
9. returns the parent instruction index, inner instruction index, and stack height with the decoded event.

The schema contains 52 Chancery event layouts. Submission commands automatically fetch the confirmed transaction and run the same decoder.

## 3. Inspect a mint or redeem operation

Direct mint:

```bash
yarn cli:typescript inspect \
  --action mint \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000
```

Direct redeem:

```bash
yarn cli:typescript inspect \
  --action redeem \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000
```

The Python CLI accepts the same options:

```bash
PYTHONPATH=python python -m chancery_reference.cli inspect \
  --action mint \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000
```

### Pathway selection

The client fetches `PathwayPolicy` accounts by discriminator and exact account size, then filters by:

- asset mint;
- issued-token mint from `ChanceryConfig` and `IssuedTokenControl`;
- direct, delegated, or trilateral pathway kind;
- optional pathway ID;
- pathway status;
- canonical pathway PDA.

Zero eligible pathways is an error. One eligible pathway proceeds automatically. Multiple eligible pathways require `--pathway-id`.

### State and account resolution

`inspect` resolves and prints:

- `ModuleActivationState`;
- `ChanceryConfig`;
- `PauseState`;
- `IssuedTokenControl`;
- `AssetConfig`;
- `AssetPauseState`;
- selected `PathwayPolicy`;
- linked `FeePolicy`;
- linked pathway, asset, counterparty, and executor `LimitPolicy` accounts;
- linked `EvidencePolicy`;
- `SettlementIntent` and `SettlementPolicy` when required;
- principal A, principal B, and executor identities;
- canonical `PermissionRecord` PDAs and decoded role observations;
- canonical `UsageWindow` PDAs and decoded current usage;
- mint-authority and reserve-authority PDAs;
- reserve associated token account;
- source, destination, and fee-recipient token accounts;
- asset and issued-token mint state;
- matching `ReserveDestination` accounts;
- exact instruction arguments;
- exact ordered instruction-account mapping;
- every derived PDA, bump, and seed sequence;
- all blocking issues and the final `ready` result.

Explicit token-account overrides are accepted, and each override is checked against the required mint, owner, and token program. In their absence, the client tries the canonical associated token account and then accepts a non-associated account when the owner/mint query produces a unique result.

Callers supply existing token accounts. Missing required accounts are reported as blocking issues.

## 4. Calculate remaining limits correctly

The client reproduces Chancery settlement-limit semantics instead of subtracting one generic counter:

### Directional accumulators

```text
mint   -> UsageWindow.gross_in
redeem -> UsageWindow.gross_output_amount
```

Mint limits use the requested collateral amount. This matches Chancery’s conservative accounting even when a Token-2022 transfer fee causes the reserve to receive less.

Redeem limits use gross asset output before Chancery fee deduction and before the recipient transfer fee.

### Fixed periods

For hourly, daily, seven-day, and thirty-day windows, the client calculates the canonical current period start from `nowUnixTimestamp` / `now_unix_timestamp`.

- A stored window from an earlier period is treated as rolled to zero before checking the proposed operation.
- A stored window start after the canonical current period is a clock-regression blocking issue.
- A missing PDA account for an enforced window is a blocking issue.

For each window, the report includes:

```text
maximum
currentAmount
proposedAmount
projectedAmount
remainingBefore
remainingAfter
currentActionCount
projectedActionCount
actionRemainingBefore
actionRemainingAfter
rolledBeforeCheck
clockRegression
allowed
actionAllowed
```

### Limit dimensions

The settlement report evaluates:

- pathway policy: per-transaction, hourly, daily, seven-day, thirty-day, and action-count caps configured by that policy;
- asset policy: per-transaction and daily cap, with policy scope bound to the asset mint;
- counterparty policy: per-transaction and daily cap, using the zero-key template policy and a concrete per-principal daily window;
- trilateral counterparty policies: separate principal-A and principal-B daily windows;
- executor policy: per-transaction and daily cap, using the zero-key template policy and a concrete executor window.

The client fails closed when a dimension policy has the wrong scope kind, wrong scope key, unsupported hourly/seven-day/thirty-day/action-count caps, or a delegated counterparty policy missing its required daily cap.

Global settlement control uses `PauseState`; volume containment is enforced through the four dimensions above.

## 5. Calculate rates, Chancery fees, and transfer-aware effective amounts

`AssetConfig` supplies:

```text
deposit_rate_e9
redeem_rate_e9
```

The configured conversion is:

```text
mint gross output   = rate input × deposit_rate_e9 / 1_000_000_000
redeem gross output = issued-token input × redeem_rate_e9 / 1_000_000_000
```

The report keeps the following amounts distinct:

```text
requested input
configured gross output from requested input
asset transfer fee on mint input
reserve-received mint input
rate input
Chancery gross output
assessed fee
nominal rebate
effective rebate
net Chancery fee
output before recipient transfer
asset transfer fee on redeem output
principal received amount
routed fee transfer amount
fee-recipient received amount
all-in output reduction
all-in fee basis points
effective output rate e9
```

### Mint

For Token-2022 collateral with `TransferFeeConfig`, the client selects the active fee schedule for the current epoch, applies ceiling division and the maximum-fee cap, and calculates the amount the reserve is expected to receive. Chancery issuance is calculated from that reserve-received amount.

Minted issued tokens are credited directly through `mint_to`; the issued-token destination receives the minted amount independently of the asset transfer-fee configuration.

### Redeem

Chancery calculates gross asset output from the issued-token input, deducts the Chancery fee, then transfers asset tokens from the reserve. The client calculates the Token-2022 transfer fee on the principal transfer and, when the Chancery fee is routed, separately calculates the transfer fee on the fee-recipient transfer.

### Fee policy

The report decodes and applies:

- asset or issued-token denomination;
- flat fee;
- percentage fee;
- floor, ceiling, or nearest rounding;
- fee cap;
- minimum fee;
- flat or percentage rebate;
- rebate cap;
- non-negative net-fee floor;
- activation and expiry;
- fee-retention or fee-routing policy;
- fee-recipient owner and token account.

A mint fee policy must use issued-token denomination. A redeem fee policy must use asset denomination. A mismatch is a blocking issue.

`minimum-output` is checked against the predicted principal receipt, not merely the pre-transfer Chancery net output.

### Exactness boundary

The local result is exact for supported SPL Token and Token-2022 transfer-fee behavior at the fetched epoch and account state. An unavailable mint account or an extension requiring execution-time amount evaluation sets `requiresSimulationForExactAmount` / `requires_simulation_for_exact_amount`.

Transaction simulation remains the program-authoritative check against the current slot, current account state, transfer-hook behavior, CPI results, and concurrent state changes.

## 6. Build, simulate, and submit mint transactions

Simulate a direct mint:

```bash
yarn cli:typescript quote-mint \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000 \
  --signer ./principal-keypair.json
```

Submit a direct mint:

```bash
yarn cli:typescript mint \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000 \
  --signer ./principal-keypair.json
```

Python uses the same command names and options:

```bash
PYTHONPATH=python python -m chancery_reference.cli quote-mint \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --signer ./principal-keypair.json
```

## 7. Build, simulate, and submit redeem transactions

```bash
yarn cli:typescript quote-redeem \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000 \
  --signer ./principal-keypair.json

yarn cli:typescript redeem \
  --mode direct \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL" \
  --amount 1000000 \
  --minimum-output 995000 \
  --signer ./principal-keypair.json
```

## Delegated and trilateral settlements

Delegated settlement reads the amount, principal, executor, pathway, minimum output, and optional settlement policy from the canonical `SettlementIntent`. The executor signs.

```bash
yarn cli:typescript mint \
  --mode delegated \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL_A" \
  --executor "$EXECUTOR" \
  --intent-id "$INTENT_ID" \
  --fee-payer "$EXECUTOR" \
  --signer ./executor-keypair.json \
  --lookup-table "$ADDRESS_LOOKUP_TABLE"
```

Trilateral settlement requires executor, principal A, and principal B signatures. Repeated `--signer` and `--lookup-table` options are supported.

```bash
yarn cli:typescript redeem \
  --mode trilateral \
  --rpc "$RPC_URL" \
  --asset-mint "$ASSET_MINT" \
  --principal "$PRINCIPAL_A" \
  --principal-b "$PRINCIPAL_B" \
  --executor "$EXECUTOR" \
  --intent-id "$INTENT_ID" \
  --fee-payer "$EXECUTOR" \
  --signer ./executor-keypair.json \
  --signer ./principal-a-keypair.json \
  --signer ./principal-b-keypair.json \
  --lookup-table "$ADDRESS_LOOKUP_TABLE"
```

## Transaction implementation

The transaction path directly implements:

- Chancery discriminator and argument encoding;
- exact account order from the checked-in schema;
- signer and writable flags;
- optional zero-address placeholders;
- fixed program addresses;
- compact-u16 Solana vector lengths;
- account-meta aggregation and canonical ordering;
- unversioned messages;
- version-zero messages;
- address lookup table decoding and placement;
- recent blockhash insertion;
- Ed25519 message signatures;
- transaction serialization;
- packet-size enforcement.

`quote-mint` and `quote-redeem` sign the transaction and call `simulateTransaction` with signature verification enabled.

`mint` and `redeem` run the same simulation first. Submission stops on a simulation error. A successful simulation is followed by `sendTransaction`, confirmation polling through the last valid block height, `getTransaction`, and Chancery evidence decoding.

## Embedding the TypeScript client

```ts
import {
    ChanceryClient,
    loadSolanaKeypairFile,
} from "./typescript/src/index.js";

const signer = loadSolanaKeypairFile("./principal-keypair.json");
const client = new ChanceryClient(process.env.RPC_URL ?? "", "confirmed");

const discovery = await client.discover();
process.stdout.write(`${ChanceryClient.stringify(discovery)}\n`);

const inspection = await client.inspect({
    action: "mint",
    mode: "direct",
    assetMint: process.env.ASSET_MINT ?? "",
    principal: signer.publicKey,
    amount: 1_000_000n,
    minimumOutput: 995_000n,
});

process.stdout.write(`${ChanceryClient.stringify(inspection)}\n`);
if (!inspection.ready) {
    throw new Error(inspection.blockingIssues.join("\n"));
}

const simulation = await client.simulateTransaction(inspection, {
    feePayer: signer.publicKey,
    keypairs: [signer],
    commitment: "confirmed",
});

if (simulation.simulation.err !== null) {
    throw new Error(JSON.stringify(simulation.simulation.err));
}
```

## Embedding the Python client

```python
from chancery_reference.client import (
    ChanceryClient,
    SettlementOperationRequest,
    SettlementTransactionRequest,
)
from chancery_reference.solana_transaction import load_solana_keypair_file

signer = load_solana_keypair_file("./principal-keypair.json")
client = ChanceryClient(RPC_URL, "confirmed")

discovery = client.discover()
print(ChanceryClient.stringify(discovery))

inspection = client.inspect(
    SettlementOperationRequest(
        action="redeem",
        mode="direct",
        asset_mint=ASSET_MINT,
        principal=signer.public_key,
        amount=1_000_000,
        minimum_output=995_000,
    )
)

print(ChanceryClient.stringify(inspection))
if not inspection.ready:
    raise RuntimeError("\n".join(inspection.blocking_issues))

transaction_request = SettlementTransactionRequest(
    fee_payer=signer.public_key,
    keypairs=(signer,),
    commitment="confirmed",
)

simulation = client.simulate_transaction(inspection, transaction_request)
if simulation.simulation.error is not None:
    raise RuntimeError(str(simulation.simulation.error))
```

## Runnable examples

Read-only and settlement examples are provided in both languages. TypeScript additionally includes single-instruction and multi-instruction Squads proposal examples.

### Read-only

`ReadOnlyIntegration.ts` and `read_only_integration.py` require no key material. They print a deployment summary — account counts by type, unrecognized-account count, asset mints, and pathway IDs — and decode Chancery evidence for any supplied transaction signatures.

```bash
RPC_URL="$RPC_URL" yarn example:read-only:typescript

RPC_URL="$RPC_URL" PYTHONPATH=python python python/examples/read_only_integration.py
```

| Variable | Required | Effect |
|---|---|---|
| `RPC_URL` | yes | JSON-RPC endpoint. |
| `FULL_DISCOVERY` | no | Set to `true` to additionally print the complete decoded account inventory. |
| `TRANSACTION_SIGNATURES` | no | Comma-separated signatures; each is fetched and its Chancery evidence decoded. |

### Settlement

`SettlementWorkflow.ts` and `settlement_workflow.py` inspect one operation, simulate it, and optionally submit it. They require signer keypairs and an on-chain permission grant.

```bash
RPC_URL="$RPC_URL" \
ACTION=mint \
MODE=direct \
ASSET_MINT="$ASSET_MINT" \
PRINCIPAL="$PRINCIPAL" \
AMOUNT=1000000 \
KEYPAIR_PATHS=./principal-keypair.json \
yarn example:settlement:typescript
```

| Variable | Required | Effect |
|---|---|---|
| `RPC_URL` | yes | JSON-RPC endpoint. |
| `ACTION` | yes | `mint` or `redeem`. |
| `ASSET_MINT` | yes | Collateral mint. |
| `PRINCIPAL` | yes | Principal identity. |
| `KEYPAIR_PATHS` | yes | Comma-separated keypair paths for every required signer. |
| `MODE` | no | `direct` (default), `delegated`, or `trilateral`. |
| `AMOUNT` | direct mode | Raw unsigned input amount. |
| `INTENT_ID` | delegated/trilateral | Settlement intent to execute. |
| `MINIMUM_OUTPUT` | no | Slippage bound checked against predicted principal receipt. |
| `PATHWAY_ID` | no | Required when more than one pathway is eligible. |
| `EXECUTOR`, `PRINCIPAL_B` | no | Additional identities for delegated and trilateral modes. |
| `FEE_PAYER` | no | Defaults to the first signer. |
| `LOOKUP_TABLES` | no | Comma-separated address lookup tables for version-zero messages. |
| `SUBMIT` | no | Set to `true` to submit after a successful simulation. Otherwise the example stops at simulation. |

An inspection status other than `ready` causes exit `2` before simulation and prints every blocking issue.

## Rust and market-maker direct-settlement examples

The existing top-level TypeScript, Python, and web examples remain unchanged. The top-level `rust/` crate adds typed builders, strict operation-document parsing, normalized instruction output, mint and redeem examples, and shared wire-vector tests for `mint_direct` and `redeem_direct`.

The `integration/` directory contains separate market-maker-facing packages for TypeScript, Python, and Rust. These packages accept a current approved account bundle and operation values, construct one direct-settlement instruction, and expose a host boundary for transaction preparation, exact-transaction simulation, submission, confirmation, and reconciliation.

Start with:

- `integration/README.md` for the directory map and quick starts;
- `integration/MARKET-MAKER-INTEGRATION.md` for the system boundary;
- `integration/OPERATION-DOCUMENT.md` for the cross-language input contract;
- `integration/DIRECT-SETTLEMENT.md` for exact wire layout; and
- `integration/PRODUCTION-OPERATIONS.md` for operational controls.

TypeScript market-maker preparation examples can be run from the repository root:

```bash
yarn example:integration:mint:typescript
yarn example:integration:redeem:typescript
```

The checked-in fixtures are synthetic. The preparation examples emit normalized instructions for the host signing and submission pipeline.

## Squads v4 proposal wrapping

The TypeScript surface directly encodes one or more ordered Chancery instructions into the Squads vault-transaction message format and emits the complete proposal lifecycle:

- Squads vault, vault-transaction, proposal, and ephemeral-signer PDA derivation;
- deterministic vault-message account ordering and instruction compilation;
- optional address lookup table placement;
- `vaultTransactionCreate` and `proposalCreate` instructions;
- optional `proposalActivate` for draft proposals;
- `proposalApprove` and `vaultTransactionExecute` instructions;
- execution remaining accounts in the order required by the compiled message.

`buildSquadsProposalBundle` returns the derived addresses, decoded transaction message, encoded transaction-message bytes, and each lifecycle instruction. The host wallet handles proposal submission, voting, and execution.

Single Chancery instruction:

```bash
SQUADS_MULTISIG_ADDRESS="$SQUADS_MULTISIG_ADDRESS" \
SQUADS_CREATOR_ADDRESS="$SQUADS_CREATOR_ADDRESS" \
SQUADS_TRANSACTION_INDEX=1 \
yarn example:squads:typescript
```

Multiple Chancery instructions in one Squads vault transaction:

```bash
SQUADS_MULTISIG_ADDRESS="$SQUADS_MULTISIG_ADDRESS" \
SQUADS_CREATOR_ADDRESS="$SQUADS_CREATOR_ADDRESS" \
SQUADS_TRANSACTION_INDEX=1 \
ASSET_MINT="$ASSET_MINT" \
yarn example:squads-batch:typescript
```

The transaction index must be the next index expected by the target multisig. The default vault index is `0`. The examples print machine-readable instruction objects for host submission.

## Static HTML/MJS instruction builder

`web/instruction-builder/` is a build-free, dependency-free single-page application backed by the checked-in Chancery schema and Squads IDL. It provides one template per settlement mode: `mint_direct`, `mint_delegated`, `mint_trilateral`, `redeem_direct`, `redeem_delegated`, and `redeem_trilateral`. Every mode fixes `issued_token_mint` to `USDvUSpnhCr9yBgj3UyVrD239HRUv4RsHwH2FxsWuMk` and offers `asset_mint` as a selection of the USDC, USDT, USDG, and PYUSD mainnet mints. Squads wrapping is off by default; when enabled, direct modes place the Squads vault as `principal` and delegated and trilateral modes place it as `executor`.

Run it with either command:

```bash
yarn app:instructions
# or
node web/instruction-builder/serve.mjs
```

Open `http://127.0.0.1:4173`. The application can:

- populate instruction arguments, fixed accounts, and known Chancery PDAs;
- derive and optionally verify instruction-specific Chancery PDAs;
- substitute the selected Squads vault for `$SQUADS_VAULT` template values;
- compile the Chancery instruction into a Squads vault proposal;
- accept address lookup table contents when the proposal message requires them;
- export account metas and instruction data as hexadecimal and base64 JSON;
- compile each instruction set into an unsigned legacy transaction when a fee payer is supplied, with a zero-blockhash placeholder unless a recent blockhash is entered;
- export the generated JSON, or the unsigned transaction bytes of a selected phase (`chancery`, or `creation`, `activation`, `approval`, `execution` when wrapped), as base64 or base58 files.

The application emits instruction-construction material for an authorized host transaction pipeline that provides RPC access, wallet connection, signing, simulation, submission, approval, and execution.

## Observation consistency

`inspect` establishes a minimum RPC context slot, reads the on-chain Clock sysvar, and applies the resulting slot as the minimum context for dependent account reads. The inspection prints:

```text
context slot
Clock Unix timestamp
Clock epoch
commitment
expiry slot
timestamp source
```

Usage-window rollover, policy activation and expiry, permission expiry, settlement-intent expiry, and extension-observation freshness use the Clock values. Transaction preparation rejects an inspection after its expiry slot. Solana JSON-RPC supplies independent account observations, and simulation provides the execution-time state check.

## Build and deployment binding

The distribution includes `BUILD-COMPATIBILITY.json`, which binds the clients to the Chancery program ID, complete wire schema, protocol-surface hashes, and the aggregate Chancery source-tree hash used to derive the reference surface.

Verify the package and an available Chancery source tree with either implementation:

```bash
node compatibility/VerifyBuildCompatibility.mjs --source-root /path/to/chancery/source
python compatibility/verify_build_compatibility.py --source-root /path/to/chancery/source
```

Inspect or enforce the deployed ProgramData binary hash:

```bash
node compatibility/VerifyProgramData.mjs \
  --rpc "$RPC_URL" \
  --expected-sha256 "$PROGRAM_BINARY_SHA256"
```

Run the deployment-bound direct-settlement conformance gate after copying `integration/live-direct-settlement.example.json` to `integration/live-direct-settlement.json` and filling in every placeholder:

```bash
yarn integration:direct integration/live-direct-settlement.json
```

The runner submits TypeScript mint and redeem operations decoded by Python, followed by Python mint and redeem operations decoded by TypeScript.

## Repository layout

```text
typescript/src/client/ChanceryClient.ts          Operational TypeScript client
typescript/src/client/ChanceryDiscovery.ts       Full state discovery and PDA verification
typescript/src/client/ChanceryProtocol.ts        Chancery policy, fee, limit, and PDA rules
typescript/src/client/cli.ts                     TypeScript CLI
typescript/src/ChanceryRpc.ts                    JSON-RPC client
typescript/src/JsonRpcCodec.ts                   Lossless JSON-RPC integer decoding
typescript/src/ChanceryInstruction.ts            Direct instruction encoding
typescript/src/ChanceryAccount.ts                Direct account encoding and decoding
typescript/src/ChanceryEvent.ts                  Self-CPI evidence decoding
typescript/src/SolanaTransaction.ts              Message compilation and signing
typescript/src/SplToken.ts                       SPL Token and Token-2022 decoding
typescript/src/squads/                            Squads v4 PDA, message, and proposal builders

python/chancery_reference/client.py              Operational Python client
python/chancery_reference/discovery.py           Full state discovery and PDA verification
python/chancery_reference/chancery_protocol.py   Chancery policy, fee, limit, and PDA rules
python/chancery_reference/cli.py                 Python CLI
python/chancery_reference/rpc.py                 JSON-RPC client
python/chancery_reference/instruction.py         Direct instruction encoding
python/chancery_reference/account.py             Direct account encoding and decoding
python/chancery_reference/event.py               Self-CPI evidence decoding
python/chancery_reference/solana_transaction.py  Message compilation and Ed25519 signing
python/chancery_reference/spl_token.py           SPL Token and Token-2022 decoding

typescript/examples/ReadOnlyIntegration.ts       Read-only TypeScript example
typescript/examples/SettlementWorkflow.ts        Settlement TypeScript example
typescript/examples/SquadsChanceryProposal.ts     Single-instruction Squads proposal example
typescript/examples/SquadsChanceryBatchProposal.ts Multi-instruction Squads proposal example
python/examples/read_only_integration.py         Read-only Python example
python/examples/settlement_workflow.py           Settlement Python example

rust/src/direct_settlement.rs                   Typed Rust direct mint and redeem builders
rust/examples/                                   Rust instruction construction examples
rust/tests/                                      Rust wire-vector tests

integration/typescript/                         TypeScript market-maker adapter
integration/python/                             Python market-maker adapter
integration/rust/                               Rust market-maker adapter
integration/fixtures/                           Shared direct-settlement operation fixtures
integration/MARKET-MAKER-INTEGRATION.md         External onboarding and workflow boundary
integration/OPERATION-DOCUMENT.md               Strict cross-language operation document
integration/DIRECT-SETTLEMENT.md                Direct instruction wire contract
integration/PRODUCTION-OPERATIONS.md            Submission and reconciliation requirements

fixtures/wire-vectors.json                       Shared deterministic vectors
BUILD-COMPATIBILITY.json                         Program, schema, and source binding
CORRECTNESS-CONTRACT.md                          Consumer correctness boundary
compatibility/VerifyBuildCompatibility.mjs       Node compatibility verifier
compatibility/verify_build_compatibility.py      Python compatibility verifier
compatibility/VerifyProgramData.mjs              Deployed ProgramData verifier
integration/RunDirectSettlement.mjs              Live direct-settlement conformance gate
integration/live-direct-settlement.example.json  Deployment configuration template
validation/VerifyCommandExamples.mjs             Deterministic command and example gate
web/instruction-builder/                          Static HTML/MJS instruction generator
VALIDATION.md                                    Distribution validation record
MANIFEST.sha256                                  Per-file SHA-256 manifest
```

## Checked-in Chancery wire surface

The schema contains:

```text
68 instructions
22 fixed account layouts
52 event layouts
390 constants
219 program errors
```

Instruction, account, and event encoding is direct and deterministic:

- public keys are raw 32-byte values and base58 strings at API boundaries;
- Chancery instruction discriminators are two bytes;
- integers are little-endian in Chancery data;
- options use one-byte tags;
- Chancery vectors use four-byte little-endian lengths;
- fixed accounts enforce exact declared sizes and explicit padding;
- event data is decoded only from canonical Chancery self-CPI instructions.

## Validation boundary

The test fixtures exercise complete discovery, account decoding, PDA derivation, permission and policy resolution, directional rolling-limit calculations, transfer-fee-aware quotes, exact instruction accounts, transaction compilation, signing, simulation, submission, confirmation, and evidence decoding with deterministic local inputs.

Live deployment acceptance requires target ProgramData verification, `discover`, `inspect`, `quote-mint` or `quote-redeem`, and the supplied direct-settlement conformance gate with authorized signers.
