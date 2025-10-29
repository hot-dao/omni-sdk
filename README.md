# HotBridge

A fast and cheap bridge protocol over **HOT Protocol** that uses the **NEAR Intents** engine for exchange.<br/>
**Available for EVM (10+ chains), NEAR, Solana, TON, Stellar**

`yarn add @hot-labs/omni-sdk`

<br />

## Demo UI

Deploy: [https://hot-dao.github.io/omni-sdk](https://hot-dao.github.io/omni-sdk/)

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

## Processing pending withdrawals on the fly

`parsePendingsWithdrawals` returns all pending withdrawals found using the NEAR indexer and does the following:

Sorts from smallest nonce to largest nonce
Works in parallel for each chain, but sequentially for each pending in chain

Sequentially calls `needToExecute` for every pending in chain if nonce is not completed yet. needToExecute is async callback, every next call wait when this promises has been resolved

Important! Each call to parsePendingsWithdrawals will return pending outputs that you've likely already started processing. You should also keep track of the tasks you've already started processing within your script.
It's best to check task uniqueness using `near_trx`

```ts
const script = async (signal: AbortSignal) => {
  await bridge.parsePendingsWithdrawals({
    signal,

    parseFailed: async (error, pending) => {
      // Failed to parse pending withdrawal
      // Do something to parse it manually if you need or just wait for our parser solution
    },

    unknown: async (pending) => {
      // If the pending withdrawal does not have withdraw data, only hash and near TX
      // Do something to parse it manually if you need or just wait for our parser solution
    },

    completedWithHash: async (pending) => {
      // Withdraw completed and we have withdraw hash
      // Nothing to do here, just for analytics
    },

    completedWithoutHash: async (pending) => {
      // Withdraw completed but we can't get withdraw hash on target chain
      // Do something to get withdraw hash if you need or just wait for our parser solution
    },

    needToExecute: async (pending) => {
      // If the pending withdrawal is less than 5 minutes old, do not try to withdraw again
      if (Date.now() / 1000 - pending.timestamp < 5 * 60) return;

      // Trying to withdraw TON
      if (pending.chain === Network.Ton || pending.chain === Network.OmniTon) {
        await bridge.ton.withdraw({ sendTransaction: async (tx) => "hash", refundAddress: "address", ...pending });
      }

      // Trying to withdraw Stellar
      if (pending.chain === Network.Stellar) {
        await bridge.stellar.withdraw({ sender: "address", sendTransaction: async (tx) => "hash", ...pending });
      }

      // Trying to withdraw Solana
      if (pending.chain === Network.Solana) {
        const solana = await bridge.solana();
        await solana.withdraw({ sender: "address", sendTransaction: async (tx) => "hash", ...pending });
      }

      await bridge.evm.withdraw({ sendTransaction: async (tx) => "hash", ...pending });
    },
  });

  // Run in loop!
  if (signal.aborted) return;
  await script(signal);
};

const abortController = new AbortController();
script(abortController.signal);
```
