import { SigningKey, TransactionRequest, Wallet, JsonRpcProvider } from "ethers";

export default class EvmSigner {
  wallet: Wallet;

  constructor(key: string | SigningKey) {
    this.wallet = new Wallet(key, new JsonRpcProvider("https://api0.herewallet.app/api/v1/evm/rpc/8453"));
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
