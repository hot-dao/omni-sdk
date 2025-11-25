import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, kava, xLayer } from "viem/chains";
import {
  CosmosWallet,
  EvmWallet,
  HotConnector,
  NearWallet,
  OmniWallet,
  StellarWallet,
  TonWallet,
  WalletType,
} from "@hot-labs/wibe3";
import { HotBridge } from "../../../src";
import { useEffect, useState } from "react";

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

export const wibe3 = new HotConnector({});

export const useBridge = () => {
  const [wallets, setWallets] = useState<OmniWallet[]>(wibe3.wallets);
  useEffect(() => {
    wibe3.onConnect(() => setWallets(wibe3.wallets));
    wibe3.onDisconnect(() => setWallets(wibe3.wallets));
  }, []);

  const near = wallets.find((w) => w.type === 1010) as NearWallet | null;
  const evm = wallets.find((w) => w.type === 1) as EvmWallet | null;
  const ton = wallets.find((w) => w.type === 1111) as TonWallet | null;
  const stellar = wallets.find((w) => w.type === 1100) as StellarWallet | null;
  const cosmos = wallets.find((w) => w.type === WalletType.COSMOS) as CosmosWallet | null;
  return { bridge, wibe3, near, evm, ton, stellar, cosmos };
};
