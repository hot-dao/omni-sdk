import { utils, Api } from "@hot-labs/omni-sdk";
import { useState, useEffect } from "react";
import { uniq } from "lodash";

let tokens: { chain: number; address: string }[] = [];
const getBridgableTokens = async () => {
  if (tokens.length > 0) return tokens;

  const { groups } = await Api.shared.getBridgeTokens();
  tokens = Object.values(groups)
    .flatMap((list) => list.map(utils.fromOmni))
    .map((t) => ({ chain: +t.split(":")[0], address: t.split(":")[1] }));

  return tokens;
};

export const useAvailableTokens = (chain: number) => {
  const [tokens, setTokens] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBridgableTokens()
      .then((tokens) => setTokens(uniq(["native", ...tokens.filter((t) => t.chain === chain).map((t) => t.address)])))
      .finally(() => setLoading(false));
  }, [chain]);

  return { tokens, loading };
};
