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

  tonRpc: env.TON_API_KEY, // only if use TON
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
const intentAccount = "account";
const hash = await omni.ton.deposit({
  token: "native",
  amount: 100000000n,
  sendTransaction: async (tx) => "hash", // execute by payer
  sender: "address", // payer account
  intentAccount, // intent account to deposit
});

// usually from 30 seconds to 2 minutes, but can wait indefinitely
const abortController = new AbortController(); // optional argument
const pending = await omni.waitPendingDeposit(Network.Ton, hash, intentAccount, abortController.signal);
await omni.finishDeposit(pending);
```

### Withdraw from HotBridge

```ts
// Only intent signer need for withdraw
const { nonce } = await omni.withdrawToken({
  signIntents: async (intents) => signedIntent, // sign by intent account with omni balance
  intentAccount: "account",
  chain: Network.Base,
  receiver: "0x...", // any onchain receiver
  token, // onchain address of token to withdraw
  gasless: true,
  amount: 10n,
  ...signer,
});

// gasless withdraw
if (nonce == null) return;

const withdraw = await omni.getPendingWithdraw(nonce);
await omni.evm.withdraw({
  sendTransaction: async () => "hash", // any tx executor for claim tokens for receiver
  sender: "address", // any tx executor address
  ...withdraw,
});
```

## Finish pending withdraw

```ts
// Get all uncompleted withdrawals for this bnb address
const pendings = await omni.getPendingWithdrawalsWithStatus(56, "0xAddress");

// Clear completed withdrawals
const completed = pendings.filter((t) => t.completed);
if (completed.length) await omni.clearPendingWithdrawals(completed);

// Finish all
const uncompleted = pendings.filter((t) => !t.completed);
for (const pending of uncompleted) {
  await omni.evm.withdraw({ ...pending, ...signer }); // push tx
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
