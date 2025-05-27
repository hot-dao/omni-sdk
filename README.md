# HotBridge

A fast and cheap bridge protocol over **HOT Protocol** that uses the **NEAR Intents** engine for exchange.<br/>
**Available for EVM (10+ chains), NEAR, Solana, TON, Stellar**

`yarn add @hot-labs/omni-sdk`

<br />

## Demo UI

Deploy: https://hot-bridge-demo.surge.sh

**Covered cases:**

- Connect NEAR, EVM _(currently deposit only to Intent account binded to NEAR wallet)_
- Deposit token widget (from NEAR, EVM)
- Withdraw token widget (to NEAR, EVM)
- Find pending withdrawals and finish them
- View HOT Bridge tokens balances on Intents

## Setup HotBridge

```ts
const omni = new OmniBridge({
  logger: console, // optional

  tonApiKey: env.TON_API_KEY, // only if use TON
  evmRpc: { 56: ["rpc"] }, // only if use EVM
  solanaRpc: ["rpc"], // only if use SOLANA

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
  await omni.finishDeposit(deposit);
}
```

### Withdraw from HotBridge

```ts
const signer = {
  signIntent: async () => signedIntent, // sign by intent account with omni balance
  sendTransaction: async () => "hash", // any tx executor for claim tokens for receiver
  getAddress: async () => "address", // any tx executor address
};

// Create TON user jetton for withdrawals (created once for user)
if (chain === Network.Ton) {
  await omni.ton.createUserIfNeeded({
    sendTransaction: signer.sendTransaction,
    address: receiver,
  });
}

// Only intent signer need for withdraw
const withdraw = await omni.withdrawToken({
  intentAccount: "account",
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
const pendings = await omni.getPendingWithdrawalsWithStatus(56, "0xAddress");

// Clear completed withdrawals
const completed = pendings.filter((t) => t.completed);
if (completed.length) await omni.clearPendingWithdraw(completed);

// Finish all
const uncompleted = pendings.filter((t) => !t.completed);
for (const pending of uncompleted) {
  const withdraw = await omni.buildWithdraw(pending.nonce); // build with signature
  await omni.evm.withdraw({ ...withdraw, ...signer }); // push tx
}
```

## Finish pendings deposits (not implemented yet)

```ts
// Get all uncompleted withdrawals for this bnb address
const pendings = await omni.getPendingDeposits({
  intentAccount: "receiver_intent",
  solana: "sender_address", // optional
  ton: "sender_address", // optional
  stellar: "sender_address", // optional
  evm: "sender_address", // optional
});

// Finish all
for (const pending of pendings) {
  await omni.finishDeposit(pendings);
}
```
