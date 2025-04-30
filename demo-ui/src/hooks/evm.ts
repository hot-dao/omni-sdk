import { type Config, http, createConfig, useConnectorClient, useDisconnect, useSwitchChain, useAccount } from "wagmi";
import { base, mainnet, polygon, arbitrum, optimism, avalanche, aurora, linea, kava, bsc } from "wagmi/chains";
import { BrowserProvider, JsonRpcSigner, toNumber, TransactionRequest } from "ethers";
import type { Account, Chain, Client, Transport } from "viem";
import { injected, metaMask, safe } from "wagmi/connectors";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo } from "react";

import "@rainbow-me/rainbowkit/styles.css";

export const config = createConfig({
  chains: [mainnet, bsc, base, polygon, arbitrum, optimism, avalanche, aurora, linea, kava],
  connectors: [injected(), metaMask(), safe()],
  transports: {
    [polygon.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [avalanche.id]: http(),
    [aurora.id]: http(),
    [base.id]: http(),
    [linea.id]: http(),
    [kava.id]: http(),
    [bsc.id]: http(),
  },
});

export function clientToSigner(client: Client<Transport, Chain, Account>) {
  const { account, chain, transport } = client;
  const network = { chainId: chain.id, name: chain.name, ensAddress: chain.contracts?.ensRegistry?.address };
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
    signIn: () => openConnectModal?.(),
    signOut: () => disconnect(),

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
