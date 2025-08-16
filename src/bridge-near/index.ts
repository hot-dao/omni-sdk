import type { Action } from "@near-js/transactions";
import { JsonRpcProvider } from "@near-js/providers";

import { TGAS } from "../fee";
import OmniService from "../bridge";
import { functionCall } from "../utils";
import NearRpcProvider from "./provider";

interface ViewFunctionCallOptions {
  contractId: string;
  methodName: string;
  args?: object;
}

class NearBridge {
  rpc: JsonRpcProvider;
  constructor(readonly omni: OmniService, rpc?: JsonRpcProvider | string[]) {
    this.rpc = Array.isArray(rpc) ? new NearRpcProvider(rpc) : rpc || new NearRpcProvider();
  }

  get logger() {
    return this.omni.logger;
  }

  async viewFunction(options: ViewFunctionCallOptions) {
    const payload = Buffer.from(JSON.stringify(options.args), "utf8").toString("base64");
    const data: any = await this.rpc.query({
      args_base64: payload,
      finality: "optimistic",
      request_type: "call_function",
      method_name: options.methodName,
      account_id: options.contractId,
    });

    return JSON.parse(Buffer.from(data.result).toString("utf8"));
  }

  async deposit(args: {
    token: string;
    amount: bigint;
    sender: string;
    intentAccount: string;
    sendTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<string>;
  }) {
    let depositWnear: Action[] = [];
    if (args.token === "native") {
      this.logger?.log(`Wrapping native NEAR`);
      depositWnear = await this.getWrapNearDepositAction(args.amount, args.sender);
    }

    this.logger?.log(`Depositing token to HOT Bridge`);
    const token = args.token === "native" ? "wrap.near" : args.token;
    const actions = [
      ...depositWnear,
      functionCall({
        args: { amount: args.amount, receiver_id: "intents.near", msg: args.intentAccount },
        methodName: "ft_transfer_call",
        gas: String(80n * TGAS),
        deposit: "1",
      }),
    ];

    return await args.sendTransaction({ actions, receiverId: token });
  }

  async parseWithdrawalNonce(tx: string, sender: string) {
    const nonces = await this.parseWithdrawalNonces(tx, sender);
    if (nonces.length === 0) throw `Nonce not found`;
    return nonces[0].toString();
  }

  async parseWithdrawalNonces(tx: string, sender: string): Promise<bigint[]> {
    const receipt = await this.rpc.txStatusReceipts(tx, sender, "EXECUTED_OPTIMISTIC");
    const nonces: bigint[] = [];

    for (const item of receipt.receipts_outcome) {
      for (const log of item.outcome.logs) {
        const nonce = `${log}`.match(/"memo":"(\d+)"/)?.[1];
        if (nonce) nonces.push(BigInt(nonce));
      }
    }

    return nonces;
  }

  async getTokenBalance(token: string, address: string) {
    if (token === "native") {
      const balance = await this.rpc.query<any>({ request_type: "view_account", account_id: address, finality: "optimistic" });
      return BigInt(balance.amount);
    }

    return await this.viewFunction({
      args: { account_id: address },
      methodName: "ft_balance_of",
      contractId: token,
    });
  }

  async isTokenRegistered(token: string, address: string) {
    const storage = await this.viewFunction({ args: { account_id: address }, methodName: "storage_balance_of", contractId: token });
    return storage != null;
  }

  public async getWrapNearDepositAction(amount: string | bigint, address: string) {
    const storage = await this.viewFunction({
      contractId: "wrap.near",
      methodName: "storage_balance_of",
      args: { account_id: address },
    });

    const depositAction = functionCall({
      methodName: "near_deposit",
      deposit: amount.toString(),
      gas: String(50n * TGAS),
      args: {},
    });

    if (storage != null) return [depositAction];

    return [
      functionCall({
        gas: String(30n * TGAS),
        methodName: "storage_deposit",
        deposit: "12500000000000000000000",
        args: { account_id: address, registration_only: true },
      }),
      depositAction,
    ];
  }
}

export default NearBridge;
