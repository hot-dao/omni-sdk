import type { FeeData } from "ethers";
import { Network } from "./types";

export interface FeeOption {
  baseFee: bigint;
  priorityFee?: bigint;
}

interface ReviewFeeOptions {
  evm?: "legacy" | "modern" | undefined;

  chain: number;
  baseFee?: bigint;
  gasLimit?: bigint;
  priorityFee?: bigint;

  options?: FeeOption[];
  additional?: bigint;
  reserve?: bigint;
  gasless?: boolean;
  token?: string;
}

export class ReviewFee implements ReviewFeeOptions {
  evm?: "legacy" | "modern" | undefined;

  options?: FeeOption[] | undefined;
  additional?: bigint | undefined;
  gasless?: boolean | undefined;
  token?: string | undefined;

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
    this.gasless = options.gasless ?? false;
    this.additional = options.additional;
    this.options = options.options;
    this.token = options.token;
    this.evm = options.evm;
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
      const fee = BigInt(Math.ceil(Number(this.priorityFee) / 1000000));
      return this.gasLimit * fee + this.baseFee;
    }

    return this.gasLimit * (this.priorityFee + this.baseFee);
  }

  getOptionGasPrice(index: number) {
    if (this.options?.[index] == null) throw "No option";
    const { priorityFee, baseFee } = this.options[index];

    if (this.chain === Network.Solana) {
      const fee = BigInt(Math.ceil(Number(priorityFee) / 1000000));
      return this.gasLimit * fee + baseFee;
    }

    return this.gasLimit * (priorityFee || 0n) + baseFee;
  }

  get needNative() {
    if (this.gasless) return 0n;

    if (this.evm === "modern") {
      const extraGasPrice = this.gasLimit * (this.evmGas.maxFeePerGas || 0n);
      return extraGasPrice + this.reserve + (this.additional ?? 0n);
    }

    return this.gasPrice + this.reserve + (this.additional ?? 0n);
  }

  get evmGas() {
    if (this.evm == null) throw "This chain is not EVM";
    if (this.evm === "legacy") return { gasPrice: this.baseFee + this.priorityFee };

    const maxFeePerGas = (this.baseFee * 14n) / 10n + this.priorityFee;
    return { maxFeePerGas, maxPriorityFeePerGas: this.priorityFee };
  }

  clone() {
    return new ReviewFee(this);
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

    return new ReviewFee({
      ...options[0],
      evm: options[0].priorityFee == null ? "legacy" : "modern",
      options,
      chain,
    });
  }
}
