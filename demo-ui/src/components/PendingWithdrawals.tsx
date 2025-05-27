import React, { useState } from "react";
import type { PendingWithdraw } from "../../../src";
import { Network, chains } from "../../../src";

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

import { useNearWallet } from "../hooks/near";
import { useBridge } from "../hooks/bridge";
import { useEvmWallet } from "../hooks/evm";
import { useTonWallet } from "../hooks/ton";

const PendingWithdrawalsComponent = () => {
  const nearWallet = useNearWallet();
  const evmWallet = useEvmWallet();
  const tonWallet = useTonWallet();
  const { bridge } = useBridge();

  const [pendingWithdraw, setPendingWithdraw] = useState<PendingWithdraw[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<Network>(Network.Base);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [processingWithdrawals, setProcessingWithdrawals] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [receiver, setReceiver] = useState<string>("");

  // Get available networks for the selector
  const availableNetworks = Object.entries(Network)
    .filter(([key, value]) => !isNaN(Number(value)))
    .map(([key, value]) => ({ label: key, value: Number(value), disabled: !chains.has(Number(value)) }));

  const fetchPendingWithdrawals = async () => {
    if (!nearWallet.accountId) return setError("Wallet not connected. Please connect your wallet first.");
    if (!receiver.trim()) return setError("Please enter a receiver address.");
    setIsLoading(true);
    setError(null);

    try {
      const pending = await bridge.getPendingWithdrawalsWithStatus(selectedNetwork, receiver);
      setPendingWithdraw(pending.filter((t) => !t.completed));
    } catch (err) {
      console.error("Error fetching pending withdrawals:", err);
      setError("Failed to load pending withdrawals. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  };

  const finishWithdrawal = async (withdraw: PendingWithdraw) => {
    if (!nearWallet.accountId) return setError("Wallet not connected. Please connect your wallet first.");
    setProcessingWithdrawals((prev) => ({ ...prev, [withdraw.nonce]: true }));
    setError(null);

    try {
      // Get withdrawal data using buildWithdraw
      const withdrawData = await bridge.buildWithdraw(withdraw.nonce);
      if (chains.get(withdrawData.chain)?.isEvm) {
        await bridge.evm.withdraw({ ...withdrawData, sendTransaction: evmWallet.sendTransaction });
      } else if (withdrawData.chain === Network.Ton) {
        await bridge.ton.withdraw({ ...withdrawData, sendTransaction: tonWallet.sendTransaction });
      } else {
        throw new Error("Finishing withdrawal is only supported for EVM chains at this time");
      }

      setPendingWithdraw((prev) => prev.filter((item) => item.nonce !== withdraw.nonce));
    } catch (err) {
      setError(`Failed to complete withdrawal #${withdraw.nonce}. ${err}`);
    } finally {
      setProcessingWithdrawals((prev) => ({ ...prev, [withdraw.nonce]: false }));
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
        <LoadingContainer style={{ width: "100%" }}>
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
                <StatusBadge
                  onClick={() => !processingWithdrawals[withdraw.nonce] && finishWithdrawal(withdraw)}
                  style={{ cursor: processingWithdrawals[withdraw.nonce] ? "default" : "pointer" }}
                >
                  {processingWithdrawals[withdraw.nonce] ? "Processing..." : "Click to finish"}
                </StatusBadge>
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
