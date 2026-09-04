# Direct-settlement operation document

The TypeScript, Python, and Rust examples accept the same strict JSON document. The document combines a current approved account bundle with the values for one mint or redeem operation.

The selected loader determines the operation type:

- use the mint loader and mint builder for a mint document;
- use the redeem loader and redeem builder for a redeem document.

Unknown fields are rejected. Every required field must be present. Public keys are base58 Solana addresses. Amounts are unsigned decimal strings. pathwayId is exactly 32 bytes represented by 64 hexadecimal characters; an optional 0x prefix is accepted.

## Root fields

| Field | Type | Meaning |
|---|---|---|
| pathwayId | string | Approved direct-pathway identifier. |
| amount | decimal string | Raw operation input. Must be greater than zero. |
| minimumOutput | decimal string | Minimum raw output accepted by the principal. May be zero. |
| accounts | object | Exact fixed account bundle for the selected operation. |

## Common required accounts

Both operations require:

- moduleActivationState
- chanceryConfig
- eventAuthority
- pauseState
- assetConfig
- pathwayPolicy
- permissionRecord
- reserveAssetTokenAccount
- assetMint
- issuedTokenMint
- assetTokenProgram
- issuedTokenProgram
- principal
- assetPauseState
- issuedTokenControl
- policyAccounts

The builder rejects the default public key in every required position.

## Mint-only accounts

A mint document additionally uses:

- sourceAssetTokenAccount
- destinationIssuedTokenAccount
- mintAuthorityPda

For mint, amount is the raw reserve-asset input and minimumOutput is the minimum raw issued-token receipt.

## Redeem-only accounts

A redeem document additionally uses:

- sourceIssuedTokenAccount
- destinationAssetTokenAccount
- reserveAuthorityPda

For redeem, amount is the raw issued-token input and minimumOutput is the minimum raw reserve-asset receipt.

## Policy accounts

policyAccounts must contain all 12 keys below. Each value is either a base58 public key or null:

~~~json
{
  "feePolicy": null,
  "feeRecipientTokenAccount": null,
  "limitPolicy": null,
  "hourlyUsageWindow": null,
  "dailyUsageWindow": null,
  "weeklyUsageWindow": null,
  "monthlyUsageWindow": null,
  "evidencePolicy": null,
  "assetLimitPolicy": null,
  "assetDailyUsageWindow": null,
  "counterpartyLimitPolicy": null,
  "counterpartyDailyUsageWindow": null
}
~~~

null identifies an absent optional account for the approved pathway. The builder encodes the default Solana public key in that fixed position and preserves every later account index.

Use null exclusively for an optional position confirmed as absent. Resolve every unknown required or applicable optional account before submission.

## Fixtures

The files in fixtures are deterministic wire fixtures. Their addresses and pathway identifier are synthetic. Replace those values with the approved deployment account bundle.

A production system should populate the document from an approved, current account-bundle source and then set amount, minimumOutput, and the principal's operation-specific token accounts for the business request.
