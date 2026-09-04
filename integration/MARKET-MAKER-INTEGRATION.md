# Market-maker direct-settlement integration

## Boundary

This boundary serves an entity with an approved principal identity, permission record, direct pathway, reserve asset, and issued-token relationship. The entity submits mint and redeem operations using the current account bundle for that relationship.

A deployment operator or independently controlled resolver supplies the exact current account bundle for the approved pathway. The adapter uses that supplied pathway and account ordering for instruction construction.

## System placement

A typical integration is:

~~~text
inventory and risk system
        |
        | amount, minimum output, approved account bundle
        v
Chancery market-maker adapter
        |
        | one fixed mint_direct or redeem_direct instruction
        v
host transaction system
        |
        | prepare and sign once
        | simulate the prepared transaction
        | submit the same prepared transaction
        v
Solana and Chancery
        |
        | confirmed transaction, balances, settlement evidence
        v
ledger and reconciliation
~~~

The adapter is the protocol-specific instruction boundary connecting inventory, quoting, custody, RPC, transaction, and ledger systems to Chancery.

## Onboarding inputs

Before settlement is enabled, the integrating entity needs the current operational account bundle for each approved principal, pathway, and asset relationship. The bundle includes:

- the 32-byte pathway identifier;
- the principal public key bound to the permission record;
- the reserve-asset mint and issued-token mint;
- the asset and issued-token program addresses;
- the Chancery state and authority accounts required by the instruction;
- the pathway policy and permission record;
- the reserve token account;
- the applicable fee, limit, evidence, and usage-window accounts;
- the principal's source and destination token accounts; and
- explicit null values for absent optional policy positions.

The operation document carries this bundle exactly as supplied. See OPERATION-DOCUMENT.md.

## Mint inventory flow

A direct mint converts reserve-asset inventory into issued-token inventory.

The caller supplies:

- amount: raw reserve-asset units debited from the principal's source account;
- minimumOutput: minimum raw issued-token units accepted by the principal;
- sourceAssetTokenAccount; and
- destinationIssuedTokenAccount.

The program transfers the approved reserve asset to the configured reserve token account and mints the resulting issued tokens to the principal's destination account, subject to current permissions, pause state, rates, fees, limits, token controls, and account relationships.

## Redeem inventory flow

A direct redeem converts issued-token inventory into reserve-asset inventory.

The caller supplies:

- amount: raw issued-token units burned from the principal's source account;
- minimumOutput: minimum raw reserve-asset units accepted by the principal;
- sourceIssuedTokenAccount; and
- destinationAssetTokenAccount.

The program burns the issued-token input and transfers the resulting reserve asset from the configured reserve token account to the principal's destination account, subject to the same on-chain controls.

## Amount handling

All amounts are unsigned 64-bit integers in token base units. Decimal display values must be converted with the actual mint decimals before instruction construction. JavaScript and JSON integrations use decimal strings so the complete unsigned 64-bit range is preserved.

minimumOutput is the caller's final on-chain floor. Derive it immediately before transaction preparation from the entity's quote, inventory, transfer-fee, and slippage policy. A value of zero disables that caller-side floor and requires an explicit business decision.

## Host execution contract

The market-maker execution interfaces separate protocol construction from infrastructure. A host implementation must:

1. compile and sign one prepared transaction containing the emitted instruction;
2. return that prepared transaction to the integration helper;
3. simulate that exact prepared transaction;
4. submit the same prepared transaction only after simulation acceptance;
5. confirm the returned signature and inspect execution metadata; and
6. reconcile confirmed account and evidence changes.

If the recent blockhash, fee payer, instruction list, account list, signatures, compute budget, or priority-fee instructions change after simulation, the host must prepare and simulate a new transaction. Treat simulation as a point-in-time execution check.

## Account-bundle freshness

A syntactically valid bundle can still be stale. Pathway status, pause state, policy accounts, usage windows, reserve accounts, token accounts, or permissions can change between settlements.

Treat an account mismatch, missing account, pause result, permission result, limit result, minimum-output result, stale blockhash, or simulation failure as a failed attempt. Obtain current authorized inputs, preserve the canonical account positions, prepare a new transaction, and simulate it again.

Keep every optional account position in the account list. Encode an absent optional account with the default Solana public key. A present optional account must be the exact account expected by the selected pathway and current policy state.

## Integration ownership

The external entity owns:

- request authentication and authorization;
- inventory and exposure limits;
- quote validity and minimum-output calculation;
- key custody and signing policy;
- transaction transport and confirmation policy;
- duplicate and unknown-outcome handling;
- accounting and reconciliation; and
- monitoring, alerting, and incident controls.

Chancery evaluates execution eligibility from the current permission, policy, rate, fee, limit, pause, balance, ownership, mint, and token-extension state during simulation and execution.
