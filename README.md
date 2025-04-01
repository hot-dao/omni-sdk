# HOT Omni

## Usage

```ts
import "dotenv/config";
import { EvmSigner, Network, TokenId } from "@hot-wallet/omni";
import { TonSigner, NearSigner, StellarSigner, OmniService, SolanaSigner } from "@hot-wallet/omni";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  stellar: new StellarSigner(env.STELLAR_PRIVATE_KEY, env.HORIZON_RPC, env.SOROBAN_RPC),

  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});
```

## Example enviroment

```bash
git clone https://github.com/hot-dao/omni-sdk
cd omni-sdk

yarn # install deps
cp .env.example .env # then fill it
yarn example # WARNING: IT WILL BRIDGE 1 USDT FROM NEAR TO BNB !!!
```
