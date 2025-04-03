import { baseDecode, baseEncode } from "@near-js/utils";
import { authPayloadSchema, createAction, HereCall, SignMessageOptionsNEP0413 } from "@here-wallet/core";
import { Account, Connection, InMemorySigner, KeyPair } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { PublicKey } from "near-api-js/lib/utils";
import { serialize } from "borsh";

import NearRpcProvider from "../bridge-near/provider";

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
    const config = Connection.fromConfig({ signer, jsvmAccountId: "jsvm.mainnet", networkId: "mainnet", provider: new NearRpcProvider() });
    super(config, accountId);
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
