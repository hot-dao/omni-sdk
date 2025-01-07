# HOT Omni

`npm i @hot/omni-sdk`

## Usage

```ts
import { Network, OmniService, NearSigner, SolanaSigner, EvmSigner, TonSigner } from "@hot/omni-sdk";

const omni = new OmniService({
  near: new NearSigner("seed"),
  solana: new SolanaSigner("seed"),
  evm: new EvmSigner("seed"),
  ton: new TonSigner("seed"),
});

const bridgeFromTonToBase = async () => {
  const usdc = omni.token(OmniToken.USDC);
  await usdc.balance(Network.Ton); // OMNI USDC balance
  await usdc.balance(Network.Base); // Base USDC balance

  await omni.depositToken(usdc, Network.Ton, 1); // USDC from TON to OMNI
  await usdc.balance(Network.Ton); // TON USDC balance -1
  await usdc.balance(Network.Hot); // OMNI USDC balance +1

  await omni.withdrawToken(usdc, Network.Base, 1); // USDC from OMNI to Base
  await usdc.balance(Network.Hot); // HOT USDC balance -1
  await usdc.balance(Network.Base); // Base USDC balance +1
};
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
