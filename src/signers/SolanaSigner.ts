import AdvancedConnection from "solana-advanced-connection";
import * as sol from "@solana/web3.js";
import { baseDecode } from "@near-js/utils";

export default class SolanaSigner {
  private readonly keyPair: sol.Keypair;
  readonly connection: AdvancedConnection;

  constructor(secretKey: string, rpc: string[]) {
    this.keyPair = sol.Keypair.fromSecretKey(baseDecode(secretKey));
    this.connection = new AdvancedConnection(rpc);
  }

  get publicKey(): sol.PublicKey {
    return this.keyPair.publicKey;
  }

  get address(): string {
    return this.publicKey.toBase58();
  }

  async sendInstructions(args: {
    instructions: sol.TransactionInstruction[];
    table?: sol.AddressLookupTableAccount[];
    onHash?: (hash: string) => void;
    signers?: sol.Keypair[];
  }) {
    const tx = new sol.Transaction();
    args.instructions.map((t) => tx.add(t));
    if (args.signers) tx.sign(...args.signers);
    return await sol.sendAndConfirmTransaction(this.connection, tx, [this.keyPair]);
  }

  async signTransaction<T extends sol.Transaction | sol.VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof sol.VersionedTransaction) {
      tx.sign([this.keyPair]);
      return tx;
    }

    tx.partialSign(this.keyPair);
    return tx;
  }

  async signAllTransactions<T extends sol.Transaction | sol.VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}
