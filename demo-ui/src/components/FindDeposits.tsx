import React, { useState } from "react";
import { PendingDeposit } from "@hot-labs/omni-sdk";
import { Network } from "@hot-labs/kit";
import { observer } from "mobx-react-lite";

import { wibe3 } from "../hooks/bridge";
import {
  Card,
  EmptyState,
  WithdrawalsContainer,
  WithdrawalCard,
  WithdrawalHeader,
  StatusBadge,
  WithdrawalDetails,
  WithdrawalDetail,
  DetailLabel,
  DetailValue,
  LoadingContainer,
  ErrorMessage,
  FormContainer,
  Input,
  Select,
  Button,
} from "../theme/styles";

const FindDeposits = observer(() => {
  const [chain, setChain] = useState<Network>(Network.Base);
  const [intentAccount, setIntentAccount] = useState<string>("");
  const [transactionHash, setTransactionHash] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [deposit, setDeposit] = useState<PendingDeposit | null>(null);

  // Get available networks for the selector
  const availableNetworks = Object.entries(Network)
    .filter(([key, value]) => !isNaN(Number(value)))
    .map(([key, value]) => ({ label: key, value: Number(value) }));

  const fetchPendingWithdrawals = async () => {
    if (!wibe3.near?.omniAddress) return setError("Wallet not connected. Please connect your wallet first.");
    if (!intentAccount.trim()) return setError("Please enter a receiver intent account.");
    if (!transactionHash.trim()) return setError("Please enter a transaction hash.");
    setIsLoading(true);
    setError(null);

    try {
      const pending = await wibe3.hotBridge.waitPendingDeposit(chain, transactionHash, intentAccount);
      setDeposit(pending);
      setIsLoading(false);
      setError(null);
    } catch (err) {
      console.error("Error fetching pending deposits:", err);
      setError(err instanceof Error ? err.message : "Failed to load pending deposits. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  };

  const finishDeposit = async (deposit: PendingDeposit) => {
    if (!wibe3.near?.omniAddress) return setError("Wallet not connected. Please connect your wallet first.");
    setIsLoading(true);
    setError(null);

    try {
      await wibe3.hotBridge.finishDeposit({ ...deposit, intentAccount });
      setDeposit(null);
      setIntentAccount("");
      setTransactionHash("");
      setError(null);
    } catch (err) {
      console.error("Error finishing deposit:", err);
      setError("Failed to finish deposit. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setChain(Number(e.target.value) as Network);
  };

  const handleTransactionHashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTransactionHash(e.target.value);
  };

  const handleIntentAccountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIntentAccount(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPendingWithdrawals();
  };

  return (
    <Card>
      <h3>Find Deposits</h3>

      <FormContainer onSubmit={handleSubmit}>
        <Select value={chain} onChange={handleNetworkChange} required>
          <option value="" disabled>
            Select Network
          </option>

          {availableNetworks.map((network) => (
            <option key={network.value} value={network.value}>
              {network.label}
            </option>
          ))}
        </Select>

        <Input
          type="text"
          placeholder="Transaction Hash"
          value={transactionHash}
          onChange={handleTransactionHashChange}
          required
        />
        <Input
          type="text"
          placeholder="Receiver Intent Account"
          value={intentAccount}
          onChange={handleIntentAccountChange}
          required
        />

        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Loading..." : "Search Deposits"}
        </Button>
      </FormContainer>

      <br />

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {isLoading ? (
        <LoadingContainer style={{ width: "100%" }}>
          <p>Loading deposits...</p>
        </LoadingContainer>
      ) : deposit === null ? (
        <EmptyState>No deposits found</EmptyState>
      ) : (
        <WithdrawalsContainer>
          <WithdrawalCard key={deposit.nonce}>
            <WithdrawalHeader>
              <span>Deposit #{deposit.nonce}</span>
              <StatusBadge onClick={() => finishDeposit(deposit)} style={{ cursor: "pointer" }}>
                Click to finish
              </StatusBadge>
            </WithdrawalHeader>
            <WithdrawalDetails>
              <WithdrawalDetail>
                <DetailLabel>Amount:</DetailLabel>
                <DetailValue>{deposit.amount.toString()}</DetailValue>
              </WithdrawalDetail>
              <WithdrawalDetail>
                <DetailLabel>Token:</DetailLabel>
                <DetailValue>{deposit.token}</DetailValue>
              </WithdrawalDetail>
              <WithdrawalDetail>
                <DetailLabel>Receiver:</DetailLabel>
                <DetailValue>{deposit.receiver}</DetailValue>
              </WithdrawalDetail>
            </WithdrawalDetails>
          </WithdrawalCard>
        </WithdrawalsContainer>
      )}
    </Card>
  );
});

export default FindDeposits;
