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
import { randomBytes } from "ethers";

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

  const signIntents = async (intents: Record<string, any>[]) => {
    if (!wallet) throw "Wallet not connected";

    const message = JSON.stringify({
      deadline: new Date(Date.now() + 60_000).toISOString(),
      signer_id: accountId,
      intents: intents,
    });

    const nonce = Buffer.from(randomBytes(32));
    const result = await wallet.signMessage?.({ nonce: nonce, recipient: "intents.near", message: message });
    if (!result) throw new Error("Failed to sign message");

    const { signature, publicKey } = result;
    return {
      standard: "nep413",
      payload: { nonce: nonce.toString("base64"), recipient: "intents.near", message },
      signature: "ed25519:" + base_encode(Buffer.from(signature, "base64")),
      public_key: publicKey,
    };
  };

  const sendTransaction = async ({
    receiverId,
    actions,
  }: {
    receiverId: string;
    actions: Action[];
  }): Promise<string> => {
    if (!wallet) throw "Wallet not connected";
    const tx = await wallet.signAndSendTransaction({
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

    if (!tx) throw "Failed to send transaction";
    return tx.transaction.hash;
  };

  return {
    signIn,
    signOut,
    sendTransaction,
    signIntents,
    accountId,
    intentAccount: accountId,
  };
};
