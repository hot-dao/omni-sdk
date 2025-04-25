import React, { useState } from "react";
import { PendingWithdraw } from "../../../src/types";
import { Network, chains } from "../../../src";
import { useNearWallet } from "../hooks/near";
import { omni } from "../hooks/bridge";
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

const PendingWithdrawalsComponent = () => {
  const nearSigner = useNearWallet();
  const [pendingWithdraw, setPendingWithdraw] = useState<PendingWithdraw[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<Network>(Network.Base);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<string>("");

  // Get available networks for the selector
  const availableNetworks = Object.entries(Network)
    .filter(([key, value]) => !isNaN(Number(value)))
    .map(([key, value]) => ({ label: key, value: Number(value), disabled: !chains.has(Number(value)) }));

  const fetchPendingWithdrawals = async () => {
    if (!nearSigner.wallet) return setError("Wallet not connected. Please connect your wallet first.");
    if (!receiver.trim()) return setError("Please enter a receiver address.");
    setIsLoading(true);
    setError(null);

    try {
      const pending = await omni.getPendingWithdrawals(selectedNetwork, receiver);
      setPendingWithdraw(pending);
    } catch (err) {
      console.error("Error fetching pending withdrawals:", err);
      setError("Failed to load pending withdrawals. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedNetwork(Number(e.target.value) as Network);
  };

  const handleReceiverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReceiver(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPendingWithdrawals();
  };

  return (
    <Card>
      <h3>Pending Withdrawals</h3>

      <FormContainer onSubmit={handleSubmit}>
        <Select value={selectedNetwork} onChange={handleNetworkChange} required>
          <option value="" disabled>
            Select Network
          </option>
          {availableNetworks.map((network) => (
            <option key={network.value} value={network.value} disabled={network.disabled}>
              {network.label}
            </option>
          ))}
        </Select>

        <Input type="text" placeholder="Receiver Address" value={receiver} onChange={handleReceiverChange} required />

        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Loading..." : "Search Withdrawals"}
        </Button>
      </FormContainer>

      <br />

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {isLoading ? (
        <LoadingContainer>
          <p>Loading pending withdrawals...</p>
        </LoadingContainer>
      ) : pendingWithdraw.length === 0 ? (
        <EmptyState>No pending withdrawals found</EmptyState>
      ) : (
        <WithdrawalsContainer>
          {pendingWithdraw.map((withdraw) => (
            <WithdrawalCard key={withdraw.nonce}>
              <WithdrawalHeader>
                <span>Withdrawal #{withdraw.nonce}</span>
                <StatusBadge>Pending</StatusBadge>
              </WithdrawalHeader>
              <WithdrawalDetails>
                <WithdrawalDetail>
                  <DetailLabel>Amount:</DetailLabel>
                  <DetailValue>{withdraw.amount.toString()}</DetailValue>
                </WithdrawalDetail>
                <WithdrawalDetail>
                  <DetailLabel>Token:</DetailLabel>
                  <DetailValue>{withdraw.token}</DetailValue>
                </WithdrawalDetail>
                <WithdrawalDetail>
                  <DetailLabel>Receiver:</DetailLabel>
                  <DetailValue>{withdraw.receiver}</DetailValue>
                </WithdrawalDetail>
              </WithdrawalDetails>
            </WithdrawalCard>
          ))}
        </WithdrawalsContainer>
      )}
    </Card>
  );
};

export default PendingWithdrawalsComponent;
