import { CosmosConfig, HotBridge } from "@hot-labs/omni-sdk";
import { chains, HotConnector, WalletType } from "@hot-labs/kit";
import { defaultConnectors } from "@hot-labs/kit/defaults";
import cosmos from "@hot-labs/kit/cosmos";

export const wibe3 = new HotConnector({
  connectors: [...defaultConnectors, cosmos()],
  apiKey: "",
});

export const hotBridge = new HotBridge({
  evmRpc: chains.getByType(WalletType.EVM).reduce((acc, chain) => {
    acc[chain.id] = [chain.rpc];
    return acc;
  }, {} as Record<number, string[]>),

  cosmos: chains.getByType(WalletType.COSMOS).reduce((acc, chain) => {
    acc[chain.id] = {
      rpc: chain.rpc,
      contract: chain.bridgeContract!,
      prefix: chain.prefix!,
      gasLimit: chain.gasLimit!,
      chainId: chain.key,
      nativeToken: chain.currency.id!,
    };
    return acc as Record<number, CosmosConfig>;
  }, {} as Record<number, CosmosConfig>),
});

wibe3.hotBridge = hotBridge;
