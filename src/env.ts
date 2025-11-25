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
      contract: "juno1va9q7gma6l62aqq988gghv4r7u4hnlgm85ssmsdf9ypw77qfwa0qaz7ea4",
      rpc: "https://juno-rpc.publicnode.com",
      gasLimit: 200000n,
      nativeToken: "ujuno",
      chainId: "juno-1",
      prefix: "juno",
    },
  } as Record<number, CosmosConfig>,
};
