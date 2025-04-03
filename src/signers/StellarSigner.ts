import { rpc, Horizon, Transaction, FeeBumpTransaction, Keypair } from "@stellar/stellar-sdk";
import { baseDecode } from "@near-js/utils";

class StellarSigner {
  readonly soroban: rpc.Server;
  readonly horizon: Horizon.Server;
  readonly keyPair: Keypair;

  constructor(privateKey: string, horizon = "https://horizon.stellar.org", soroban = "https://mainnet.sorobanrpc.com") {
    this.soroban = new rpc.Server(soroban);
    this.horizon = new Horizon.Server(horizon);
    this.keyPair = Keypair.fromRawEd25519Seed(Buffer.from(baseDecode(privateKey)));
  }

  get address() {
    return this.keyPair.publicKey();
  }

  async signTransaction(tx: Transaction | FeeBumpTransaction) {
    const hash = tx.hash();
    const signature = this.keyPair.signDecorated(hash);
    tx.signatures.push(signature);
  }
}

export default StellarSigner;
