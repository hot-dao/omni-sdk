import React, { useEffect, useState } from "react";

import { Network, chains } from "../../../src";
import { useNearWallet } from "../hooks/near";
import { omni } from "../hooks/bridge";

import { Card, StyledInput, StyledButton, ErrorMessage, SuccessMessage, Select, FormContainer } from "../theme/styles";
import { useEthersSigner } from "../hooks/evm";

// Get available networks for the selector
const availableNetworks = Object.entries(Network)
  .filter(([key, value]) => value === 1010 || (!isNaN(Number(value)) && chains.get(Number(value))?.isEvm))
  .map(([key, value]) => ({ label: key, value: Number(value), disabled: !chains.has(Number(value)) }));

const WithdrawComponent = () => {
  const nearSigner = useNearWallet();
  const provider = useEthersSigner();

  const [amount, setAmount] = useState<string>("");
  const [token, setToken] = useState<string>("");
  const [receiver, setReceiver] = useState<string>("");
  const [network, setNetwork] = useState<Network>(Network.Near);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNetwork(Number(e.target.value) as Network);
  };

  useEffect(() => {
    if (chains.get(network)?.isEvm) return setReceiver(provider?.address || "");
    if (network === Network.Near) return setReceiver(nearSigner.wallet!.accountId || "");
    setReceiver("");
  }, [network]);

  const handleWithdraw = async () => {
    if (!nearSigner.wallet) return;
    if (!amount || !token || !receiver) {
      setError("Please enter both amount, token and receiver");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      // Use custom receiver if provided, otherwise use wallet account
      const receiverAddress = receiver.trim() || (await nearSigner.wallet!.getAccountId());

      const result = await omni.withdrawToken({
        token: token,
        amount: BigInt(amount),
        chain: network,
        receiver: receiverAddress,
        getIntentAccount: async () => await nearSigner.wallet!.getIntentAccount(),
        signIntent: async (intent: any) => await nearSigner.wallet!.signIntent(intent),
      });

      if (result) {
        if (chains.get(result.chain)?.isEvm) {
          await omni.evm.withdraw({
            sendTransaction: (tx) => provider!.sendTransaction(tx).then((r) => r!.hash),
            ...result,
          });
        }

        throw new Error("Finish withdraw unsupported for this network");
      }

      setSuccess(`Successfully withdrew ${amount} of ${token}`);
      setAmount("");
      setToken("");
      setReceiver("");
    } catch (err) {
      console.error("Withdraw error:", err);
      setError("Failed to process withdrawal. Please try again.");
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
        <StyledInput
          type="text"
          placeholder="Enter withdrawal amount"
          value={amount}
          disabled={isLoading}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
        />

        <StyledInput
          type="text"
          placeholder="Enter token address"
          value={token}
          disabled={isLoading}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
        />

        <StyledInput
          type="text"
          placeholder="Enter receiver address"
          value={receiver}
          disabled={isLoading}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReceiver(e.target.value)}
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

        <StyledButton onClick={handleWithdraw} disabled={isLoading}>
          {isLoading ? "Processing..." : "Withdraw"}
        </StyledButton>
      </FormContainer>
    </Card>
  );
};

export default WithdrawComponent;
