import { setupWalletSelector, Wallet } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";

import "@near-wallet-selector/modal-ui/styles.css";
import { SignMessageMethod } from "@near-wallet-selector/core/src/lib/wallet/wallet.types";
import { base_encode } from "near-api-js/lib/utils/serialize";
import { Action } from "near-api-js/lib/transaction";
import { useEffect } from "react";
import { useState } from "react";

export async function initNearWallet() {
  const selector = await setupWalletSelector({
    network: "mainnet",
    modules: [setupHotWallet()],
  });

  const modal = setupModal(selector, { contractId: "" });
  return { selector, modal };
}

export class NearWallet {
  constructor(readonly wallet: Wallet & SignMessageMethod, readonly accountId: string) {}

  async getAccountId() {
    const accounts = await this.wallet.getAccounts();
    return accounts[0].accountId;
  }

  async getIntentAccount(): Promise<string> {
    return this.getAccountId();
  }

  async signIntent(intent: { nonce: string; [k: string]: any }) {
    const message = intent.message;
    const result = await this.wallet.signMessage({
      nonce: Buffer.from(intent.nonce, "base64"),
      recipient: "intents.near",
      message: message,
    });

    if (!result) {
      throw new Error("Failed to sign message");
    }

    const { signature, publicKey } = result;
    return {
      standard: "nep413",
      payload: { nonce: intent.nonce, recipient: "intents.near", message },
      signature: "ed25519:" + base_encode(Buffer.from(signature, "base64")),
      public_key: publicKey,
    };
  }

  sendTransaction({ receiverId, actions }: { receiverId: string; actions: Action[] }) {
    return this.wallet.signAndSendTransaction({
      receiverId,
      signerId: this.accountId!,
      actions: [
        {
          type: "FunctionCall",
          params: {
            args: JSON.parse(Buffer.from(actions[0].functionCall!.args).toString("utf8")),
            gas: actions[0].functionCall!.gas.toString(),
            deposit: actions[0].functionCall!.deposit.toString(),
            methodName: actions[0].functionCall!.methodName,
          },
        },
      ],
    });
  }

  async signOut() {
    await this.wallet.signOut();
  }

  static async restore() {
    const { selector } = await initNearWallet();
    const wallet = await selector.wallet();
    const accounts = await wallet.getAccounts();
    const accountId = accounts[0].accountId;
    return new NearWallet(wallet, accountId);
  }

  static async connect() {
    const { modal } = await initNearWallet();
    modal.show();
  }
}

export const useNearWallet = () => {
  const [wallet, setWallet] = useState<NearWallet | null>(null);

  useEffect(() => {
    NearWallet.restore().then(setWallet);
    initNearWallet().then(({ selector }) => {
      selector.on("signedIn", async ({ accounts }) => {
        const wallet = await selector.wallet();
        const accountId = accounts[0].accountId;
        setWallet(new NearWallet(wallet, accountId));
      });
    });
  }, []);

  const signOut = async () => {
    if (wallet) {
      await wallet.signOut();
      setWallet(null);
    }
  };

  const signIn = async () => {
    const { modal } = await initNearWallet();
    modal.show();
  };

  return { wallet, signIn, signOut };
};
