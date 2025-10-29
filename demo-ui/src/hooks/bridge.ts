import { useEffect } from "react";
import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, kava, xLayer } from "viem/chains";
import { HotBridge } from "../../../src";
import { useNearWallet } from "./near";

export const bridge = new HotBridge({
  logger: console,
  api: ["https://api0.herewallet.app", "https://api2.herewallet.app"],
  solanaRpc: ["https://api0.herewallet.app/api/v1/evm/rpc/1001"],

  evmRpc: {
    8453: base.rpcUrls.default.http as any,
    42161: arbitrum.rpcUrls.default.http as any,
    10: optimism.rpcUrls.default.http as any,
    137: polygon.rpcUrls.default.http as any,
    56: bsc.rpcUrls.default.http as any,
    43114: avalanche.rpcUrls.default.http as any,
    1: mainnet.rpcUrls.default.http as any,
    2222: kava.rpcUrls.default.http as any,
    10143: ["https://testnet-rpc.monad.xyz"],
    1313161554: ["https://mainnet.aurora.dev", "https://1rpc.io/aurora", "https://aurora.drpc.org"],
    196: xLayer.rpcUrls.default.http as any,
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
