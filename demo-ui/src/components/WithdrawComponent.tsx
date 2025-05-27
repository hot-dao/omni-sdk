import React, { useEffect, useState } from "react";
import { Network, chains } from "@hot-labs/omni-sdk";

import { useAvailableTokens } from "../hooks/tokens";
import { useBridge } from "../hooks/bridge";
import { useNearWallet } from "../hooks/near";
import { useEvmWallet } from "../hooks/evm";
import { useTonWallet } from "../hooks/ton";

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
  .filter(
    ([key, value]) => value === 1010 || value === 1111 || (!isNaN(Number(value)) && chains.get(Number(value))?.isEvm)
  )
  .map(([key, value]) => ({ label: key, value: Number(value), disabled: !chains.has(Number(value)) }));

const WithdrawComponent = () => {
  const nearSigner = useNearWallet();
  const evmSigner = useEvmWallet();
  const tonSigner = useTonWallet();
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
    if (chains.get(network)?.isEvm) return setReceiver(evmSigner.address || "");
    if (network === Network.Near) return setReceiver(nearSigner.accountId || "");
    setReceiver("");
  }, [network]);

  const handleWithdraw = async () => {
    if (!nearSigner.accountId) return;
    if (!amount || !token || !receiver) {
      setError("Please enter both amount, token and receiver");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      if (network === Network.Ton) {
        await bridge.ton.createUserIfNeeded({ sendTransaction: tonSigner.sendTransaction, address: receiver });
      }

      const result = await bridge.withdrawToken({
        signIntent: async (intent: any) => await nearSigner.signIntent(intent),
        intentAccount: nearSigner.intentAccount!,
        receiver: receiver.trim(),
        amount: BigInt(amount),
        chain: network,
        token: token,
      });

      if (result) {
        if (result.chain === Network.Ton) {
          await bridge.ton.withdraw({ sendTransaction: tonSigner.sendTransaction, ...result });
        } else if (chains.get(result.chain)?.isEvm) {
          await bridge.evm.withdraw({ sendTransaction: evmSigner.sendTransaction, ...result });
        } else {
          throw new Error("Finish withdraw unsupported for this network");
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
              <option key={network.value} value={network.value} disabled={network.disabled}>
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
