import { Contract, ethers, getBytes, hexlify, Interface, MaxUint256, TransactionReceipt, VoidSigner } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";

import { ERC20_ABI, OMNI_ABI, OMNI_DEPOSIT_FT, OMNI_DEPOSIT_LOG, OMNI_DEPOSIT_NATIVE } from "./constants";
import { encodeTokenAddress, omniEphemeralReceiver, wait } from "../utils";
import { Network, PendingDeposit, WithdrawArgs } from "../types";
import { DepositNotFoundError } from "../errors";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";

const getProvider =
  (rpcs: Record<number, string[]>) =>
  (chain: number): ethers.AbstractProvider => {
    if (!rpcs[chain]) throw `No rpc for chain ${chain}`;
    const list = Array.isArray(rpcs[chain]) ? rpcs[chain] : [rpcs[chain]];
    const provider = list.map((rpc) => new ethers.JsonRpcProvider(rpc, chain, { staticNetwork: true }));
    return new ethers.FallbackProvider(provider, chain, {});
  };

class EvmOmniService {
  getProvider: (chain: number) => ethers.AbstractProvider;
  readonly contract: string;
  readonly enableApproveMax: boolean;

  constructor(readonly omni: OmniService, options: { enableApproveMax?: boolean; contract?: string; rpcs?: Record<number, string[]> | ((chain: number) => ethers.AbstractProvider) }) {
    this.getProvider = typeof options.rpcs === "function" ? options.rpcs : getProvider(options.rpcs || {});
    this.contract = options?.contract || "0x233c5370CCfb3cD7409d9A3fb98ab94dE94Cb4Cd";
    this.enableApproveMax = options.enableApproveMax ?? false;
  }

  async getGasPrice(chain: number): Promise<ReviewFee> {
    const feeData = await this.getProvider(chain).getFeeData();
    return ReviewFee.fromFeeData(feeData, chain);
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee(chain: number): Promise<ReviewFee> {
    const fee = await this.getGasPrice(chain);
    return fee.changeGasLimit(200_000n);
  }

  async getDepositFee(chain: number, address: string, amount: bigint, sender: string): Promise<ReviewFee> {
    const fee = await this.getGasPrice(chain);
    const gasLimit = await this.depositEstimateGas(chain, address, amount, sender);
    return fee.changeGasLimit(gasLimit);
  }

  async approveTokenEstimate(args: { chain: number; sender: string; token: string; allowed: string; need: bigint }) {
    const { chain, token, allowed, need } = args;
    const provider = this.getProvider(chain);
    const signer = new VoidSigner(args.sender, provider);

    const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
    const allowance = await erc20.allowance(args.sender, args.allowed);
    if (allowance >= need) return 0n;

    return await erc20.approve.estimateGas(allowed, MaxUint256);
  }

  async depositEstimateGas(chain: number, address: string, amount: bigint, sender: string) {
    const provider = this.getProvider(chain);
    const signer = new VoidSigner(sender, provider);

    if (address === "native") {
      const contract = new Contract(this.contract, [OMNI_DEPOSIT_NATIVE], signer);
      return contract.deposit.estimateGas(sender, { value: amount });
    }

    const approved = await this.approveTokenEstimate({ sender, chain, token: address, allowed: this.contract, need: amount });
    if (approved) return approved + (chain == Network.Arbitrum ? 400_000n : 160_000n);

    const contract = new Contract(this.contract, [OMNI_DEPOSIT_FT], signer);
    return await contract.deposit.estimateGas(sender, address, amount);
  }

  async approveToken(args: { chain: number; token: string; allowed: string; need: bigint; amount: bigint; sender: string; sendTransaction: (tx: ethers.TransactionRequest) => Promise<string> }) {
    const provider = this.getProvider(args.chain);
    const erc20 = new ethers.Contract(args.token, ERC20_ABI, provider);

    const allowance = await erc20.allowance(args.sender, args.allowed);
    if (allowance >= args.need) return;

    const tx = await erc20.approve.populateTransaction(args.allowed, args.amount);
    const hash = await args.sendTransaction({ ...tx, chainId: args.chain });
    this.omni.logger?.log(`Approve tx: ${hash}`);
  }

  async getTokenBalance(token: string, chain: Network, address = this.contract): Promise<bigint> {
    const provider = this.getProvider(chain);
    if (token === "native") return await provider.getBalance(address);
    const contract = new Contract(token, ERC20_ABI, provider);
    const result = await contract.balanceOf(address);
    return BigInt(result);
  }

  async isWithdrawUsed(chain: number, nonce: string): Promise<boolean> {
    const provider = this.getProvider(chain);
    const contract = new Contract(this.contract, OMNI_ABI, provider);
    return await contract.usedNonces(nonce);
  }

  async withdraw(args: WithdrawArgs & { sendTransaction: (tx: ethers.TransactionRequest) => Promise<string> }) {
    const signature = await this.omni.api.withdrawSign(args.nonce);
    this.omni.logger?.log(`Withdrawing ${args.amount} ${args.token} from ${args.chain}`);
    const contract = new Contract(this.contract, OMNI_ABI, this.getProvider(args.chain));

    const tx = await contract.withdraw.populateTransaction(
      args.nonce,
      hexlify(baseDecode(encodeTokenAddress(args.chain, args.token))),
      args.receiver,
      BigInt(args.amount),
      hexlify(baseDecode(signature))
    );

    const hash = await args.sendTransaction({ ...tx, chainId: args.chain });
    this.omni.logger?.log(`Withdraw tx: ${hash}`);
  }

  async deposit(args: {
    chain: number;
    token: string;
    amount: bigint;
    sender: string;
    intentAccount: string;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  }): Promise<string | null> {
    this.omni.api.registerDeposit(args.intentAccount);
    this.omni.logger?.log(`Call deposit ${args.amount} ${args.token} to ${args.intentAccount}`);
    const receiver = omniEphemeralReceiver(args.intentAccount);

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing native`);
      const contract = new Contract(this.contract, [OMNI_DEPOSIT_NATIVE], this.getProvider(args.chain));
      const depositTx = await contract.deposit.populateTransaction(hexlify(receiver), { value: args.amount });
      const hash = await args.sendTransaction({ ...depositTx, chainId: args.chain });
      return hash;
    }

    this.omni.logger?.log(`Approving token if needed ${args.token} ${args.amount}`);
    await this.approveToken({
      sendTransaction: args.sendTransaction,
      need: args.amount,
      amount: this.enableApproveMax ? MaxUint256 : args.amount,
      allowed: this.contract,
      sender: args.sender,
      chain: args.chain,
      token: args.token,
    });

    this.omni.logger?.log(`Depositing token`);
    const contract = new Contract(this.contract, [OMNI_DEPOSIT_FT], this.getProvider(args.chain));
    const depositTx = await contract.deposit.populateTransaction(hexlify(receiver), args.token, args.amount);
    return await args.sendTransaction({ ...depositTx, chainId: args.chain });
  }

  async parseDeposit(chain: number, hash: string): Promise<PendingDeposit> {
    const wallet = this.getProvider(chain);
    const waitReceipt = async (attemps = 0): Promise<null | TransactionReceipt> => {
      const receipt = await wallet.provider!.getTransactionReceipt(hash).catch(() => null);
      if (receipt || attemps > 2) return receipt;
      await wait(3000);
      return await waitReceipt(attemps + 1);
    };

    const receipt = await waitReceipt();
    if (receipt == null) throw new DepositNotFoundError(chain, hash, "no tx receipt yet");

    const intrfc = new Interface([OMNI_DEPOSIT_LOG]);
    if (receipt.logs[0] == null) throw new DepositNotFoundError(chain, hash, "no deposit logs");

    const log = receipt.logs.map((t) => intrfc.parseLog(t)).find((t) => t?.args[0] != null);
    if (log == null) throw new DepositNotFoundError(chain, hash, "no deposit nonce yet");

    const nonce = String(log.args[0]);
    const amount = String(log.args[1]);
    const contractId = log.args[2] === "0x0000000000000000000000000000000000000000" ? "native" : log.args[2];
    const receiver = baseEncode(getBytes(log.args[3]));

    const timestamp = (await receipt.getBlock().then((t) => t.timestamp)) * 1000;
    const deposit = { amount, chain, receiver, timestamp, tx: hash, nonce, token: contractId, sender: receipt.from };
    return deposit;
  }
}

export default EvmOmniService;
