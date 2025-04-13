import { baseDecode, baseEncode } from "@near-js/utils";
import { authPayloadSchema, createAction, HereCall, SignMessageOptionsNEP0413 } from "@here-wallet/core";
import { Account, Connection, InMemorySigner, KeyPair } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { PublicKey } from "near-api-js/lib/utils";
import { serialize } from "borsh";

import NearRpcProvider from "../../src/bridge-near/provider";

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
  readonly rpcs: string[] = [];

  constructor(accountId: string, privateKey: string, rpcs?: string[]) {
    const rpc = new NearRpcProvider(rpcs);
    const signer = new KeySingleNearSigner(accountId, privateKey);
    const config = Connection.fromConfig({ signer, jsvmAccountId: "jsvm.mainnet", networkId: "mainnet", provider: rpc });

    super(config, accountId);
    this.rpcs = rpcs || rpc.providers;
    this.signer = signer;
  }

  async getAddress(): Promise<string> {
    return this.accountId;
  }

  async getIntentAccount(): Promise<string> {
    return this.accountId;
  }

  async signIntent(intent: { nonce: string; [k: string]: any }) {
    const message = JSON.stringify(intent);
    const { signature, publicKey } = await this.signMessage({
      nonce: Buffer.from(intent.nonce, "base64"),
      recipient: "intents.near",
      message: message,
    });

    return {
      standard: "nep413",
      payload: { nonce: intent.nonce, recipient: "intents.near", message },
      signature: "ed25519:" + baseEncode(Buffer.from(signature, "base64")),
      public_key: publicKey,
    };
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

  async sendTransaction(call: HereCall): Promise<string> {
    const actions = call.actions.map((a) => createAction(a));
    const tx = await this.signAndSendTransaction({ receiverId: call.receiverId!, actions });
    return tx.transaction.hash;
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
