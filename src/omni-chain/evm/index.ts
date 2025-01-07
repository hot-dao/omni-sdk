import { Contract, ethers, getBytes, hexlify, Interface, TransactionReceipt } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";

import { ERC20_ABI, OMNI_ABI, OMNI_CONTRACT, OMNI_DEPOSIT_FT, OMNI_DEPOSIT_LOG, OMNI_DEPOSIT_NATIVE } from "./constants";
import { PendingDeposit, TransferType } from "../types";
import { parseAmount, wait } from "../utils";
import { Network } from "../chains";
import OmniToken, { TokenInput } from "../token";
import OmniService from "..";

class EvmOmniService {
  constructor(readonly omni: OmniService) {}

  get evm() {
    if (this.omni.signers.evm == null) throw "Connect EVM";
    return this.omni.signers.evm;
  }

  async getWithdrawFee(chain: Network) {
    const gasPrice = await this.getGasPrice(chain);
    return gasPrice * 400_000n;
  }

  async isNonceUsed(chain: number, nonce: string): Promise<boolean> {
    const contractId = OMNI_CONTRACT;
    const provider = await this.evm.runner(chain);
    if (provider == null || contractId == null) return true;

    const contract = new Contract(contractId, OMNI_ABI, provider);
    return await contract.usedNonces(nonce);
  }

  async withdraw(args: { transfer: TransferType; signature: string; nonce: string }) {
    const runner = await this.evm.runner(args.transfer.chain_id);
    const contract = new Contract(OMNI_CONTRACT, OMNI_ABI, runner);

    const tx = await contract.withdraw(
      args.nonce, //
      hexlify(baseDecode(args.transfer.contract_id)),
      hexlify(baseDecode(args.transfer.receiver_id)),
      BigInt(args.transfer.amount),
      hexlify(baseDecode(args.signature))
    );

    await tx.wait();
  }

  async getGasPrice(chain: number): Promise<bigint> {
    if (chain === 56) return 1000000000n; // BNB 1 gwei always...
    const wallet = await this.evm.runner(chain);
    const feeData = await wallet.provider!.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    return (gasPrice / 10n) * 13n;
  }

  async deposit(token: TokenInput, to?: string) {
    const receiver = to ? this.omni.getOmniAddressHex(to) : this.omni.omniAddressHex;
    const wallet = await this.evm.runner(token.chain);
    const gasPrice = await this.getGasPrice(token.chain);

    if (token.address === "native") {
      const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_NATIVE], wallet);
      const depositTx = await contract.deposit(receiver, { value: token.amount, gasPrice });

      const deposit = this.omni.addPendingDeposit({
        timestamp: Date.now(),
        amount: String(token.amount),
        tx: depositTx.hash,
        chain: token.chain,
        token: token.id,
        nonce: "",
        receiver,
      });

      await depositTx.wait();
      return deposit;
    }

    await this.approveToken(token.chain, token.address, OMNI_CONTRACT, token.amount);
    const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_FT], wallet);
    const depositTx = await await contract.deposit(receiver, token.address, token.amount, { gasPrice });

    const deposit = this.omni.addPendingDeposit({
      timestamp: Date.now(),
      amount: String(token.amount),
      tx: depositTx.hash,
      chain: token.chain,
      token: token.id,
      nonce: "",
      receiver,
    });

    await depositTx.wait();
    return deposit;
  }

  async approveToken(chain: number, token: string, allowed: string, need: bigint) {
    const wallet = await this.evm.runner(chain);
    const erc20 = new ethers.Contract(token, ERC20_ABI, wallet);
    const allowance = await erc20.allowance(this.evm.address, allowed);
    if (allowance >= need) return;

    const MAX_APPROVE = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    const tx = await erc20.approve(allowed, MAX_APPROVE, { gasLimit: 100_000n });
    await tx.wait();
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    await this.omni.removePendingDeposit(deposit);
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

    const omni = await this.omni.findToken(chain, contractId);
    if (omni == null) throw "Unknown omni token";

    const timestamp = (await receipt.getBlock().then((t) => t.timestamp)) * 1000;
    const deposit = { amount, chain, receiver, timestamp, tx: hash, nonce, token: +omni };

    const isUsed = await this.omni.isDepositUsed(chain, nonce);
    if (isUsed) {
      await this.clearDepositNonceIfNeeded(deposit);
      throw "Deposit alredy claimed, check your omni balance";
    }

    return this.omni.addPendingDeposit(deposit);
  }
}

export default EvmOmniService;
