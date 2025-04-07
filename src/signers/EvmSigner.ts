import { SigningKey, TransactionRequest, TransactionResponse, Wallet } from "ethers";

export default class EvmSigner {
  wallet: Wallet;
  rpcs: Record<number, string[]> = {};

  constructor(key: string | SigningKey) {
    this.wallet = new Wallet(key);
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
