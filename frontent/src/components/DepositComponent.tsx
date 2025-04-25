import React, { useState } from "react";

import { Network, chains } from "../../../src";

import { Card, StyledInput, StyledButton, ErrorMessage, SuccessMessage, FormContainer, Select } from "../theme/styles";
import { useEthersSigner } from "../hooks/evm";
import { NearWallet, useNearWallet } from "../hooks/near";
import { omni } from "../hooks/bridge";

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
  const evmSigner = useEthersSigner();

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

    if (!nearSigner.wallet) return;
    if (!amount || !token) {
      setError("Please enter both amount and token");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (chains.get(network)?.isEvm) {
        if (evmSigner == null) throw "Connect EVM to deposit";
        const deposit = await omni.evm.deposit({
          token: token,
          chain: network,
          amount: BigInt(amount),
          getAddress: async () => await evmSigner!.address,
          getIntentAccount: async () => await nearSigner.wallet!.getIntentAccount(),
          sendTransaction: (tx) => evmSigner!.sendTransaction(tx).then((r) => r!.hash),
        });

        await omni.finishDeposit(deposit);
      }

      if (network === Network.Near) {
        await omni.near.depositToken({
          token: token,
          amount: BigInt(amount),
          getAddress: async () => nearSigner.wallet!.getAccountId(),
          getIntentAccount: async () => await nearSigner.wallet!.getIntentAccount(),
          sendTransaction: async ({ receiverId, actions }: TransactionParams) => {
            const txHash = await nearSigner.wallet!.sendTransaction({ receiverId, actions });
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
        <StyledInput type="text" placeholder="Receiver" value={nearSigner.wallet!.accountId!} disabled />

        <StyledInput
          type="text"
          value={amount}
          disabled={isLoading}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
          placeholder="Amount"
        />

        <StyledInput
          type="text"
          placeholder="Token"
          value={token}
          disabled={isLoading}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
        />

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

        <StyledButton onClick={handleDeposit} disabled={isLoading}>
          {isLoading ? "Processing..." : "Deposit"}
        </StyledButton>
      </FormContainer>
    </Card>
  );
};

export default DepositComponent;
