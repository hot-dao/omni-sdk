import { baseDecode, baseEncode } from "@near-js/utils";
import { Account, Connection, InMemorySigner, KeyPair } from "near-api-js";
import { InMemoryKeyStore } from "near-api-js/lib/key_stores";
import { PublicKey } from "near-api-js/lib/utils";
import NearRpcProvider from "./NearRpcProvider";

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
  constructor(accountId: string, privateKey: string) {
    super(
      Connection.fromConfig({
        signer: new KeySingleNearSigner(accountId, privateKey),
        jsvmAccountId: "jsvm.mainnet",
        networkId: "mainnet",
        provider: rpc,
      }),
      accountId
    );
  }
}
