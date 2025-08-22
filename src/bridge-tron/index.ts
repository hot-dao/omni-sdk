import { Contract, ethers } from "ethers";

import { bigIntMin, toOmniIntent } from "../utils";
import { Network } from "../types";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";

export class TronOmniService {
  constructor(readonly omni: OmniService, options: { enableApproveMax?: boolean; contract?: string; rpcs?: Record<number, string[]> | ((chain: number) => ethers.AbstractProvider) }) {}

  async getDepositFee(chain: number, address: string, amount: bigint, sender: string): Promise<ReviewFee> {
    const fee = await this.getGasPrice(chain);
    const gasLimit = await this.depositEstimateGas(chain, address, amount, sender);
    return fee.changeGasLimit(gasLimit);
  }

  async getTokenBalance(token: string, address: string): Promise<bigint> {
    const provider = this.getProvider(chain);
    if (token === "native") return await provider.getBalance(address);
    const contract = new Contract(token, ERC20_ABI, provider);
    const result = await contract.balanceOf(address);
    return BigInt(result);
  }

  async deposit(args: {
    chain: number;
    token: string;
    amount: bigint;
    sender: string;
    intentAccount: string;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  }): Promise<string | null> {
    if (this.omni.poa.getPoaId(args.chain, args.token)) {
      const intent = toOmniIntent(args.chain, args.token);
      const receiver = await this.omni.poa.getDepositAddress(args.intentAccount, args.chain);
      const balanceBefore = await this.omni.getIntentBalance(intent, args.intentAccount);
      const { amount } = await this.transfer({ ...args, receiver });
      await this.omni.waitUntilBalance(intent, balanceBefore + amount, args.intentAccount);
      return null;
    }

    throw "Unsupported token";
  }

  async transfer(args: { sender: string; chain: number; token: string; amount: bigint; receiver: string; sendTransaction: (tx: ethers.TransactionRequest) => Promise<string> }) {
    const balance = await this.getTokenBalance(args.token, args.chain, args.sender);

    const amount = bigIntMin(balance, args.amount);
    if (amount === 0n) throw "Insufficient balance";

    if (args.token === "native") {
      const hash = await args.sendTransaction({ from: args.sender, value: amount, to: args.receiver, chainId: args.chain });
      return { hash, amount };
    }

    const erc20 = new ethers.Contract(args.token, ERC20_ABI, this.getProvider(args.chain));
    const tx = await erc20.transfer.populateTransaction(args.receiver, amount);
    const hash = await args.sendTransaction(tx);
    return { amount, hash };
  }
}
