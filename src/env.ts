import { Network } from "./types";

export interface CosmosConfig {
  contract: string;
  rpc: string;
  chainId: string;
  prefix: string;
  nativeToken: string;
  gasLimit: bigint;
}

let _intentsContract = "intents.near";
let _omniHotContract = "v2_1.omni.hot.tg";
let _hotIntentPrefix = "nep245:v2_1.omni.hot.tg:";

export const GlobalSettings = {
  get intentsContract() {
    return _intentsContract;
  },

  get omniHotContract() {
    return _omniHotContract;
  },

  get hotIntentPrefix() {
    return _hotIntentPrefix;
  },

  setIntentsContract(contract: string) {
    console.warn(`YOU CHANGED INTENTS CONTRACT TO "${contract}". YOU MAY LOST YOUR FUNDS IF YOU ARE NOT SURE WHAT YOU ARE DOING`);
    _intentsContract = contract;
  },

  setOmniHotContract(contract: string) {
    console.warn(`YOU CHANGED OMNI HOT CONTRACT TO "${contract}". YOU MAY LOST YOUR FUNDS IF YOU ARE NOT SURE WHAT YOU ARE DOING`);
    _omniHotContract = contract;
  },

  setHotIntentPrefix(prefix: string) {
    console.warn(`YOU CHANGED HOT INTENT PREFIX TO "${prefix}". YOU MAY LOST YOUR FUNDS IF YOU ARE NOT SURE WHAT YOU ARE DOING`);
    _hotIntentPrefix = prefix;
  },

  cosmos: {
    [Network.Juno]: {
      contract: "juno1va9q7gma6l62aqq988gghv4r7u4hnlgm85ssmsdf9ypw77qfwa0qaz7ea4",
      rpc: "https://juno-rpc.publicnode.com",
      gasLimit: 200000n,
      nativeToken: "ujuno",
      chainId: "juno-1",
      prefix: "juno",
    },
    [Network.Gonka]: {
      contract: "gonka15wng2302rhq5w8ddy3l3jslrhfcpufzfs6wc3zc6cxt8cpwrfp4qqgenkc",
      rpc: `https://api0.herewallet.app/api/v1/evm/rpc/${Network.Gonka}`,
      gasLimit: 200000n,
      nativeToken: "ngonka",
      chainId: "gonka-mainnet",
      prefix: "gonka",
    },
  } as Record<number, CosmosConfig>,
};
