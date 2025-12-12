# 2.24.4

- Fix isWithdrawUsed on Cosmos

# 2.24.3

- Added tsc-alias with resolveFullPaths: true to add .js extensions to imports after build

# 2.24.1

- type: module

# 2.24.0

- Add tests for getGaslessWithdrawFee
- Rewrite getGaslessWithdrawFee without api request
- Add defaultEvmWithdrawFee and withdrawFees in settings

# 2.23.6

- Add Cosmos bridge support
- add publishIntents in settings
- add evmTreasuryDefaultContract in settings
- add evmTreasuryContracts in settings
- add ADI chain support (evm)

# 2.22.3

- Add TON EVAA token

# 2.22.2

- fix `iterateWithdrawals`
- return Solana `deposit` method

# 2.22.0

- add `iterateWithdrawals`

# 2.21.0

- Remove POA (integrate 1click soon)
- Add `parsePendingsWithdrawals`

# 2.20.18

- add fallback for incorrect api.executeDeposit responces

# 2.20.17

- Remove fallback for withdraw gas price on stellar

# 2.20.16

- add ApiError with details of request
- add fallback for api.depositSign without autopilot=true
- improve errors

# 2.20.15

- add Stellar withdraw gas price fallback (0.5 XLM)
- add fallback Origin header to api

# 2.20.14

- remove time limit for waitUntilBalance

# 2.20.13

- fix Bitcoin and Zcash types

# 2.20.11, 2.20.12

- Add Bitcoin and Zcash poa bridge

# 2.20.9, 2.20.10

- Improve TRON Gas estimation, add receiver for emulation and min reserve 10 trx

# 2.20.8

- Improve TRON Gas estimation, add additional reserve

# 2.20.7

- Fix parse deposit on Stellar
- Change NEAR defaults rpcs

# 2.20.6

- Update @stellar/stellar-sdk to 14.1.1

# 2.20.5

- Improve TRON Gas estimation

# 2.20.4

- Remove fixed gas limit for TRON transfer

# 2.20.3

- Fix parsing FT deposit logs for TON bridge again

# 2.20.2

- Fix parsing FT deposit logs for TON bridge
- Change utils.toOmni logic, return 1010:native for nep141:wrap.near

# 2.20.1

- Fix withdraw native NEAR

# 2.20.0-alpha.2

- Add TRON sendTransaction option

# 2.20.0-alpha.1

- Add Solana PoA deposit fee
- Add Eth PoA deposit fee
- Add Tron PoA

# 2.19.4

- Update @ton-api/ton-adapter to 0.4.1
