import { SigningKey, Wallet } from "ethers";

export default class EvmSigner extends Wallet {
  constructor(key: string | SigningKey) {
    super(key);
  }
}
