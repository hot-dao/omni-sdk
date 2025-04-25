import { type Config, http, createConfig, useConnectorClient } from "wagmi";
import type { Account, Chain, Client, Transport } from "viem";
import { injected, metaMask, safe } from "wagmi/connectors";
import { BrowserProvider, JsonRpcSigner } from "ethers";
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
