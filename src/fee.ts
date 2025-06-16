import { FeeData } from "ethers";
import { Network } from "./types";

export interface FeeOption {
  baseFee: bigint;
  priorityFee?: bigint;
}

interface ReviewFeeOptions {
  chain: number;
  baseFee?: bigint;
  gasLimit?: bigint;
  priorityFee?: bigint;

  options?: FeeOption[];
  additional?: bigint;
  reserve?: bigint;
  gasless?: boolean;
  token?: string;

  legacyEvm?: boolean;
}

export class ReviewFee implements ReviewFeeOptions {
  options?: FeeOption[] | undefined;
  additional?: bigint | undefined;
  gasless?: boolean | undefined;
  token?: string | undefined;
  legacyEvm?: boolean | undefined;

  chain: number;
  baseFee: bigint;
  gasLimit: bigint;
  reserve: bigint;
  priorityFee: bigint;

  constructor(options: ReviewFeeOptions) {
    this.chain = options.chain;
    this.baseFee = options.baseFee ?? 0n;
    this.gasLimit = options.gasLimit || 1n;
    this.reserve = options.reserve ?? 0n;
    this.priorityFee = options.priorityFee ?? 0n;
    this.additional = options.additional;
    this.options = options.options;
    this.legacyEvm = options.legacyEvm;
  }

  changePriorityFee(priorityFee: bigint) {
    this.priorityFee = priorityFee;
    return new ReviewFee(this);
  }

  changeGasLimit(gasLimit: bigint) {
    this.gasLimit = gasLimit;
    return new ReviewFee(this);
  }

  changeReserve(reserve: bigint) {
    this.reserve = reserve;
    return new ReviewFee(this);
  }

  get gasPrice() {
    if (this.chain === Network.Solana) {
      return this.gasLimit * this.priorityFee + this.baseFee;
    }

    return this.gasLimit * (this.priorityFee + this.baseFee);
  }

  get needNative() {
    if (this.gasless) return 0n;
    return this.gasPrice + this.reserve + (this.additional ?? 0n);
  }

  get evmGas() {
    if (this.legacyEvm) {
      return { gasPrice: this.baseFee + this.priorityFee };
    }

    return {
      maxFeePerGas: this.baseFee + this.priorityFee,
      maxPriorityFeePerGas: this.priorityFee,
    };
  }

  static fromFeeData(feeData: FeeData, chain: number) {
    const feeDatas = "feeDatas" in feeData ? (feeData.feeDatas as FeeData[]) : [feeData];
    const options = feeDatas.map((feeData) => {
      if (feeData.maxFeePerGas == null || feeData.maxPriorityFeePerGas == null) {
        return { baseFee: 0n, priorityFee: feeData.gasPrice || 0n };
      }

      const baseFee = feeData.maxFeePerGas - feeData.maxPriorityFeePerGas;
      return { baseFee, priorityFee: feeData.maxPriorityFeePerGas || 0n };
    });

    return new ReviewFee({ ...options[0], legacyEvm: options[0].priorityFee == null, options, chain });
  }
}
