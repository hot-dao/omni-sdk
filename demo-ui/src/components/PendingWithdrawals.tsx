import React, { useState } from "react";
import { utils, WithdrawArgsWithPending } from "@hot-labs/omni-sdk";
import { observer } from "mobx-react-lite";
import { Network } from "@hot-labs/kit";
import { hex } from "@scure/base";

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
import { wibe3 } from "../hooks/bridge";

const PendingWithdrawalsComponent = observer(() => {
  const [pendingWithdraw, setPendingWithdraw] = useState<WithdrawArgsWithPending[]>([]);
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
    if (!wibe3.near?.address) return setError("Wallet not connected. Please connect your wallet first.");
    if (!receiver.trim()) return setError("Please enter a receiver address.");
    setIsLoading(true);
    setError(null);

    try {
      try {
        const address = utils.decodeReceiver(selectedNetwork as any, receiver);
        const pending = await wibe3.hotBridge.getPendingWithdrawalsWithStatus(selectedNetwork, address);
        if (pending.length === 0) throw new Error("No pending withdrawals found");
        setPendingWithdraw(pending.filter((t) => !t.completed));
      } catch {
        const pending = await wibe3.hotBridge.getPendingWithdrawalsWithStatus(selectedNetwork, receiver);
        setPendingWithdraw(pending.filter((t) => !t.completed));
      }
    } catch (err) {
      console.error("Error fetching pending withdrawals:", err);
      setError("Failed to load pending withdrawals. Please try refreshing.");
    } finally {
      setIsLoading(false);
    }
  };

  const finishWithdrawal = async (withdraw: WithdrawArgsWithPending) => {
    if (!wibe3.near?.address) return setError("Wallet not connected. Please connect your wallet first.");
    setProcessingWithdrawals((prev) => ({ ...prev, [withdraw.nonce]: true }));
    setError(null);

    try {
      await wibe3.hotBridge.checkWithdrawNonce(withdraw.chain, withdraw.receiver, withdraw.nonce);

      if (withdraw.chain === Network.Juno || withdraw.chain === Network.Gonka) {
        if (!wibe3.cosmos) throw new Error("Cosmos wallet not connected");
        const sendTransaction = (t: any) => wibe3.cosmos!.sendTransaction(t) as any;
        const senderPublicKey = hex.decode(wibe3.cosmos.publicKey);
        await wibe3.hotBridge.cosmos().then((s) =>
          s.withdraw({
            sendTransaction,
            sender: wibe3.cosmos!.address,
            senderPublicKey,
            ...withdraw,
          })
        );
        await wibe3.hotBridge.clearPendingWithdrawals([withdraw]);
        return;
      }

      // Get withdrawal data using buildWithdraw
      switch (withdraw.chain) {
        case Network.OmniTon: {
          if (!wibe3.ton?.address) throw new Error("Ton wallet not connected");
          const refundAddress = wibe3.ton?.address;

          await wibe3.hotBridge.ton.withdraw({
            sendTransaction: (t: any) => wibe3.ton?.sendTransaction([t]) as any,
            refundAddress,
            ...withdraw,
          });

          await wibe3.hotBridge.clearPendingWithdrawals([withdraw]);
          break;
        }

        case Network.Stellar: {
          if (!wibe3.stellar?.address) throw new Error("Stellar wallet not connected");
          const sender = wibe3.stellar?.address;
          await wibe3.hotBridge.stellar.withdraw({
            sendTransaction: (t: any) => wibe3.stellar?.sendTransaction(t) as any,
            sender,
            ...withdraw,
          });

          await wibe3.hotBridge.clearPendingWithdrawals([withdraw]);
          break;
        }

        default: {
          if (!wibe3.evm?.address) throw new Error("EVM wallet not connected");
          const sendTransaction = wibe3.evm?.sendTransaction as any;
          await wibe3.hotBridge.evm.withdraw({ sendTransaction, ...withdraw });
          await wibe3.hotBridge.checkLocker(withdraw.chain, withdraw.receiver, withdraw.nonce);
          break;
        }
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
});

export default PendingWithdrawalsComponent;
