# HotBridge

A fast and cheap bridge protocol over **HOT Protocol** that uses the **NEAR Intents** engine for exchange.<br/>
**Available for EVM (10+ chains), NEAR, Solana, TON, Stellar**

<br />

### Example CLI

`yarn cli deposit --token usdc --chain near --amount 100000 --private-key <..> --near-account-id root.near`

`yarn cli deposit --token usdc --chain bnb --amount 100000 --private-key <..>`

`yarn cli withdraw --token usdc --chain base --amount 100000 --private-key <..>`

<br />

## Setup HotBridge

```ts
const omni = new OmniBridge({
  logger: console, // optional
  tonApiKey: env.TON_API_KEY, // only if use TON
  customEvmRpc: { 56: "rpc" }, // by default we use own back rpc
  // Relayer for execute intents and omni bridge operations
  executeNearTransaction: async ({ receiverId, actions }) => {
    const hash = await relayer.signAndSendTransaction({ receiverId, actions }).
    return { sender: relayer.accountId, hash };
  },
});

```

### Deposit to HotBridge

```ts
const signer = {
  getIntentAccount: async () => "account", // intent account to deposit
  sendTransaction: async (tx) => "hash", // execute by payer
  getAddress: async () => "address", // payer account
};

await omni.near.depositToken({ token, amount, ...signer });

const deposits = [
  await omni.ton.depositToken({ token, amount, ...signer }),
  await omni.solana.depositToken({ token, amount, ...signer }),
  await omni.stellar.depositToken({ token, amount, ...signer }),
  await omni.evm.depositToken({ chain, token, amount, ...signer }),
];

// Processed by near relayer without signers
for (const deposit of deposits) {
  await omni.near.finishDeposit(deposit);
}
```

### Withdraw from HotBridge

```ts
const signer = {
  getIntentAccount: async () => "account", // intent account with omni balance
  signIntent: async () => signedIntent, // sign by intent account with omni balance
  sendTransaction: async () => "hash", // any tx executor for claim tokens for receiver
  getAddress: async () => "address", // any tx executor address
};

// Only intent signer need for withdraw
const withdraw = await omni.withdrawToken({
  chain, // chain to withdraw
  receiver: "0x...", // any onchain receiver
  token, // onchain address of token to withdraw
  amount: 10n,
  ...signer,
});

// Empty for withdraw to NEAR
if (withdraw == null) return;

// For claim onchain need any chain tx executor
switch (withdraw.chain) {
  case Network.Solana:
    await omni.solana.withdraw({ ...withdraw, ...signer });

  case Network.Ton:
    await omni.ton.withdraw({ ...withdraw, ...signer });

  case Netwok.Stellar:
    await omni.stellar.withdraw({ ...withdraw, ...signer });

  default:
    await omni.evm.withdraw({ ...withdraw, ...signer });
}
```

## Finish pending withdraw

```ts
// Get all uncompleted withdrawals for this bnb address
const pendings = await omni.getPendingWithdrawals(56, "0xAddress");

// Finish all
for (const pending of pendings) {
  const withdraw = await omni.buildWithdraw(pending.nonce); // get signature
  await omni.evm.withdraw({ ...withdraw, ...signer }); // push tx
}
```
