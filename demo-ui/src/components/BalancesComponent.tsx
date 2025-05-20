import React from "react";
import { useNearWallet } from "../hooks/near";
import { useIntentBalances } from "../hooks/balances";

import {
  BalancesContainer,
  TokenCard,
  BalanceSectionTitle,
  TokenName,
  TokenAmount,
  LoadingContainer,
  ErrorMessage,
  ChainImage,
  TokenImage,
} from "../theme/styles";

const BalancesComponent = () => {
  const nearSigner = useNearWallet();
  const { balances, isLoading, error } = useIntentBalances(nearSigner?.intentAccount || undefined);

  if (isLoading) {
    return (
      <LoadingContainer>
        <p>Loading balances...</p>
      </LoadingContainer>
    );
  }

  if (error) {
    return <ErrorMessage>{error}</ErrorMessage>;
  }

  return (
    <BalancesContainer>
      <BalanceSectionTitle>Bridge Balances</BalanceSectionTitle>
      {balances.map((balance) => (
        <TokenCard key={balance.address}>
          <TokenImage src={`https://storage.herewallet.app/ft/${balance.chain}:${balance.address}.png`} />
          <ChainImage src={`https://storage.herewallet.app/ft/${balance.chain}:native.png`} />
          <div>
            <TokenName>{balance.address}</TokenName>
            <TokenAmount>{balance.amount}</TokenAmount>
          </div>
        </TokenCard>
      ))}
    </BalancesContainer>
  );
};

export default BalancesComponent;
