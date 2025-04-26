import { type Config, http, createConfig, useConnectorClient, useDisconnect, useSwitchChain, useAccount } from "wagmi";
import { BrowserProvider, JsonRpcSigner, toNumber, TransactionRequest } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";
import { injected, metaMask, safe } from "wagmi/connectors";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { base, mainnet } from "wagmi/chains";
import { useMemo } from "react";

import "@rainbow-me/rainbowkit/styles.css";

export const config = createConfig({
  chains: [mainnet, base],
  connectors: [injected(), metaMask(), safe()],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
  },
});

export function clientToSigner(client: Client<Transport, Chain, Account>) {
  const { account, chain, transport } = client;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new BrowserProvider(transport, network);
  const signer = new JsonRpcSigner(provider, account.address);
  return signer;
}

/** Hook to convert a viem Wallet Client to an ethers.js Signer. */
export function useEthersSigner({ chainId }: { chainId?: number } = {}) {
  const { data: client } = useConnectorClient<Config>({ chainId });
  return useMemo(() => (client ? clientToSigner(client) : undefined), [client]);
}

export const useEvmWallet = () => {
  const wallet = useEthersSigner();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();

  return {
    wallet,
    address: wallet?.address,

    signIn: () => {
      openConnectModal?.();
    },

    signOut: () => {
      disconnect();
    },

    sendTransaction: async (tx: TransactionRequest) => {
      if (!wallet) throw new Error("Wallet not found");

      if (chainId !== toNumber(tx.chainId!)) {
        await switchChainAsync({ chainId: toNumber(tx.chainId!) });
        throw "Chain switched, try again";
      }

      const result = await wallet.sendTransaction(tx);
      return result.hash;
    },

    signIntent: () => {
      throw new Error("Not implemented");
    },
  };
};
