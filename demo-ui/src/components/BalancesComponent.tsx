import React from "react";
import { formatUnits } from "ethers";
import { observer } from "mobx-react-lite";

import { useNearWallet } from "../hooks/near";
import { useIntentBalances } from "../hooks/balances";
import { tokens } from "../hooks/tokens";
import {
  BalancesContainer,
  TokenCard,
  BalanceSectionTitle,
  TokenName,
  TokenAmount,
  LoadingContainer,
  ErrorMessage,
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
      {balances.map((balance) => {
        const id = `${balance.chain}:${balance.address}`;
        const token = tokens.get(id);
        return (
          <TokenCard key={balance.address}>
            <TokenImage src={token?.icon} />
            <div>
              <TokenName>{token?.name || id}</TokenName>
              <TokenAmount>
                {formatUnits(balance.amount, token?.decimal)} {token?.symbol}
              </TokenAmount>
            </div>
          </TokenCard>
        );
      })}
    </BalancesContainer>
  );
};

export default observer(BalancesComponent);
