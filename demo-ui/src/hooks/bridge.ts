import { useEffect } from "react";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, kava } from "viem/chains";
import { HotBridge } from "@hot-labs/omni-sdk";
import { useNearWallet } from "./near";

export const bridge = new HotBridge({
  logger: console,
  api: "https://dev.herewallet.app",
  tonRpc: "",
  evmRpc: {
    8453: base.rpcUrls.default.http as any,
    42161: arbitrum.rpcUrls.default.http as any,
    10: optimism.rpcUrls.default.http as any,
    137: polygon.rpcUrls.default.http as any,
    56: bsc.rpcUrls.default.http as any,
    43114: avalanche.rpcUrls.default.http as any,
    1: mainnet.rpcUrls.default.http as any,
    2222: kava.rpcUrls.default.http as any,
  },

  executeNearTransaction: async () => {
    throw "executor not implemented";
  },
});

export const useBridge = () => {
  const nearWallet = useNearWallet();

  useEffect(() => {
    bridge.executeNearTransaction = async (tx) => {
      const hash = await nearWallet.sendTransaction(tx);
      return { sender: nearWallet.accountId!, hash };
    };
  }, [nearWallet.accountId]);

  return { bridge };
};
