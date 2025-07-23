import React, { useState } from "react";
import { Network } from "@hot-labs/omni-sdk";

import {
  Card,
  StyledInput,
  StyledButton,
  ErrorMessage,
  SuccessMessage,
  FormContainer,
  Select,
  InputLabel,
  FormGroup,
} from "../theme/styles";

import { useAvailableTokens } from "../hooks/tokens";
import { useBridge } from "../hooks/bridge";

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || !isNaN(Number(value)))
  .map(([key, value]) => ({ label: key, value: Number(value) }));

const DepositComponent = ({ stellar, evm, near, ton }: { stellar: any; evm: any; near: any; ton: any }) => {
  const { bridge } = useBridge();

  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { tokens } = useAvailableTokens(network);

  const handleDeposit = async (e: any) => {
    e.preventDefault();
    if (!near.accountId) return;
    if (!amount || !token) return setError("Please enter both amount and token");

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Ton) {
        const hash = await bridge.ton.deposit({
          sender: ton.address!,
          refundAddress: ton.address!,
          intentAccount: near.intentAccount!,
          sendTransaction: ton.sendTransaction,
          amount: BigInt(amount),
          token: token,
        });

        const deposit = await bridge.waitPendingDeposit(network, hash, near.intentAccount!);
        await bridge.finishDeposit(deposit);
      }

      // Near
      else if (network === Network.Near) {
        await bridge.near.deposit({
          sender: near.accountId!,
          intentAccount: near.intentAccount!,
          sendTransaction: near.sendTransaction,
          amount: BigInt(amount),
          token: token,
        });
      }

      // Stellar
      else if (network === Network.Stellar) {
        const tx = await bridge.stellar.deposit({
          sender: stellar.address!,
          intentAccount: near.intentAccount!,
          sendTransaction: stellar.sendTransaction as any,
          amount: BigInt(amount),
          token: token,
        });

        const controller = new AbortController();
        const deposit = await bridge.waitPendingDeposit(network, tx, near.intentAccount!, controller.signal);
        await bridge.finishDeposit(deposit);
      }

      // EVM
      else {
        if (evm == null) throw "Connect EVM to deposit";
        const tx = await bridge.evm.deposit({
          sender: evm.address!,
          intentAccount: near.intentAccount!,
          sendTransaction: evm.sendTransaction as any,
          amount: BigInt(amount),
          chain: network,
          token: token,
        });

        const controller = new AbortController();
        const deposit = await bridge.waitPendingDeposit(network, tx, near.intentAccount!, controller.signal);
        await bridge.finishDeposit(deposit);
      }

      setSuccess(`Successfully deposited ${amount} of ${token}`);
      setAmount("");
      setToken("");
    } catch (err) {
      console.error("Deposit error:", err);
      setError("Failed to process deposit. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <h3>Deposit</h3>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      <FormContainer>
        <FormGroup>
          <InputLabel>Intent account</InputLabel>
          <StyledInput type="text" placeholder="Receiver" value={near.accountId!} disabled />
        </FormGroup>

        <FormGroup>
          <InputLabel>Deposit from chain</InputLabel>
          <Select value={network} onChange={(e) => setNetwork(Number(e.target.value) as Network)} disabled={isLoading}>
            <option value="" disabled>
              Select Network
            </option>

            {availableNetworks.map((network) => (
              <option key={network.value} value={network.value}>
                {network.label}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <InputLabel>Deposit token</InputLabel>
          <Select value={token} onChange={(e) => setToken(e.target.value)} disabled={isLoading}>
            <option value="" disabled>
              Select token
            </option>

            {tokens.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <InputLabel>Deposit amount</InputLabel>
          <StyledInput
            type="text"
            value={amount}
            disabled={isLoading}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
            placeholder="Amount"
          />
        </FormGroup>

        <StyledButton onClick={handleDeposit} disabled={isLoading}>
          {isLoading ? "Processing..." : "Deposit"}
        </StyledButton>
      </FormContainer>
    </Card>
  );
};

export default DepositComponent;
