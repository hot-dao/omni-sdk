import { SigningKey, TransactionRequest, Wallet } from "ethers";

export default class EvmSigner {
  wallet: Wallet;

  constructor(key: string | SigningKey) {
    this.wallet = new Wallet(key);
  }

  async getIntentAccount(): Promise<string> {
    throw "Not implemented";
  }

  async signIntent(intent: any): Promise<any> {
    throw "Not implemented";
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  async sendTransaction(tx: TransactionRequest): Promise<string> {
    const transaction = await this.wallet.sendTransaction(tx);
    await transaction.wait();
    return transaction.hash;
  }
}
