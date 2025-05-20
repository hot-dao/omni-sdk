import { useTonConnectUI, useTonWallet, TonConnect } from "@tonconnect/ui-react";
import { Address, SenderArguments } from "@ton/ton";
import "@hot-wallet/sdk/adapter/ton";

import { useBridge } from "./bridge";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const connector = new TonConnect({
  walletsListSource: "/wallets-v2.json",
});

const useTon = () => {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const { bridge } = useBridge();

  const waitNextSeqno = async (seqno: number) => {
    await wait(3000);
    const nextSeqno = await bridge.ton.tonApi.wallet
      .getAccountSeqno(Address.parse(wallet!.account.address))
      .catch(() => ({ seqno: 0 }));

    if (seqno >= nextSeqno.seqno) return await waitNextSeqno(seqno);
    return nextSeqno.seqno;
  };

  const waitTransactionByMessageHash = async (
    pending: { prevHash: string; seqno: number; timestamp: number; lt: bigint },
    attemps = 0
  ): Promise<string> => {
    if (attemps > 3) return "";

    await wait(5000);
    const res = await bridge.ton.tonApi.blockchain.getBlockchainAccountTransactions(
      Address.parse(wallet!.account.address),
      { limit: 1, after_lt: BigInt(pending.lt) }
    );

    const tx = res.transactions[0];
    if (tx.hash === pending.prevHash) return await waitTransactionByMessageHash(pending, attemps + 1);
    if (!tx.success) throw tx.computePhase?.exitCodeDescription || "Transaction failed";
    return tx.hash;
  };

  return {
    wallet,
    address: wallet ? Address.parse(wallet.account.address).toString({ bounceable: false }) : undefined,
    signIn: () => tonConnectUI.openModal(),
    signOut: () => tonConnectUI.disconnect(),

    sendTransaction: async (tx: SenderArguments) => {
      if (!wallet) throw new Error("Wallet not found");

      const response = await bridge.ton.tonApi.blockchain.getBlockchainAccountTransactions(
        Address.parse(wallet.account.address),
        { limit: 1 }
      );

      const { seqno } = await bridge.ton.tonApi.wallet.getAccountSeqno(Address.parse(wallet.account.address));
      const lastTransaction = response.transactions[0];
      await tonConnectUI.sendTransaction({
        validUntil: Date.now() + 200000,
        messages: [
          {
            address: tx.to.toString({ bounceable: tx.bounce ? true : false }),
            payload: tx.body?.toBoc().toString("base64"),
            stateInit: tx.init?.data?.toBoc().toString("base64"),
            amount: String(tx.value),
          },
        ],
      });

      await waitNextSeqno(seqno);
      return await waitTransactionByMessageHash({
        timestamp: Date.now(),
        lt: lastTransaction.lt,
        prevHash: lastTransaction.hash,
        seqno,
      });
    },

    signIntent: () => {
      throw new Error("Not implemented");
    },
  };
};

export { useTon as useTonWallet };
