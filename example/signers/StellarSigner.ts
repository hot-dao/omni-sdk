import { rpc, Horizon, Transaction, FeeBumpTransaction, Keypair } from "@stellar/stellar-sdk";
import { baseDecode } from "@near-js/utils";
import { wait } from "../../src/utils";

class StellarSigner {
  readonly soroban: rpc.Server;
  readonly horizon: Horizon.Server;
  readonly keyPair: Keypair;

  readonly rpcs: string[] = [];
  readonly horizonApi: string[] = [];

  constructor(privateKey: string, horizon = "https://horizon.stellar.org", soroban = "https://mainnet.sorobanrpc.com") {
    this.soroban = new rpc.Server(soroban);
    this.horizon = new Horizon.Server(horizon);
    this.keyPair = Keypair.fromRawEd25519Seed(Buffer.from(baseDecode(privateKey)));
    this.rpcs = [soroban];
    this.horizonApi = [horizon];
  }

  async getIntentAccount(): Promise<string> {
    throw "Not implemented";
  }

  async signIntent(intent: any): Promise<any> {
    throw "Not implemented";
  }

  async getAddress() {
    return this.keyPair.publicKey();
  }

  async signTransaction(tx: Transaction | FeeBumpTransaction) {
    const hash = tx.hash();
    const signature = this.keyPair.signDecorated(hash);
    tx.signatures.push(signature);
  }

  async sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<string> {
    this.signTransaction(tx);
    const res = await this.soroban.sendTransaction(tx);
    if (res.status === "ERROR") throw `Transaction failed`;

    const poolTransaction = async (attempts = 0) => {
      if (attempts > 20) throw `Transaction failed`;
      await wait(2000);

      const status = await this.soroban.getTransaction(res.hash).catch(() => null);
      if (status?.status === "SUCCESS") return res.hash;
      await poolTransaction(attempts + 1);
    };

    await poolTransaction();
    return res.hash;
  }
}

export default StellarSigner;
