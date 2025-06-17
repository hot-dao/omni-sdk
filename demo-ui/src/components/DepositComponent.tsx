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
import { useEvmWallet } from "../hooks/evm";
import { useNearWallet } from "../hooks/near";
import { useBridge } from "../hooks/bridge";
import { useTonWallet } from "../hooks/ton";

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || value === 1111 || !isNaN(Number(value)))
  .map(([key, value]) => ({ label: key, value: Number(value) }));

const DepositComponent = () => {
  const nearSigner = useNearWallet();
  const tonSigner = useTonWallet();
  const evmSigner = useEvmWallet();
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
    if (!nearSigner.accountId) return;
    if (!amount || !token) return setError("Please enter both amount and token");

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Ton) {
        const deposit = await bridge.ton.deposit({
          sender: tonSigner.address!,
          refundAddress: tonSigner.address!,
          intentAccount: nearSigner.intentAccount!,
          sendTransaction: tonSigner.sendTransaction,
          amount: BigInt(amount),
          token: token,
        });

        await bridge.finishDeposit(deposit);
      }

      // Near
      else if (network === Network.Near) {
        await bridge.near.deposit({
          sender: nearSigner.accountId!,
          intentAccount: nearSigner.intentAccount!,
          sendTransaction: nearSigner.sendTransaction,
          amount: BigInt(amount),
          token: token,
        });
      }

      // EVM
      else {
        if (evmSigner == null) throw "Connect EVM to deposit";
        const deposit = await bridge.evm.deposit({
          sender: evmSigner.address!,
          intentAccount: nearSigner.intentAccount!,
          sendTransaction: evmSigner.sendTransaction,
          amount: BigInt(amount),
          chain: network,
          token: token,
        });

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
          <StyledInput type="text" placeholder="Receiver" value={nearSigner.accountId!} disabled />
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
