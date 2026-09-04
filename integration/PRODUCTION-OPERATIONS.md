# Production settlement operations

## Request acceptance

Before instruction construction, bind the business request to one action, one principal, one approved pathway, one reserve asset, one issued token, one input amount, one minimum output, and one account-bundle version or retrieval result.

Reject:

- missing or ambiguous identities;
- non-integer base units;
- values outside the unsigned 64-bit range;
- zero input amounts;
- expired quotes;
- duplicate business requests; and
- account bundles not authorized for the requested principal, pathway, and direction.

The builders validate document shape, public-key syntax, required account presence, fixed account count, signer flags, writable flags, pathway identifier length, and payload bounds. Simulation and execution evaluate the current on-chain policy state.

## Transaction preparation

Preserve the emitted Chancery instruction exactly:

- fixed Chancery program address;
- all 31 accounts in order;
- signer and writable privileges; and
- all 50 instruction-data bytes.

The host may add its normal compute-budget and priority-fee instructions and may use a fee payer distinct from the principal. The principal remains a required signer for the Chancery instruction.

Prepare and sign one transaction. The execution interfaces pass the resulting prepared transaction object unchanged to both simulation and submission.

## Simulation

Simulate the exact prepared transaction intended for submission. Treat every simulation error as a rejected operation, including errors caused by permissions, pause state, pathway status, account relationships, token balances, token programs, token extensions, fees, limits, usage windows, reserve sufficiency, or minimum output.

Treat a successful simulation as a point-in-time execution result. Keep the interval to submission small. Any transaction change, blockhash replacement, signature change, or material delay requires a new preparation and simulation cycle.

## Submission

Submit only after simulation acceptance. Persist the business-request identifier and transaction signature as one atomic operational record where the host architecture permits it.

A successful send response establishes acceptance for processing. Establish execution and settlement through confirmation, transaction metadata, balances, and evidence.

## Confirmation

Confirmation must establish:

- the signature reached the host's required commitment;
- the confirmed transaction is the transaction associated with the business request; and
- transaction metadata reports successful execution.

Preserve the signature on every post-submission error. Classify an unresolved confirmation result as an unknown post-submission outcome.

## Reconciliation

Reconcile from confirmed chain data, not requested values alone.

For mint, reconcile at least:

- the principal's reserve-asset source account;
- the configured reserve token account;
- the principal's issued-token destination account;
- the issued-token mint supply change where required by the host ledger; and
- Chancery settlement evidence associated with the confirmed transaction.

For redeem, reconcile at least:

- the principal's issued-token source account;
- the configured reserve token account;
- the principal's reserve-asset destination account;
- the issued-token mint supply change where required by the host ledger; and
- Chancery settlement evidence associated with the confirmed transaction.

Requested input, transferred input, gross output, Chancery fee, token transfer fee, routed fee, and net principal receipt may differ. Keep them as distinct ledger values.

## Failure classes

Use operational states that distinguish:

- rejected before transaction preparation;
- transaction preparation or signing failed;
- rejected by simulation;
- submission failed before any signature was returned;
- submitted with confirmation unresolved;
- confirmed with an execution error;
- confirmed successfully but unreconciled; and
- confirmed and reconciled.

Before resubmitting a business request, resolve the prior signature and reconcile chain state. Route every unresolved result to the host's unknown-outcome procedure so a second economic action requires an explicit decision.

## Account and quote refresh

Discard the prepared transaction and restart from current inputs when:

- the blockhash expires;
- the quote or minimum-output calculation expires;
- the account bundle changes;
- simulation reports a state-dependent rejection;
- a token account or balance changes materially; or
- the host changes any transaction instruction or signer.

Use the refreshed account bundle for the next direct mint or redeem preparation.

## Key custody

The host supplies the principal signature through its existing custody boundary, hardware security module, remote signer, policy engine, or transaction service. Keep protocol instruction construction separate from key custody.
