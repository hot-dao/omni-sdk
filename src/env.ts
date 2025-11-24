import { Network } from "./types";

export const OMNI_HOT_V2 = "v2_1.omni.hot.tg";
export const INTENT_PREFIX = "nep245:v2_1.omni.hot.tg:";
export const INTENTS_CONTRACT = "intents.near";

export interface CosmosConfig {
  contract: string;
  rpc: string;
  chainId: string;
  prefix: string;
  nativeToken: string;
  gasLimit: bigint;
}

export const Settings = {
  cosmos: {
    [Network.Juno]: {
      contract: "juno15ju9ckc80dlg55zq4rdh3humcej0p65klmr0lnd245cyhzmuv8ts2c6pd4",
      rpc: "https://juno-rpc.publicnode.com",
      gasLimit: 200000n,
      nativeToken: "ujuno",
      chainId: "juno-1",
      prefix: "juno",
    },
  } as Record<number, CosmosConfig>,
};
