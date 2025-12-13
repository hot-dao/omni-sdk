import { useState, useEffect } from "react";
import { utils } from "@hot-labs/omni-sdk";
import { wibe3 } from "./bridge";

export const useIntentBalances = (accountId?: string) => {
  const [balances, setBalances] = useState<{ chain: number; address: string; intent: string; amount: bigint }[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBalances([]);
    setError(null);
    setIsLoading(false);

    if (!accountId) return;
    const fetchBalances = async () => {
      if (!accountId) return;
      setIsLoading(true);
      setError(null);

      try {
        const intentBalances = await wibe3.hotBridge.getAllIntentBalances(accountId);
        const balances = Object.entries(intentBalances)
          .filter(([intent]) => !intent.startsWith("nep171:"))
          .map(([intent, amount]) => ({
            chain: +utils.fromOmni(intent).split(":")[0],
            address: utils.fromOmni(intent).split(":")[1],
            intent,
            amount,
          }));

        setBalances(balances.filter((balance) => balance.amount > 0n));
      } catch (err) {
        console.error("Error fetching balances:", err);
        setError("Failed to load balances. Please try refreshing.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
  }, [accountId]);

  return { balances, isLoading, error };
};
