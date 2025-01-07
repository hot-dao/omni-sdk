# HOT Omni

`npm i @hot-wallet/omni`

## Usage

```ts
import "dotenv/config";
import { EvmSigner, Network, TokenId } from "@hot-wallet/omni";
import { TonSigner, NearSigner, OmniService, SolanaSigner } from "@hot-wallet/omni";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});

const bridgeUsdtFromNearToBnb = async () => {
  const USDT = omni.token(TokenId.USDT);
  await USDT.balance(Network.Near); // Near USDT balance
  await USDT.balance(Network.Bnb); // Bnb USDT balance

  const input = await USDT.input(Network.Near, 1); // <-- construct input amount
  await omni.depositToken(input); // USDT from TON to OMNI
  await USDT.balance(Network.Near); // NEAR USDT balance -1
  await USDT.balance(Network.Hot); // OMNI USDT balance +1

  const output = await USDT.output(Network.Bnb, 1); // <-- construct output amount
  await omni.withdrawToken(output); // USDT from OMNI to Base
  await USDT.balance(Network.Hot); // HOT USDT balance -1
  await USDT.balance(Network.Bnb); // Bnb USDT balance +1
};

bridgeUsdtFromNearToBnb();
```

## Omni Tokens

```ts
const token = await omni.findToken(Network.Bnb, "0xff..."); // Find some token
await token.liquidity(Network.Bnb);

const usdc = omni.token(Network.USDC); // Whitelisted token
await usdc.liquidity(Network.Ton); // check available liquidity for chain (need for withdraw)
```

## Pendings

```ts
const withdrawals = await omni.getActiveWithdrawals();
withdrawals.forEach((pending) => omni.finishWithdraw(pending));

const deposits = await omni.getActiveDeposits();
deposits.forEach((pending) => omni.finishDeposits(pending));
```
