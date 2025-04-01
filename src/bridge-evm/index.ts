import { Contract, ethers, getBytes, hexlify, Interface, TransactionReceipt } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";

import { ERC20_ABI, OMNI_ABI, OMNI_CONTRACT, OMNI_DEPOSIT_FT, OMNI_DEPOSIT_LOG, OMNI_DEPOSIT_NATIVE } from "./constants";
import { address2base, bigIntMax, getOmniAddressHex, wait } from "../omni-chain/utils";
import { Chains, Network } from "../chains";
import { PendingDeposit } from "../types";
import OmniService from "../bridge";

class EvmOmniService {
  constructor(readonly omni: OmniService) {}

  get evm() {
    if (this.omni.user.evm == null) throw "Connect EVM";
    return this.omni.user.evm;
  }

  async getGasPrice(chain: number): Promise<bigint> {
    if (chain === 56) return 1000000000n; // BNB 1 gwei always...
    const wallet = await this.evm.runner(chain);
    const feeData = await wallet.provider!.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    return (gasPrice / 10n) * 13n;
  }

  async approveToken(chain: number, token: string, allowed: string, need: bigint) {
    const wallet = await this.evm.runner(chain);
    const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);
    const allowance = await erc20.allowance(this.evm.address, allowed);
    if (allowance >= need) return;

    const MAX_APPROVE = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const tx = await erc20.approve(allowed, MAX_APPROVE);
    await tx.wait();
  }

  async approveTokenEstimate(chain: number, token: string, allowed: string, need: bigint) {
    const wallet = await this.evm.runner(chain);
    const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);
    const allowance = await erc20.allowance(this.evm.address, allowed);
    if (allowance >= need) return 0n;

    const MAX_APPROVE = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    return await erc20.approve.estimateGas(allowed, MAX_APPROVE, {});
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee(chain: Network) {
    const gasPrice = await this.getGasPrice(chain);
    const needNative = gasPrice * 400_000n;
    const realGas = needNative;

    const balance = await this.getTokenLiquidity("native", chain, this.evm.address);
    if (balance >= needNative) return { need: 0n, canPerform: true, amount: realGas, decimal: Chains.get(chain).decimal, additional: 0n };
    return {
      need: bigIntMax(0n, needNative - balance),
      canPerform: false,
      decimal: Chains.get(chain).decimal,
      amount: realGas,
      additional: 0n,
    };
  }

  async getDepositFee(chain: Network, address: string) {
    const gasPrice = await this.getGasPrice(chain);
    const balance = await this.getTokenLiquidity(address, chain, this.evm.address);
    const gasLimit = await this.depositEstimateGas(chain, address, 1n);
    const need = gasPrice * gasLimit;
    return {
      maxFee: gasPrice * gasLimit,
      need: bigIntMax(0n, need - balance),
      isNotEnough: balance < need,
      chain: chain,
      gasLimit,
      gasPrice,
    };
  }

  async getTokenLiquidity(token: string, chain: Network, address = OMNI_CONTRACT): Promise<bigint> {
    const rpc = await this.evm.runner(chain);
    if (token === "native") return await rpc.provider!.getBalance(address);
    const contract = new Contract(token, ERC20_ABI, rpc);
    const result = await contract.balanceOf(address);
    return BigInt(result);
  }

  async isNonceUsed(chain: number, nonce: string): Promise<boolean> {
    const contractId = OMNI_CONTRACT;
    const provider = await this.evm.runner(chain);
    if (provider == null || contractId == null) return true;

    const contract = new Contract(contractId, OMNI_ABI, provider);
    return await contract.usedNonces(nonce);
  }

  async withdraw(args: { chain: number; amount: bigint; token: string; signature: string; nonce: string }) {
    const runner = await this.evm.runner(args.chain);
    const contract = new Contract(OMNI_CONTRACT, OMNI_ABI, runner);

    const tx = await contract.withdraw(
      args.nonce,
      hexlify(baseDecode(address2base(args.chain, args.token))),
      this.evm.address, // receiver
      BigInt(args.amount),
      hexlify(baseDecode(args.signature))
    );

    await tx.wait();
  }

  async depositEstimateGas(chain: Network, address: string, amount: bigint, to?: string) {
    const receiver = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const wallet = await this.evm.runner(chain);

    if (address === "native") {
      const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_NATIVE], wallet);
      return contract.deposit.estimateGas(receiver, { value: amount });
    }

    const approved = await this.approveTokenEstimate(chain, address, OMNI_CONTRACT, amount);
    if (approved) return approved + (chain == Network.Arbitrum ? 400_000n : 160_000n);
    const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_FT], wallet);
    return await contract.deposit.estimateGas(receiver, address, amount);
  }

  async deposit(chain: Network, address: string, amount: bigint, to?: string) {
    const receiver = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const gasPrice = await this.getGasPrice(chain);
    const wallet = await this.evm.runner(chain);

    if (address === "native") {
      const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_NATIVE], wallet);
      const depositTx = await contract.deposit(receiver, { value: amount, gasPrice });
      const deposit = this.omni.addPendingDeposit({
        timestamp: Date.now(),
        amount: String(amount),
        chain,
        receiver,
        token: address,
        tx: depositTx.hash,
        nonce: "",
      });

      const receipt = await depositTx.wait();
      if (!receipt) throw "no receipt";

      const logs = await this.parseDepositReceipt(receipt);
      deposit.receiver = logs.receiver;
      deposit.nonce = logs.nonce;

      return this.omni.addPendingDeposit(deposit);
    }

    await this.approveToken(chain, address, OMNI_CONTRACT, amount);
    const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_FT], wallet);
    const depositTx = await contract.deposit(receiver, address, amount, { gasPrice });
    const deposit = this.omni.addPendingDeposit({
      tx: depositTx.hash,
      timestamp: Date.now(),
      amount: String(amount),
      token: address,
      nonce: "",
      receiver,
      chain,
    });

    const receipt = await depositTx.wait();
    if (!receipt) throw "no receipt";

    const logs = await this.parseDepositReceipt(receipt);
    deposit.receiver = logs.receiver;
    deposit.nonce = logs.nonce;

    return this.omni.addPendingDeposit(deposit);
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    await this.omni.removePendingDeposit(deposit);
  }

  async parseDepositReceipt(receipt: TransactionReceipt) {
    const intrfc = new Interface([OMNI_DEPOSIT_LOG]);
    if (receipt.logs[0] == null) throw "no deposit logs";
    const log = intrfc.parseLog(receipt.logs[receipt.logs.length - 1]);
    if (log?.args[0] == null) throw "no deposit nonce yet";

    const nonce = String(log.args[0]);
    const amount = String(log.args[1]);
    const contractId = log.args[2] === "0x0000000000000000000000000000000000000000" ? "native" : log.args[2];
    const receiver = baseEncode(getBytes(log.args[3]));

    return { nonce, amount, contractId, receiver };
  }

  async parseDeposit(chain: number, hash: string) {
    const wallet = await this.evm.runner(chain);
    const waitReceipt = async (attemps = 0): Promise<null | TransactionReceipt> => {
      const receipt = await wallet.provider!.getTransactionReceipt(hash);
      if (receipt || attemps > 2) return receipt;
      await wait(3000);
      return await waitReceipt(attemps + 1);
    };

    const receipt = await waitReceipt();
    if (receipt == null) throw "no tx receipt yet";

    const intrfc = new Interface([OMNI_DEPOSIT_LOG]);
    if (receipt.logs[0] == null) throw "no deposit logs";

    const log = intrfc.parseLog(receipt.logs[receipt.logs.length - 1]);
    if (log?.args[0] == null) throw "no deposit nonce yet";

    const nonce = String(log.args[0]);
    const amount = String(log.args[1]);
    const contractId = log.args[2] === "0x0000000000000000000000000000000000000000" ? "native" : log.args[2];
    const receiver = baseEncode(getBytes(log.args[3]));

    const timestamp = (await receipt.getBlock().then((t) => t.timestamp)) * 1000;
    const deposit = { amount, chain, receiver, timestamp, tx: hash, nonce, token: contractId };

    const isUsed = await this.omni.isDepositUsed(chain, nonce);
    if (isUsed) {
      await this.clearDepositNonceIfNeeded(deposit);
      throw "Deposit alredy claimed, check your omni balance";
    }

    return this.omni.addPendingDeposit(deposit);
  }
}

export default EvmOmniService;
