import React, { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { Network } from "@hot-labs/kit";
import { hex } from "@scure/base";

import { useAvailableTokens } from "../hooks/tokens";
import { wibe3 } from "../hooks/bridge";

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

const WithdrawComponent = observer(() => {
  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [receiver, setReceiver] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { tokens } = useAvailableTokens(network);

  useEffect(() => {
    if (network === Network.Near) return setReceiver(wibe3.near?.address || "");
    setReceiver(wibe3.evm?.address! || "");
  }, [network]);

  const handleWithdraw = async () => {
    if (!wibe3.near?.address) return;
    if (!amount || !token || !receiver) {
      setError("Please enter both amount, token and receiver");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Stellar && token !== "native") {
        const isTrustline = await wibe3.hotBridge.stellar.isTrustlineExists(receiver.trim(), token);
        if (!isTrustline) throw "Trustline not found";
      }

      const result = await wibe3.hotBridge.withdrawToken({
        signIntents: (intents: any[]) => wibe3.near!.signIntents(intents) as any,
        intentAccount: wibe3.near?.omniAddress!,
        receiver: receiver.trim(),
        amount: BigInt(amount),
        gasless: false,
        chain: network,
        token: token,
      });

      if (result?.nonce) {
        const pending = await wibe3.hotBridge.getPendingWithdrawal(result.nonce);

        if (pending.chain === Network.Juno || pending.chain === Network.Gonka) {
          if (!wibe3.cosmos?.address) throw new Error("Cosmos wallet not connected");
          const sender = wibe3.cosmos!.address;
          const sendTransaction = (t: any) => wibe3.cosmos!.sendTransaction(t) as any;
          const senderPublicKey = hex.decode(wibe3.cosmos!.publicKey);
          const cosmos = await wibe3.hotBridge.cosmos();
          await cosmos.withdraw({ sendTransaction, sender, senderPublicKey, ...pending });
          return;
        }

        switch (pending.chain) {
          case Network.Ton: {
            if (!wibe3.ton?.address) throw new Error("Ton wallet not connected");
            const refundAddress = wibe3.ton?.address;
            const sendTransaction = (t: any) => wibe3.ton?.sendTransaction([t]) as any;
            await wibe3.hotBridge.ton.withdraw({ sendTransaction, refundAddress, ...pending });
            break;
          }

          case Network.Stellar: {
            if (!wibe3.stellar?.address) throw new Error("Stellar wallet not connected");
            const sender = wibe3.stellar?.address;
            const sendTransaction = (t: any) => wibe3.stellar?.sendTransaction(t) as any;
            await wibe3.hotBridge.stellar.withdraw({ sendTransaction, sender, ...pending });
            break;
          }

          default:
            if (!wibe3.evm?.address) throw new Error("EVM wallet not connected");
            const sendTransaction = (t: any) => wibe3.evm?.sendTransaction(pending.chain, t) as any;
            await wibe3.hotBridge.evm.withdraw({ sendTransaction, ...pending });
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
});

export default WithdrawComponent;
