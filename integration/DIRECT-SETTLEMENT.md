# Direct settlement wire contract

## Program and discriminators

| Operation | Discriminator | Payload length |
|---|---:|---:|
| `mint_direct` | `04 01` | 50 bytes |
| `redeem_direct` | `04 02` | 50 bytes |

Program address: `ChnryP5RcZtMvP8vvVyPGUhwCg6uDJc53vCe3sxr11Sz`

## Payload layout

Both operations use the same byte layout:

| Offset | Length | Encoding | Meaning |
|---:|---:|---|---|
| 0 | 2 | raw bytes | operation discriminator |
| 2 | 32 | raw bytes | pathway identifier |
| 34 | 8 | little-endian `u64` | input amount |
| 42 | 8 | little-endian `u64` | minimum output |

For mint, the input is the raw reserve-asset amount and the minimum output is the raw issued-token amount.

For redeem, the input is the raw issued-token amount and the minimum output is the raw reserve-asset amount.

A minimum output of zero disables the caller's slippage floor. The builder preserves zero; production integrations should normally supply an explicit floor derived immediately before submission.

## Account order

The account list has exactly 31 positions. Mint and redeem differ only at positions 7, 9, and 12.

| Index | Mint name | Redeem name | Signer | Writable |
|---:|---|---|:---:|:---:|
| 0 | moduleActivationState | moduleActivationState | no | no |
| 1 | chanceryConfig | chanceryConfig | no | yes |
| 2 | eventAuthority | eventAuthority | no | no |
| 3 | pauseState | pauseState | no | no |
| 4 | assetConfig | assetConfig | no | no |
| 5 | pathwayPolicy | pathwayPolicy | no | no |
| 6 | permissionRecord | permissionRecord | no | no |
| 7 | sourceAssetTokenAccount | sourceIssuedTokenAccount | no | yes |
| 8 | reserveAssetTokenAccount | reserveAssetTokenAccount | no | yes |
| 9 | destinationIssuedTokenAccount | destinationAssetTokenAccount | no | yes |
| 10 | assetMint | assetMint | no | no |
| 11 | issuedTokenMint | issuedTokenMint | no | yes |
| 12 | mintAuthorityPda | reserveAuthorityPda | no | no |
| 13 | assetTokenProgram | assetTokenProgram | no | no |
| 14 | issuedTokenProgram | issuedTokenProgram | no | no |
| 15 | principal | principal | yes | no |
| 16 | assetPauseState | assetPauseState | no | no |
| 17 | issuedTokenControl | issuedTokenControl | no | no |
| 18 | feePolicy | feePolicy | no | no |
| 19 | feeRecipientTokenAccount | feeRecipientTokenAccount | no | yes |
| 20 | limitPolicy | limitPolicy | no | no |
| 21 | hourlyUsageWindow | hourlyUsageWindow | no | yes |
| 22 | dailyUsageWindow | dailyUsageWindow | no | yes |
| 23 | weeklyUsageWindow | weeklyUsageWindow | no | yes |
| 24 | monthlyUsageWindow | monthlyUsageWindow | no | yes |
| 25 | evidencePolicy | evidencePolicy | no | no |
| 26 | assetLimitPolicy | assetLimitPolicy | no | no |
| 27 | assetDailyUsageWindow | assetDailyUsageWindow | no | yes |
| 28 | counterpartyLimitPolicy | counterpartyLimitPolicy | no | no |
| 29 | counterpartyDailyUsageWindow | counterpartyDailyUsageWindow | no | yes |
| 30 | eventProgram | eventProgram | no | no |

`eventProgram` is always the Chancery program address and is appended by the builders.

## Optional accounts

Positions 18 through 29 are fixed positions even when a policy or usage window is absent. An absent optional account is encoded as the default Solana public key:

`11111111111111111111111111111111`

Keep all optional positions and preserve every later account index. A non-null optional address must be the exact account expected by the selected pathway and current policy state.

## Builder validation

The reference builders reject:

- malformed public keys;
- the default public key in required positions;
- pathway identifiers with lengths other than 32 bytes;
- zero input amounts;
- values outside the unsigned 64-bit range; and
- an operation document whose action-specific account set is incomplete.

Simulation and program execution evaluate the current on-chain policy state.
