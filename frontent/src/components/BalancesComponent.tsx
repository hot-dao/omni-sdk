import React, { useEffect, useState } from "react";

import { utils } from "../../../src";
import { useNearWallet } from "../hooks/near";
import { omni } from "../hooks/bridge";

import {
  BalancesContainer,
  TokenCard,
  BalanceSectionTitle,
  TokenName,
  TokenAmount,
  LoadingContainer,
  ErrorMessage,
} from "../theme/styles";

const BalancesComponent = () => {
  const nearSigner = useNearWallet();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBalances = async () => {
      if (!nearSigner.wallet) return;

      setIsLoading(true);
      setError(null);

      try {
        // Fetch intent balances
        const intentBalances = await omni.getAllIntentBalances(await nearSigner.wallet!.getIntentAccount());
        setBalances(intentBalances);
      } catch (err) {
        console.error("Error fetching balances:", err);
        setError("Failed to load balances. Please try refreshing.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
  }, [nearSigner.wallet]);

  if (isLoading) {
    return (
      <LoadingContainer>
        <p>Loading balances...</p>
      </LoadingContainer>
    );
  }

  return (
    <>
      {error && <ErrorMessage>{error}</ErrorMessage>}

      {Object.entries(balances).some(([_, balance]) => balance > 0n) && (
        <BalancesContainer>
          <BalanceSectionTitle>Bridge Balances</BalanceSectionTitle>
          {Object.entries(balances).map(
            ([token, balance]) =>
              balance > 0n && (
                <TokenCard key={token}>
                  <img src={`https://storage.herewallet.app/ft/${utils.fromOmni(token)}.png`} alt={token} />
                  <div>
                    <TokenName>{utils.fromOmni(token)}</TokenName>
                    <TokenAmount>{balance.toString()}</TokenAmount>
                  </div>
                </TokenCard>
              )
          )}
        </BalancesContainer>
      )}
    </>
  );
};

export default BalancesComponent;
