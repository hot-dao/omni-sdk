import React, { useEffect, useState } from "react";
import { Network } from "@hot-labs/omni-sdk";

import { useAvailableTokens } from "../hooks/tokens";
import { useBridge } from "../hooks/bridge";

import {
  Card,
  StyledInput,
  StyledButton,
  ErrorMessage,
  SuccessMessage,
  Select,
  FormContainer,
  InputLabel,
  FormGroup,
} from "../theme/styles";

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || !isNaN(Number(value)))
  .map(([key, value]) => ({ label: key, value: Number(value) }));

const WithdrawComponent = ({ near, evm, ton, stellar }: { near: any; evm: any; ton: any; stellar: any }) => {
  const { bridge } = useBridge();

  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [receiver, setReceiver] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { tokens } = useAvailableTokens(network);

  useEffect(() => {
    if (network === Network.Near) return setReceiver(near.accountId || "");
    setReceiver(evm.address || "");
  }, [network]);

  const handleWithdraw = async () => {
    if (!near.accountId) return;
    if (!amount || !token || !receiver) {
      setError("Please enter both amount, token and receiver");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Stellar && token !== "native") {
        const isTrustline = await bridge.stellar.isTrustlineExists(receiver.trim(), token);
        if (!isTrustline) throw "Trustline not found";
      }

      const result = await bridge.withdrawToken({
        signIntents: near.signIntents,
        intentAccount: near.intentAccount!,
        receiver: receiver.trim(),
        amount: BigInt(amount),
        chain: network,
        token: token,
      });

      if (result?.nonce) {
        const pending = await bridge.getPendingWithdrawal(result.nonce);
        switch (pending.chain) {
          case Network.Ton: {
            const sender = ton.address!;
            const refundAddress = ton.address!;
            const sendTransaction = ton.sendTransaction;
            await bridge.ton.withdraw({ sendTransaction, refundAddress, sender, ...pending });
            break;
          }

          case Network.Stellar: {
            const sender = stellar.address!;
            const sendTransaction = stellar.sendTransaction;
            await bridge.stellar.withdraw({ sendTransaction, sender, ...pending });
            break;
          }

          default:
            await bridge.evm.withdraw({ sendTransaction: evm.sendTransaction as any, ...pending });
            break;
        }
      }

      setSuccess(`Successfully withdrew ${amount} of ${token}`);
      setAmount("");
      setToken("");
      setReceiver("");
    } catch (err) {
      setError(err?.toString() || "Failed to process withdrawal. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <h3>Withdraw</h3>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      <FormContainer>
        <FormGroup>
          <InputLabel>Withdrawal to chain</InputLabel>
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
          <InputLabel>Receiver address</InputLabel>
          <StyledInput
            type="text"
            placeholder="Enter receiver address"
            value={receiver}
            disabled={isLoading}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiver(e.target.value)}
          />
        </FormGroup>

        <FormGroup>
          <InputLabel>Withdrawal token</InputLabel>
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
          <InputLabel>Withdrawal amount</InputLabel>
          <StyledInput
            type="text"
            placeholder="Enter withdrawal amount"
            value={amount}
            disabled={isLoading}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
          />
        </FormGroup>

        <StyledButton onClick={handleWithdraw} disabled={isLoading}>
          {isLoading ? "Processing..." : "Withdraw"}
        </StyledButton>
      </FormContainer>
    </Card>
  );
};

export default WithdrawComponent;
