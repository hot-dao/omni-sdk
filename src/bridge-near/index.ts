import { HereCall } from "@here-wallet/core";
import OmniService from "../bridge";
import { TGAS } from "../utils";
import { ViewFunctionCallOptions } from "near-api-js/lib/account";

class NearBridge {
  constructor(readonly omni: OmniService) {}

  get near() {
    return this.omni.signers.near;
  }

  get address() {
    return this.near.accountId;
  }

  viewFunction(options: ViewFunctionCallOptions) {
    return this.near.viewFunction(options);
  }

  callTransaction(options: HereCall) {
    return this.near.callTransaction(options);
  }

  async parseWithdrawalNonce(tx: string) {
    const receipt = await this.near.connection.provider.txStatusReceipts(tx, this.near.accountId, "EXECUTED_OPTIMISTIC");

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

  async getTokenBalance(token: string, address?: string) {
    if (token === "native") {
      const balance = await this.near.connection.provider.query<any>({
        request_type: "view_account",
        account_id: address || this.address,
        finality: "optimistic",
      });

      return BigInt(balance.amount);
    }

    return await this.near.viewFunction({
      args: { account_id: address || this.address },
      methodName: "ft_balance_of",
      contractId: token,
    });
  }

  async getRegisterTokenTrx(token: string, address = this.near.accountId, deposit?: string): Promise<HereCall | null> {
    const storage = await this.near.viewFunction({ args: { account_id: address }, methodName: "storage_balance_of", contractId: token });
    if (storage != null) return null;

    return {
      signerId: this.near.accountId,
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

  public async getWrapNearDepositAction(amount: string | bigint) {
    const storage = await this.near.viewFunction({
      contractId: "wrap.near",
      methodName: "storage_balance_of",
      args: { account_id: this.near.accountId },
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
          args: { account_id: this.near.accountId, registration_only: true },
        },
      },
      depositAction,
    ];
  }
}

export default NearBridge;
