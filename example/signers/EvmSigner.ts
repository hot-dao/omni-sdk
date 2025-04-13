import { SigningKey, TransactionRequest, Wallet } from "ethers";

export default class EvmSigner {
  wallet: Wallet;

  constructor(key: string | SigningKey) {
    this.wallet = new Wallet(key);
  }

  async getIntentAccount(): Promise<string> {
    return this.wallet.address;
  }

  async signIntent(intent: any): Promise<any> {
    return; //
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
