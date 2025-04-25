import { HotBridge } from "../../../src";
import { NearWallet } from "./near";

export const omni = new HotBridge({
  evmRpc: {
    8453: "https://base.llamarpc.com",
  },

  solanaRpc: ["https://api0.herewallet.app/api/v1/solana/rpc"],

  executeNearTransaction: async (tx) => {
    const wallet = await NearWallet.restore();
    if (!wallet) throw new Error("Wallet not found");
    const result = await wallet.sendTransaction(tx);
    return { sender: await wallet.getAccountId(), hash: result!.transaction.hash };
  },
});
