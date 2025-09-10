import { TronWeb } from "tronweb";
import { Transaction } from "tronweb/lib/esm/types";

import { toOmniIntent, wait } from "../utils";
import { Network } from "../types";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";

import { trc20 } from "./trc20";
import { estimateTransferFee } from "./estimate";

export class TronOmniService {
  readonly client: TronWeb;
  constructor(readonly omni: OmniService, options: { client?: TronWeb }) {
    this.client = options.client || new TronWeb({ fullHost: "https://api.trongrid.io" });
  }

  async getDepositFee(token: string, sender: string, intentAccount: string): Promise<ReviewFee> {
    const receiver = await this.omni.poa.getDepositAddress(intentAccount, Network.Tron);
    return this.transferFee(sender, token, receiver);
  }

  async deposit(args: { chain: number; token: string; amount: bigint; sender: string; intentAccount: string; sendTransaction: (tx: Transaction) => Promise<string> }): Promise<string | null> {
    if (!this.omni.poa.getPoaId(args.chain, args.token)) throw "Unsupported token";

    const intent = toOmniIntent(args.chain, args.token);
    const receiver = await this.omni.poa.getDepositAddress(args.intentAccount, args.chain);
    const balanceBefore = await this.omni.getIntentBalance(intent, args.intentAccount);

    await this.transfer({ ...args, receiver, sendTransaction: args.sendTransaction });
    await this.omni.waitUntilBalance(intent, balanceBefore + args.amount, args.intentAccount);
    return null;
  }

  async getTokenBalance(token: string, address: string) {
    if (token === "native") {
      const account = await this.client.trx.getUnconfirmedAccount(address);
      return BigInt(account?.balance || 0n);
    }

    const contract = this.client.contract(trc20, token);
    const balance = await contract.methods.balanceOf(address).call();
    return BigInt(balance.toString());
  }

  async transfer(args: { sender: string; chain: number; token: string; amount: bigint; receiver: string; sendTransaction: (tx: Transaction) => Promise<string> }) {
    if (args.token === "native") {
      const tx = await this.client.transactionBuilder.sendTrx(args.receiver, Number(args.amount), args.sender, {});
      const hash = await args.sendTransaction(tx);
      const result = await this.waitTransaction(hash);
      return result;
    }

    const abiParams: Array<{ type: string; value: string }> = [
      { type: "address", value: args.receiver },
      { type: "uint256", value: args.amount.toString() },
    ];

    const { transaction } = await this.client.transactionBuilder.triggerSmartContract(args.token, "transfer(address,uint256)", { callValue: 0 }, abiParams, args.sender);
    const hash = await args.sendTransaction(transaction);
    const result = await this.waitTransaction(hash);
    return result;
  }

  async transferFee(sender: string, token: string, receiver: string): Promise<ReviewFee> {
    if (token === "native") {
      const isExist = await this.client.trx.getAccount(receiver).catch(() => {});
      const reserve = Object.keys(isExist || {}).length > 0 ? 1300000n : 300000n;
      return new ReviewFee({ reserve, gasLimit: reserve, baseFee: 1n, chain: Network.Tron });
    }

    const estimate = await estimateTransferFee({
      tronWeb: this.client,
      from: sender,
      to: receiver,
      contract: token,
      checkReceiverBalance: true,
    });

    return new ReviewFee({
      gasLimit: estimate.gasLimit,
      reserve: estimate.additionalReserve,
      chain: Network.Tron,
      baseFee: 1n,
    });
  }

  async waitTransaction(hash: string): Promise<string> {
    const waitTx = async (): Promise<string> => {
      await wait(3000);
      const tx: any = await this.client.trx.getTransaction(hash).catch(() => null);
      if (tx == null) return await waitTx();

      const ret: any[] = tx.ret ? (Array.isArray(tx.ret) ? tx.ret : [tx.ret]) : null;
      const isSuccess = ret.every((t) => t.contractRet === "SUCCESS");
      if (isSuccess) return tx.txID;
      throw ret[0]?.contractRet;
    };

    return await waitTx();
  }
}
