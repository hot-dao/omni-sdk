import {
  ISupportedWallet,
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  HOTWALLET_ID,
} from "@creit.tech/stellar-wallets-kit";
import { Networks, Transaction } from "@stellar/stellar-sdk";
import { useState } from "react";
import { bridge } from "./bridge";

const kit: StellarWalletsKit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  selectedWalletId: HOTWALLET_ID,
  modules: allowAllModules(),
});

export const useStellarWallet = () => {
  const [wallet, setWallet] = useState<ISupportedWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  return {
    wallet,
    address,
    signIn: async () => {
      await kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          setAddress(address);
          setWallet(option);
        },
      });
    },

    signOut: () => {
      kit.disconnect();
      setWallet(null);
      setAddress(null);
    },

    sendTransaction: async (tx: Transaction) => {
      if (!wallet) throw new Error("Wallet not found");

      const result = await kit.signTransaction(tx.toXDR());
      const txObject = new Transaction(result.signedTxXdr, Networks.PUBLIC);
      const { hash } = await bridge.stellar.callHorizon((t) => t.submitTransaction(txObject));
      return hash;
    },

    signIntent: () => {
      throw new Error("Not implemented");
    },
  };
};
