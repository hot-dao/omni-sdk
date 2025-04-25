import { Action } from "near-api-js/lib/transaction";
import { transactions } from "near-api-js";

import { TGAS } from "../utils";
import OmniService from "../bridge";
import NearRpcProvider from "./provider";

class NearBridge {
  readonly rpc = new NearRpcProvider();
  constructor(readonly omni: OmniService) {}

  get logger() {
    return this.omni.logger;
  }

  async depositToken(args: {
    token: string;
    amount: bigint;
    getAddress: () => Promise<string>;
    getIntentAccount: () => Promise<string>;
    sendTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<string>;
  }) {
    const token = args.token === "native" ? "wrap.near" : args.token;
    const depositWnear: any[] = [];

    if (token === "wrap.near") {
      this.logger?.log(`Wrapping native NEAR`);
      depositWnear.push(await this.getWrapNearDepositAction(args.amount, await args.getAddress()));
    }

    this.logger?.log(`Depositing token to HOT Bridge`);
    const actions = [
      ...depositWnear,
      this.functionCall({
        args: { amount: args.amount, receiver_id: "intents.near", msg: await args.getIntentAccount() },
        methodName: "ft_transfer_call",
        gas: String(80n * TGAS),
        deposit: "1",
      }),
    ];

    return await args.sendTransaction({ actions, receiverId: token });
  }

  async parseWithdrawalNonce(tx: string, sender: string) {
    const receipt = await this.rpc.txStatusReceipts(tx, sender, "EXECUTED_OPTIMISTIC");
    const transfer = (() => {
      for (let item of receipt.receipts_outcome) {
        for (let log of item.outcome.logs) {
          const nonce = `${log}`.match(/"memo":"(\d+)"/)?.[1];
          if (nonce) return { nonce };
        }
      }
    })();

    if (transfer == null) throw `Nonce not found`;
    return transfer.nonce;
  }

  async getTokenBalance(token: string, address: string) {
    if (token === "native") {
      const balance = await this.rpc.query<any>({ request_type: "view_account", account_id: address, finality: "optimistic" });
      return BigInt(balance.amount);
    }

    return await this.rpc.viewFunction({
      args: { account_id: address },
      methodName: "ft_balance_of",
      contractId: token,
    });
  }

  async getRegisterTokenTrx(token: string, address: string, deposit?: string) {
    const storage = await this.rpc.viewFunction({ args: { account_id: address }, methodName: "storage_balance_of", contractId: token });
    if (storage != null) return null;

    return {
      receiverId: token,
      actions: [
        this.functionCall({
          gas: String(10n * TGAS),
          methodName: "storage_deposit",
          deposit: deposit || "12500000000000000000000",
          args: { account_id: address, registration_only: true },
        }),
      ],
    };
  }

  functionCall(args: { methodName: string; args: any; gas: string; deposit: string }) {
    return transactions.functionCall(
      args.methodName,
      JSON.parse(JSON.stringify(args.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
      BigInt(args.gas),
      BigInt(args.deposit)
    );
  }

  public async getWrapNearDepositAction(amount: string | bigint, address: string) {
    const storage = await this.rpc.viewFunction({
      contractId: "wrap.near",
      methodName: "storage_balance_of",
      args: { account_id: address },
    });

    const depositAction = this.functionCall({
      methodName: "near_deposit",
      deposit: amount.toString(),
      gas: String(50n * TGAS),
      args: {},
    });

    if (storage != null) return [depositAction];

    return [
      this.functionCall({
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
