import { useState, useEffect } from "react";
import { makeObservable, observable, runInAction } from "mobx";
import { TokenAsset, utils } from "@hot-labs/omni-sdk";

import { bridge } from "./bridge";

let _tokens: { chain: number; address: string }[] = [];
const getBridgableTokens = async () => {
  if (_tokens.length > 0) return _tokens;

  const { groups } = await bridge.api.getBridgeTokens();
  _tokens = Object.values(groups)
    .flatMap((list) => {
      try {
        return list.map(utils.fromOmni);
      } catch (e) {
        console.error("getBridgableTokens", e);
        return [];
      }
    })
    .map((t) => ({ chain: +t.split(":")[0], address: t.split(":")[1] }));

  return _tokens;
};

export const useAvailableTokens = (chain: number) => {
  const [tokens, setTokens] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("useAvailableTokens", chain);
    setLoading(true);
    getBridgableTokens()
      .then((tokens) => {
        console.log("useAvailableTokens", tokens, chain);
        setTokens(Array.from(new Set(["native", ...tokens.filter((t) => t.chain === chain).map((t) => t.address)])));
      })
      .catch((e) => {
        console.error("useAvailableTokens", e);
      })
      .finally(() => setLoading(false));
  }, [chain]);

  return { tokens, loading };
};

class Tokens {
  assets: TokenAsset[] = [];

  constructor() {
    makeObservable(this, {
      assets: observable,
    });

    bridge.api.getTokenAssets().then((assets) => {
      runInAction(() => {
        this.assets = assets;
      });
    });
  }

  get(id: string) {
    const [chain, address] = id.split(":");
    return this.assets.find((t) => t.chain_id === +chain && t.contract_id === address);
  }
}

export const tokens = new Tokens();
