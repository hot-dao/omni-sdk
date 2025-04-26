import { useEffect, useState } from "react";
import { setupWalletSelector, Wallet } from "@near-wallet-selector/core";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupLedger } from "@near-wallet-selector/ledger";
import { setupOKXWallet } from "@near-wallet-selector/okx-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { base_encode } from "near-api-js/lib/utils/serialize";
import { Action } from "near-api-js/lib/transaction";
import "@near-wallet-selector/modal-ui/styles.css";

export async function initNearWallet() {
  const selector = await setupWalletSelector({
    modules: [setupHotWallet(), setupLedger(), setupOKXWallet(), setupMeteorWallet()],
    network: "mainnet",
  });

  const modal = setupModal(selector, { contractId: "" });
  return { selector, modal };
}

export const useNearWallet = () => {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    initNearWallet().then(async ({ selector }) => {
      selector.wallet().then(async (wallet) => {
        const accounts = await wallet.getAccounts();
        const accountId = accounts[0].accountId;
        setAccountId(accountId);
        setWallet(wallet);
      });

      selector.on("signedIn", async ({ accounts }) => {
        const wallet = await selector.wallet();
        const accountId = accounts[0].accountId;
        setAccountId(accountId);
        setWallet(wallet);
      });

      selector.on("signedOut", async () => {
        setAccountId(null);
        setWallet(null);
      });
    });
  }, []);

  const signOut = async () => {
    if (!wallet) return;
    await wallet.signOut();
    setWallet(null);
  };

  const signIn = async () => {
    const { modal } = await initNearWallet();
    modal.show();
  };

  const signIntent = async (intent: { nonce: string; [k: string]: any }) => {
    if (!wallet) throw "Wallet not connected";
    const message = intent.message;
    const result = await wallet.signMessage?.({
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
  };

  const sendTransaction = async ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => {
    if (!wallet) throw "Wallet not connected";
    return wallet.signAndSendTransaction({
      receiverId,
      signerId: accountId!,
      actions: actions.map((action) => ({
        type: "FunctionCall",
        params: {
          args: JSON.parse(Buffer.from(action.functionCall!.args).toString("utf8")),
          gas: action.functionCall!.gas.toString(),
          deposit: action.functionCall!.deposit.toString(),
          methodName: action.functionCall!.methodName,
        },
      })),
    });
  };

  return {
    signIn,
    signOut,
    sendTransaction,
    signIntent,
    accountId,
    intentAccount: accountId,
  };
};
