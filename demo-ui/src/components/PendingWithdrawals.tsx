import React, { useState } from "react";
import { Network, PendingWithdraw, utils } from "@hot-labs/omni-sdk";

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
    .map(([key, value]) => ({ label: key, value: Number(value) }));

  const fetchPendingWithdrawals = async () => {
    if (!nearWallet.accountId) return setError("Wallet not connected. Please connect your wallet first.");
    if (!receiver.trim()) return setError("Please enter a receiver address.");
    setIsLoading(true);
    setError(null);

    try {
      try {
        const address = utils.decodeReceiver(selectedNetwork, receiver);
        const pending = await bridge.getPendingWithdrawalsWithStatus(selectedNetwork, address);
        if (pending.length === 0) throw new Error("No pending withdrawals found");
        setPendingWithdraw(pending.filter((t) => !t.completed));
      } catch {
        const pending = await bridge.getPendingWithdrawalsWithStatus(selectedNetwork, receiver);
        setPendingWithdraw(pending.filter((t) => !t.completed));
      }
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
      await bridge.checkWithdrawNonce(withdraw.chain, withdraw.receiver, withdraw.nonce);

      // Get withdrawal data using buildWithdraw
      switch (withdraw.chain) {
        case Network.OmniTon: {
          if (!tonWallet.address) throw new Error("Ton wallet not connected");
          const sender = tonWallet.address;
          const refundAddress = tonWallet.address;
          const sendTransaction = tonWallet.sendTransaction;

          await bridge.checkWithdrawNonce(withdraw.chain, withdraw.receiver, withdraw.nonce);
          await bridge.ton.withdraw({ sendTransaction, refundAddress, sender, ...withdraw });
          await bridge.clearPendingWithdrawals([withdraw]);
          break;
        }

        default:
          await bridge.evm.withdraw({ sendTransaction: evmWallet.sendTransaction, ...withdraw });
          await bridge.checkLocker(withdraw.chain, withdraw.receiver);
          break;
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
            <option key={network.value} value={network.value}>
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
