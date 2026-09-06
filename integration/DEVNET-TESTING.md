# Devnet integration testing

Run the existing integration examples against the specialized Chancery devnet deployment. This repository supplies its own clients, target selection, and devnet-only preparation tools. The separate `chancery-devnet` repository is the deployment and program reference.

## Select the target

Use Node.js 24 and Yarn 4.2.2. Run from this repository's root:

~~~bash
yarn install --immutable
export CHANCERY_TARGET=devnet
export RPC_URL=https://api.devnet.solana.com
~~~

Set `CHANCERY_TARGET` before starting each process. It selects the program address, Chancery PDA derivation, and event-program identity in the TypeScript and Python reference clients and the TypeScript, Python, and Rust direct-settlement builders. The default is `mainnet`; accepted values are `mainnet` and `devnet`. Select the corresponding RPC separately through `RPC_URL` or the existing `--rpc` option.

Configured identities:

- Chancery: `3doMTb5u94mzTDoBbyJXbZscNE3suuQe75ybYmirKute`.
- Faucet/controller: `6JgE46kwvTqPpY7s2DDjFDvSqWdmfm9puoDBRqHubn85`.
- Issued-token mint: `FEA2m8pnzXLXdh3irYhJPKgmLhK23sdSgB1KjmXqyVqz`.

The identities in `integration/devnet/configuration/Deployment.ts` correspond to the supplied deployment's `config/networks/devnet.ts`. Network commands check the devnet genesis. Preparation and administration also check executable program accounts, the issued mint, and the public controller authority handoff. Commands use a provisioned deployment with active collateral configurations, enabled modules, and a settlement-ready issued token.

The browser instruction generator and production compatibility checks retain their checked-in production reference binding. The command-line examples described here select their target through `CHANCERY_TARGET`.

## Prepare a tester

~~~bash
yarn devnet:wallet --keypair .devnet/tester/keypair.json
yarn devnet:fund --keypair .devnet/tester/keypair.json
yarn devnet:setup --keypair .devnet/tester/keypair.json --symbol USDC --amount 3000000 > .devnet/tester/setup.json
~~~

Wallet creation writes a new Solana keypair with owner-only permissions and exclusive creation. Reuse an existing wallet by proceeding directly to funding and setup. The `.devnet/` directory is excluded from Git.

Funding requests enough devnet SOL to reach 100,000,000 lamports. `--lamports` selects another minimum. `--skip-airdrop` checks the minimum for a wallet funded through another devnet SOL source. An airdrop failure ends the command.

Setup registers a deterministic direct pathway for the principal and collateral mint, grants `CAN_MINT_DIRECT` and `CAN_REDEEM_DIRECT` for that pathway, creates issued-token and reserve associated token accounts, and faucets collateral into the principal's associated token account. Its JSON output includes principal, pathway ID, pathway address, permission address, asset mint, and asset token account. Transaction-stage signatures go to standard error.

The default pathway has zero fee, limit, evidence, insurance, and dimension-policy identifiers. Existing pathways must match that profile. Repeating setup preserves matching pathway and permission state and performs another faucet request. `--pathway-id` selects a specific nonzero 32-byte hexadecimal route identifier.

Faucet symbols are `USDC`, `USDT`, `USDG`, and `PYUSD`. USDC and USDT use SPL Token; USDG and PYUSD use Token-2022. Amounts are integer base units. The faucet reads mint decimals and permits at most 10,000 whole tokens per call. An omitted amount requests one whole token.

## Use the existing examples

Read the identities from the setup result:

~~~bash
export PRINCIPAL="$(node -p "JSON.parse(require('node:fs').readFileSync('.devnet/tester/setup.json','utf8')).principal")"
export PATHWAY_ID="$(node -p "JSON.parse(require('node:fs').readFileSync('.devnet/tester/setup.json','utf8')).pathwayId")"
export ASSET_MINT="$(node -p "JSON.parse(require('node:fs').readFileSync('.devnet/tester/setup.json','utf8')).assetMint")"
export KEYPAIR_PATHS=.devnet/tester/keypair.json
export MODE=direct

yarn example:read-only:typescript
ACTION=mint AMOUNT=1000000 yarn example:settlement:typescript
ACTION=mint AMOUNT=1000000 SUBMIT=true yarn example:settlement:typescript
~~~

The first settlement command inspects and simulates. `SUBMIT=true` enables submission through the same example. The existing Python example consumes the same target and operation environment:

~~~bash
ACTION=redeem AMOUNT=1000000 yarn example:settlement:python
ACTION=redeem AMOUNT=1000000 SUBMIT=true yarn example:settlement:python
~~~

Choose the redeem input from the issued tokens actually received. Current rates, Chancery fees, and Token-2022 transfer fees determine receipt amounts. `MINIMUM_OUTPUT` supplies the existing caller-side output floor.

The existing `integration/RunDirectSettlement.mjs` conformance runner inherits `CHANCERY_TARGET`. Populate `integration/live-direct-settlement.example.json` with the devnet RPC, principal, pathway, signer path, and four operation amounts, then run `yarn integration:direct` with the resulting configuration file.

## Export documents for the market-maker examples

~~~bash
yarn devnet:operation --keypair .devnet/tester/keypair.json --symbol USDC --pathway-id "$PATHWAY_ID" --action mint --amount 1000000 --output .devnet/tester/mint.operation.json
node --experimental-strip-types integration/typescript/examples/prepare_mint_inventory.ts .devnet/tester/mint.operation.json
PYTHONPATH=integration/python python -m examples.prepare_mint_inventory .devnet/tester/mint.operation.json
cargo run --manifest-path integration/rust/Cargo.toml --example prepare_mint_inventory -- .devnet/tester/mint.operation.json
~~~

The export uses the reference client's inspection and account resolver, including selected-target singleton PDAs and explicit nulls for absent optional policies. It produces the existing [operation-document format](OPERATION-DOCUMENT.md). Preparation examples retain their existing arguments and host execution interfaces.

After obtaining issued tokens, export with `--action redeem` and use the corresponding `prepare_redeem_inventory` examples. Export requires a ready inspection and performs no settlement. `--output` creates a new file exclusively; omit it to emit the document to standard output. Fixture documents remain synthetic encoding inputs; live operation documents use resolved devnet accounts.

## Faucet and role grants

~~~bash
yarn devnet:faucet --keypair .devnet/tester/keypair.json --symbol USDC --amount 1000000
~~~

Add `--subject` with another wallet's address to create and fund that wallet's collateral associated token account. The caller pays transaction fees and account rent.

Grant another principal access to the existing route:

~~~bash
export OTHER_PRINCIPAL='<recipient public key>'
yarn devnet:grant --keypair .devnet/tester/keypair.json --symbol USDC --pathway-id "$PATHWAY_ID" --subject "$OTHER_PRINCIPAL" --roles CAN_MINT_DIRECT,CAN_REDEEM_DIRECT
~~~

Roles use declared `CAN_` constants. The default scope is the selected pathway. `--scope-kind` and `--scope-key` select another declared scope; global scope uses the zero address. New permissions may specify `--expiry` as Unix seconds. Role additions preserve existing roles and expiry. Dangerous roles require a finite expiry and a scoped permission.

The grant command runs proposal, on-chain-clock scheduling, acceptance, and application through the public controller, then reads back roles and generation. Devnet uses a one-second timelock followed by transaction confirmation. Incompatible existing permissions end the command.

The recipient signs settlements with its own wallet and needs its issued-token associated token account. Running `devnet:setup` with that wallet and the explicit existing `--pathway-id` prepares the same route for the recipient.

## Explicit public administration

~~~bash
yarn devnet:addresses --keypair .devnet/tester/keypair.json
yarn devnet:admin --keypair .devnet/tester/keypair.json --instruction set_pathway_pause --arguments .devnet/tester/pause.arguments.json --accounts .devnet/tester/pause.accounts.json
~~~

For the pause example, the arguments document contains `pathway_id`, `is_paused`, and `reason_code`. Encode `pathway_id` as `0x` followed by the hexadecimal pathway ID from setup, use `true` to pause, and supply an unsigned 32-bit reason code. The accounts document supplies `authority` as the emergency controller authority reported by `devnet:addresses` (role 2). Supply `pathway_policy` from setup; the instruction builder supplies singleton defaults. Clearing uses `is_paused: false` and the governance controller authority (role 0).

Administration accepts the existing schema's exact instruction name, argument fields, and account names. Encode byte-array arguments, including hashes and identifiers, as `0x`-prefixed hexadecimal. It encodes through this repository's reference builder and forwards controller signatures through the devnet faucet/controller. The caller is the only additional supported signer. Explicit pathway, limit, permission, policy, and pause instructions use their declared account bundles.

For `propose_config_change`, `--schedule` sets executable and expiry timestamps from the on-chain clock with a one-second delay and a one-hour lifetime. Supply the change kind, risk, target, canonical old/new value hashes, nonce, and pending account. Acceptance and the applying instruction remain separate administration calls. `devnet:grant` automates this sequence for additive role grants.

## Shared state and production handoff

Public testers share administration. They may change permissions, limits, policies, pathways, rates, and pause state and affect one another's tests. Deterministic default pathways give principals convenient routes while preserving shared public administration.

Inspect current state and simulate before each settlement. Setup prepares the direct testing profile; broader policy experiments use explicit administration and the full reference client's account resolver.

For production, start a new process with `CHANCERY_TARGET=mainnet`, select the production RPC, and supply approved production principals, mints, pathways, permissions, and account bundles. Production source and compatibility artifacts retain their existing release binding.
