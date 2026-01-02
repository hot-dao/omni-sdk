import React, { useState } from "react";
import { observer } from "mobx-react-lite";
import { Network } from "@hot-labs/kit";
import { hex } from "@scure/base";

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
import { wibe3 } from "../hooks/bridge";

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || !isNaN(Number(value)))
  .map(([key, value]) => ({ label: key, value: Number(value) }));

const DepositComponent = observer(() => {
  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { tokens } = useAvailableTokens(network);

  const handleDeposit = async (e: any) => {
    e.preventDefault();
    if (!wibe3.near?.address) return;
    if (!amount || !token) return setError("Please enter both amount and token");

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Juno || network === Network.Gonka) {
        if (wibe3.cosmos == null) throw "Connect Cosmos to deposit";
        const cosmosWallet = await wibe3.hotBridge.cosmos();
        const hash = await cosmosWallet.deposit({
          chain: network,
          sender: wibe3.cosmos?.address,
          senderPublicKey: hex.decode(wibe3.cosmos.publicKey),
          intentAccount: wibe3.near?.omniAddress!,
          sendTransaction: (t: any) => wibe3.cosmos?.sendTransaction(t) as any,
          amount: BigInt(amount),
          token: token,
        });

        const deposit = await wibe3.hotBridge.waitPendingDeposit(network, hash, wibe3.near?.omniAddress!);
        await wibe3.hotBridge.finishDeposit(deposit);
      }

      if (network === Network.Ton) {
        const hash = await wibe3.hotBridge.ton.deposit({
          sender: wibe3.ton?.address!,
          refundAddress: wibe3.ton?.address!,
          intentAccount: wibe3.near?.omniAddress!,
          sendTransaction: (t: any) => wibe3.ton?.sendTransaction([t]) as any,
          amount: BigInt(amount),
          token: token,
        });

        const deposit = await wibe3.hotBridge.waitPendingDeposit(network, hash, wibe3.near?.omniAddress!);
        await wibe3.hotBridge.finishDeposit(deposit);
      }

      // Near
      else if (network === Network.Near) {
        await wibe3.hotBridge.near.deposit({
          sender: wibe3.near?.address!,
          intentAccount: wibe3.near?.omniAddress!,
          sendTransaction: (t: any) => wibe3.near?.sendTransaction(t) as any,
          amount: BigInt(amount),
          token: token,
        });
      }

      // Stellar
      else if (network === Network.Stellar) {
        console.log("Depositing to Stellar");
        const tx = await wibe3.hotBridge.stellar.deposit({
          sender: wibe3.stellar?.address!,
          intentAccount: wibe3.near?.omniAddress!,
          sendTransaction: (t: any) => wibe3.stellar?.sendTransaction(t) as any,
          amount: BigInt(amount),
          token: token,
        });

        console.log("Deposit tx: ", tx);
        const controller = new AbortController();
        const deposit = await wibe3.hotBridge.waitPendingDeposit(
          network,
          tx,
          wibe3.near.omniAddress,
          controller.signal
        );

        await wibe3.hotBridge.finishDeposit(deposit);
      }

      // EVM
      else {
        if (wibe3.evm == null) throw "Connect EVM to deposit";
        console.log("Depositing to EVM", network, token);
        const tx = await wibe3.hotBridge.evm.deposit({
          sender: wibe3.evm?.address!,
          intentAccount: wibe3.near?.omniAddress!,
          sendTransaction: (t: any) => wibe3.evm?.sendTransaction(network, t) as any,
          amount: BigInt(amount),
          chain: network,
          token: token,
        });

        if (tx) {
          const controller = new AbortController();
          const deposit = await wibe3.hotBridge.waitPendingDeposit(
            network,
            tx,
            wibe3.near.omniAddress,
            controller.signal
          );

          await wibe3.hotBridge.finishDeposit(deposit);
        }
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
          <StyledInput type="text" placeholder="Receiver" value={wibe3.near?.omniAddress} disabled />
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
});

export default DepositComponent;
