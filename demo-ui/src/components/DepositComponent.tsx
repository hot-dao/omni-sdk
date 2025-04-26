import React, { useState } from "react";

import { Network, chains } from "@hot-labs/omni-sdk";

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
import { useEvmWallet } from "../hooks/evm";
import { useNearWallet } from "../hooks/near";
import { useBridge } from "../hooks/bridge";

interface TransactionParams {
  receiverId: string;
  actions: any[];
}

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || (!isNaN(Number(value)) && chains.get(Number(value))?.isEvm))
  .map(([key, value]) => ({ label: key, value: Number(value), disabled: !chains.has(Number(value)) }));

const DepositComponent = () => {
  const nearSigner = useNearWallet();
  const evmSigner = useEvmWallet();
  const { bridge } = useBridge();
  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNetwork(Number(e.target.value) as Network);
  };

  const handleDeposit = async (e: any) => {
    e.preventDefault();
    if (!nearSigner.accountId) return;
    if (!amount || !token) return setError("Please enter both amount and token");

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (chains.get(network)?.isEvm) {
        if (evmSigner == null) throw "Connect EVM to deposit";
        const deposit = await bridge.evm.deposit({
          token: token,
          chain: network,
          amount: BigInt(amount),
          getAddress: async () => evmSigner.address!,
          getIntentAccount: async () => nearSigner.intentAccount!,
          sendTransaction: evmSigner.sendTransaction,
        });

        await bridge.finishDeposit(deposit);
      }

      if (network === Network.Near) {
        await bridge.near.depositToken({
          token: token,
          amount: BigInt(amount),
          getAddress: async () => nearSigner.accountId!,
          getIntentAccount: async () => nearSigner.intentAccount!,
          sendTransaction: async ({ receiverId, actions }: TransactionParams) => {
            const txHash = await nearSigner.sendTransaction({ receiverId, actions });
            return txHash!.transaction.hash;
          },
        });
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
          <Select value={network} onChange={handleNetworkChange} disabled={isLoading}>
            <option value="" disabled>
              Select Network
            </option>
            {availableNetworks.map((network) => (
              <option key={network.value} value={network.value} disabled={network.disabled}>
                {network.label}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <InputLabel>Deposit token</InputLabel>
          <StyledInput
            type="text"
            placeholder="Token"
            value={token}
            disabled={isLoading}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
          />
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
