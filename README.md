# HOT Omni

A fast and cheap bridge protocol over **HOT Protocol** that uses the **NEAR Intents** engine for exchange.<br/>
**Available for EVM (10+ chains), NEAR, Solana, TON, Stellar**

<br />

## Usage from CLI

### Installation

```bash
git clone git@github.com:hot-dao/omni-sdk.git
cd omni-sdk
yarn install
cp .env.example .env
```

Provide your private keys in base58 format for the required networks in `.env` file. You only need to provide `NEAR_ACCONT_ID` and `NEAR_PRIVATE_KEY`. The other networks can be left blank if you do not plan to deposit/withdraw to these networks.

### Commands

**Get HOT Intent balance**

`yarn cli balance --token usdc --chain near`

**Make swap HOT Intent token to another HOT Intent token**

`yarn cli swap --token usdc --from near --to arb --amount 0.01`

**Make withdraw HOT Intent token to chain**

`yarn cli withdraw --token usdc --chain base --amount 0.001`

**Make deposit token from chain to HOT Intent**

`yarn cli deposit --token usdc --chain base --amount 0.001`

<br />
## Usage from code

`yarn add @hot-wallet/omni-sdk`

```ts
import "dotenv/config";
import { EvmSigner, Network as chain, OmniToken, OmniGroup } from "@hot-wallet/omni-sdk";
import { TonSigner, NearSigner, StellarSigner, OmniService, SolanaSigner } from "@hot-wallet/omni-sdk";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  stellar: new StellarSigner(env.STELLAR_PRIVATE_KEY, env.HORIZON_RPC, env.SOROBAN_RPC),
  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});

// Simple bridge
const ton = new OmniToken(OmniGroup.TON); // builder
await omni.depositToken(...ton.input(chain.Ton, 1));

console.log("Omni TON", await omni.getBalance(ton.intent(chain.Ton)));
await omni.withdrawToken(...ton.input(chain.Bnb, 1));

// Intent swap
const usdc = new OmniToken(OmniGroup.USDC);
await omni.depositToken(...usdc.input(chain.Base, 1));
await omni.swapToken(usdc.intent(chain.Base), usdc.intent(chain.Arbitrum), 1);

console.log("Omni USDC on Arb", await omni.getBalance(usdc.intent(chain.Arbitrum)));
await omni.withdrawToken(...usdc.input(chain.Arbitrum, 1));
```
