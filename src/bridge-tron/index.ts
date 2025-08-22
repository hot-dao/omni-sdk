import { TronWeb } from "tronweb";
import { Transaction, TransactionWrapper } from "tronweb/lib/esm/types";

import { toOmniIntent, wait } from "../utils";
import { Network } from "../types";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";
import { trc20 } from "./trc20";

export class TronOmniService {
  readonly client: TronWeb;
  constructor(readonly omni: OmniService, options: { client?: TronWeb }) {
    this.client = options.client || new TronWeb({ fullHost: "https://api.trongrid.io" });
  }

  async getDepositFee(token: string, sender: string): Promise<ReviewFee> {
    return this.transferFee(sender, token, sender);
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

    const { transaction } = await this.client.transactionBuilder.triggerSmartContract(args.token, "transfer(address,uint256)", { feeLimit: 20_000, callValue: 0 }, abiParams, args.sender);
    const hash = await args.sendTransaction(transaction);
    const result = await this.waitTransaction(hash);
    return result;
  }

  async getResources(sender: string) {
    const res = await this.client.trx.getAccountResources(sender);
    return {
      bandwith: (res.NetLimit || 0) - (res.NetUsed || 0) + (res.freeNetLimit || 0) - (res.freeNetUsed || 0),
      energy: (res.EnergyLimit || 0) - (res.EnergyUsed || 0),
    };
  }

  private feeConstants: Promise<{ energy: number; bandwidth: number }> | null = null;
  async getFeeConstants() {
    if (this.feeConstants) return await this.feeConstants;

    this.feeConstants = (async () => {
      const energyData = await this.client.trx.getEnergyPrices();
      const bandwidthData = await this.client.trx.getBandwidthPrices();
      const energy = energyData.split(",").pop()?.split(":").pop() || 420;
      const bandwidth = bandwidthData.split(",").pop()?.split(":").pop() || 1000;
      return { energy: +energy, bandwidth: +bandwidth };
    })();

    return await this.feeConstants;
  }

  async getContractFee(_: string, tx: TransactionWrapper, userFee = 1) {
    const prices = await this.getFeeConstants();
    const bandwith = tx.transaction.raw_data_hex.length / 2 + 64 + 67 + 3;
    const need = (tx.energy_used || 0) * prices.energy;
    return (need * userFee + bandwith * prices.bandwidth) / 1_000_000;
  }

  async transferFee(sender: string, token: string, receiver: string): Promise<ReviewFee> {
    if (token === "native") {
      const isExist = await this.client.trx.getAccount(receiver).catch(() => {});
      const reserve = Object.keys(isExist || {}).length > 0 ? 1300000n : 300000n;
      return new ReviewFee({ reserve, gasLimit: reserve, baseFee: 1n, chain: Network.Tron });
    }

    const functionSelector = "transfer(address,uint256)";
    const parameters = [
      { type: "address", value: receiver },
      { type: "uint256", value: 1n },
    ];

    const estimate = await this.client.transactionBuilder.triggerConstantContract(token, functionSelector, {}, parameters, sender);
    const reserve = BigInt(Math.floor((await this.getContractFee(token, estimate)) * 1_000_000));
    return new ReviewFee({ gasLimit: reserve, baseFee: 1n, chain: Network.Tron });
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
