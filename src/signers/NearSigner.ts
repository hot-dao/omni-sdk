import { baseDecode, baseEncode } from "@near-js/utils";
import { authPayloadSchema, createAction, HereCall, SignMessageOptionsNEP0413 } from "@here-wallet/core";
import { Account, Connection, InMemorySigner, KeyPair } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { PublicKey } from "near-api-js/lib/utils";
import { serialize } from "borsh";

import NearRpcProvider from "./NearRpcProvider";
import { TGAS } from "../utils";

const rpc = new NearRpcProvider();

export class KeySingleNearSigner extends InMemorySigner {
  private readonly keyPair: KeyPair;
  readonly publicKey: PublicKey;
  readonly privateKey: Buffer;

  constructor(readonly accountId: string, privateKey: string) {
    const keyPair = KeyPair.fromString(`ed25519:${privateKey}`);
    const keyStore = new InMemoryKeyStore();
    keyStore.setKey("mainnet", accountId, keyPair);

    super(keyStore);
    this.publicKey = keyPair.getPublicKey();
    this.privateKey = Buffer.from(baseDecode(keyPair.toString().split(":")[1]));
    this.keyPair = keyPair;
  }

  sign(msg: Buffer) {
    return baseEncode(this.keyPair.sign(msg).signature);
  }
}

export default class NearSigner extends Account {
  readonly signer: KeySingleNearSigner;
  constructor(accountId: string, privateKey: string) {
    const signer = new KeySingleNearSigner(accountId, privateKey);
    super(Connection.fromConfig({ signer, jsvmAccountId: "jsvm.mainnet", networkId: "mainnet", provider: rpc }), accountId);
    this.signer = signer;
  }

  async signMessage(config: SignMessageOptionsNEP0413) {
    const payload = new SignPayload({
      message: config.message,
      nonce: Array.from(config.nonce),
      recipient: config.recipient,
    });

    const borshPayload = serialize(authPayloadSchema as any, payload);
    const signature = await this.connection.signer.signMessage(borshPayload, this.accountId, "mainnet");
    const publicKey = await this.connection.signer.getPublicKey(this.accountId, "mainnet");

    const base64 = Buffer.from(signature.signature).toString("base64");
    return { accountId: this.accountId, signature: base64, publicKey: publicKey.toString(), nonce: config.nonce };
  }

  async callTransaction(call: HereCall) {
    const actions = call.actions.map((a) => createAction(a));
    const tx = await this.signAndSendTransaction({ receiverId: call.receiverId!, actions });
    return tx.transaction.hash;
  }

  async getRegisterTokenTrx(token: string, address = this.accountId, deposit?: string): Promise<HereCall | null> {
    if (token === "") return null;
    const storage = await this.viewFunction({
      args: { account_id: address },
      methodName: "storage_balance_of",
      contractId: token,
    }).catch(() => null);

    if (storage != null) return null;

    return {
      signerId: this.accountId,
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
  async getStorageBalance() {
    return;
  }

  public async getWrapNearDepositAction(amount: string | bigint) {
    const storage = await this.viewFunction({
      contractId: "wrap.near",
      methodName: "storage_balance_of",
      args: { account_id: this.accountId },
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
          args: { account_id: this.accountId, registration_only: true },
        },
      },
      depositAction,
    ];
  }
}

export class SignPayload {
  readonly message: string;
  readonly nonce: number[];
  readonly recipient: string;
  readonly tag: number;

  constructor({ message, nonce, recipient }: { message: string; nonce: number[]; recipient: string }) {
    this.tag = 2147484061;
    this.message = message;
    this.nonce = nonce;
    this.recipient = recipient;
  }
}

export const signPayloadSchema = new Map([
  [
    SignPayload,
    {
      kind: "struct",
      fields: [
        ["tag", "u32"],
        ["message", "string"],
        ["nonce", [32]],
        ["recipient", "string"],
        ["callbackUrl", { kind: "option", type: "string" }],
      ],
    },
  ],
]);
