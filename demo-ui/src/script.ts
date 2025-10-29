import { Network } from "../../src";
import { bridge } from "./hooks/bridge";

const test = async (signal: AbortSignal) => {
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
  await test(signal);
};

const abortController = new AbortController();
test(abortController.signal);
