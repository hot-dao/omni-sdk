import { Network, WithdrawArgsWithPending } from "../../src";
import { bridge } from "./hooks/bridge";

const execute = async (pending: WithdrawArgsWithPending): Promise<string | null> => {
  try {
    // If the pending withdrawal is less than 5 minutes old, do not try to withdraw again
    if (Date.now() / 1000 - pending.timestamp < 5 * 60) return null;

    // Trying to withdraw TON
    if (pending.chain === Network.Ton || pending.chain === Network.OmniTon) {
      return await bridge.ton.withdraw({
        sendTransaction: async (tx) => "hash",
        refundAddress: "address",
        ...pending,
      });
    }

    // Trying to withdraw Stellar
    if (pending.chain === Network.Stellar) {
      return await bridge.stellar.withdraw({ sender: "address", sendTransaction: async (tx) => "hash", ...pending });
    }

    // Trying to withdraw Solana
    if (pending.chain === Network.Solana) {
      const solana = await bridge.solana();
      return await solana.withdraw({ sender: "address", sendTransaction: async (tx) => "hash", ...pending });
    }

    return await bridge.evm.withdraw({ sendTransaction: async (tx) => "hash", ...pending });
  } catch (error) {
    console.error(error);
    return null;
  }
};

const test = async (signal: AbortSignal) => {
  await bridge.iterateWithdrawals({ signal, execute });
};

const abortController = new AbortController();
test(abortController.signal);
