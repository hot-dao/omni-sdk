import { toOmniIntent } from "../utils";
import OmniService from "../bridge";
import { ReviewFee, ReviewFeeOptions } from "../fee";

export class BasePoaOmniService {
  readonly getTransferFee: (receiver: string, amount: bigint) => Promise<ReviewFeeOptions>;
  readonly transfer: (receiver: string, amount: bigint, fee: ReviewFeeOptions) => Promise<string>;
  readonly chain: number;

  constructor(
    readonly omni: OmniService,
    options: {
      chain: number;
      getTransferFee: (receiver: string, amount: bigint) => Promise<ReviewFeeOptions>;
      transfer: (receiver: string, amount: bigint, fee: ReviewFeeOptions) => Promise<string>;
    }
  ) {
    this.getTransferFee = options.getTransferFee;
    this.transfer = options.transfer;
    this.chain = options.chain;
  }

  async getDepositFee(intentAccount: string, amount: bigint): Promise<ReviewFee> {
    const receiver = await this.omni.poa.getDepositAddress(intentAccount, this.chain);
    const review = await this.getTransferFee(receiver, amount);
    return ReviewFee.fromReview(review);
  }

  async deposit(args: { chain: number; token: string; amount: bigint; sender: string; intentAccount: string; fee: ReviewFeeOptions }): Promise<string | null> {
    if (!this.omni.poa.getPoaId(args.chain, args.token)) throw "Unsupported token";

    const intent = toOmniIntent(args.chain, args.token);
    const receiver = await this.omni.poa.getDepositAddress(args.intentAccount, args.chain);
    const balanceBefore = await this.omni.getIntentBalance(intent, args.intentAccount);

    await this.transfer(receiver, args.amount, args.fee);
    await this.omni.waitUntilBalance(intent, balanceBefore + args.amount, args.intentAccount);
    return null;
  }
}
