# Chancery integration correctness contract

The TypeScript and Python consumers expose the same Chancery wire schema, account discovery rules, PDA derivations, policy calculations, transaction construction, and evidence decoding behavior.

## `ready`

`SettlementInspection.ready` is true only when account resolution and deterministic local settlement checks produce no blocking issue. The checks include:

- settlement module activation;
- global, asset, and pathway pause state;
- pathway activation and action support;
- asset mode for mint or redeem;
- asset extension observation chronology, freshness, approval, and forbidden masks;
- issued-token deployment readiness, extension observation chronology, freshness, and pathway masks;
- pathway evidence-policy binding and settlement-event support;
- authority, signer, permission, delegation, and settlement-policy requirements;
- fee-policy activation and effective fee calculation;
- source, destination, reserve, and fee-recipient token-account bindings;
- source balance and redeem reserve outflow;
- pathway, asset, counterparty, and executor limits;
- direct, delegated, and trilateral instruction-account completeness.

A ready inspection remains an off-chain observation. Transaction simulation is required immediately before submission.

## Observation context

Inspection establishes a minimum RPC context slot, then reads the Clock sysvar and raises the minimum context slot to the Clock slot for dependent account reads. The result records:

- minimum context slot;
- Clock Unix timestamp;
- Clock epoch;
- commitment;
- expiry slot;
- timestamp source.

Policy activation, policy expiry, permissions, settlement intents, usage-window rollover, and extension freshness use the Clock timestamp and slot. Transaction preparation rejects an inspection after its expiry slot.

RPC nodes do not provide an atomic multi-account historical snapshot for this workflow. `minContextSlot` prevents reads older than the recorded observation floor; simulation provides the execution-time state check.

## Fee routing and reserve outflow

An external fee-recipient account is required only when the net Chancery fee is greater than zero and the fee-recipient policy routes that fee outside the reserve.

For redeem, the required reserve balance is:

```text
principal pre-transfer output
+ externally routed net fee
```

A fee retained by the reserve is not counted as reserve outflow.

## Limits

Mint usage reads `UsageWindow.gross_in`. Redeem usage reads `UsageWindow.gross_output_amount`. Stale fixed-period windows roll to zero, future-dated windows fail closed, and the quote reports remaining capacity before and after the proposed operation.

Chancery settlement-volume dimensions are pathway, asset, counterparty, and executor. Global containment is represented by global pause state rather than a separate settlement-volume accumulator.

## Transfer-aware effective amounts

The consumers decode Token-2022 transfer-fee configuration, select the active epoch schedule, and calculate the transfer fee with ceiling division and the configured cap. Quotes distinguish requested input, reserve-received input, Chancery gross output, Chancery fee, principal pre-transfer output, principal-received output, routed-fee receipt, all-in output reduction, all-in basis points, and effective output rate.

## Build binding

`BUILD-COMPATIBILITY.json` binds the distributed clients to:

- the Chancery program ID;
- the complete checked-in wire schema hash;
- instruction, account, event, type, constant, error, wire, and PDA surface hashes;
- an aggregate hash of the Chancery Rust source tree used to derive the reference surface.

`compatibility/VerifyBuildCompatibility.mjs` and `compatibility/verify_build_compatibility.py` verify the distributed schemas and may verify a supplied Chancery source tree. `compatibility/VerifyProgramData.mjs` retrieves an upgradeable Chancery deployment and reports or enforces the deployed ProgramData binary hash.

## Deployment conformance

`integration/RunDirectSettlement.mjs` executes direct mint and redeem through both implementations. Each confirmed transaction is decoded by the other implementation and must contain canonical Chancery self-CPI evidence. The runner requires an initialized deployment and authorized signer configuration; signer material is not included in the repository.
