import { ViewFunctionCallOptions } from "near-api-js/lib/account";
import { HereCall } from "@here-wallet/core";

import OmniService from "../bridge";
import { TGAS } from "../utils";
import NearRpcProvider from "./provider";

class NearBridge {
  readonly rpc: NearRpcProvider;
  constructor(readonly omni: OmniService) {
    this.rpc = new NearRpcProvider(this.omni.signers.near!.rpcs);
  }

  get near() {
    return this.omni.signers.near;
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

    if (transfer == null) throw `Nonce not found, contact support please`;
    return transfer.nonce;
  }

  async getTokenBalance(token: string, address: string) {
    if (token === "native") {
      const balance = await this.rpc.query<any>({ request_type: "view_account", account_id: address, finality: "optimistic" });
      return BigInt(balance.amount);
    }

    return await this.viewFunction({ args: { account_id: address }, methodName: "ft_balance_of", contractId: token });
  }

  async getRegisterTokenTrx(token: string, address: string, deposit?: string): Promise<HereCall | null> {
    const storage = await this.viewFunction({ args: { account_id: address }, methodName: "storage_balance_of", contractId: token });
    if (storage != null) return null;

    return {
      receiverId: token,
      actions: [
        {
          type: "FunctionCall",
          params: {
            gas: String(10n * TGAS),
            methodName: "storage_deposit",
            deposit: deposit || "12500000000000000000000",
            args: {
              account_id: address,
              registration_only: true,
            },
          },
        },
      ],
    };
  }

  public async getWrapNearDepositAction(amount: string | bigint, address: string) {
    const storage = await this.viewFunction({
      contractId: "wrap.near",
      methodName: "storage_balance_of",
      args: { account_id: address },
    });

    const depositAction = {
      type: "FunctionCall",
      params: {
        methodName: "near_deposit",
        deposit: amount.toString(),
        gas: String(50n * TGAS),
        args: {},
      },
    };

    if (storage != null) return [depositAction];
    return [
      {
        type: "FunctionCall",
        params: {
          gas: String(30n * TGAS),
          methodName: "storage_deposit",
          deposit: "12500000000000000000000",
          args: { account_id: address, registration_only: true },
        },
      },
      depositAction,
    ];
  }
}

export default NearBridge;
