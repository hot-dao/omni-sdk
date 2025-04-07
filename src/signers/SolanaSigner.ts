import AdvancedConnection from "solana-advanced-connection";
import { baseDecode } from "@near-js/utils";
import * as sol from "@solana/web3.js";

export default class SolanaSigner {
  private readonly keyPair: sol.Keypair;
  readonly connection: AdvancedConnection;
  readonly rpcs: string[] = [];

  constructor(secretKey: string, rpc: string[]) {
    this.keyPair = sol.Keypair.fromSecretKey(baseDecode(secretKey));
    this.connection = new AdvancedConnection(rpc);
    this.rpcs = rpc;
  }

  async getAddress(): Promise<string> {
    return this.keyPair.publicKey.toBase58();
  }

  async sendTransaction<T extends sol.Transaction | sol.VersionedTransaction>(tx: T): Promise<string> {
    if (tx instanceof sol.VersionedTransaction) {
      tx.sign([this.keyPair]);
      return await sol.sendAndConfirmTransaction(this.connection, tx as any, [this.keyPair]);
    }

    tx.partialSign(this.keyPair);
    return await sol.sendAndConfirmTransaction(this.connection, tx, [this.keyPair]);
  }
}
