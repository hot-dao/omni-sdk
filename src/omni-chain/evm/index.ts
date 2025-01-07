import { Contract, getBytes, hexlify, Interface, TransactionReceipt } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";

import { OMNI_ABI, OMNI_CONTRACT, OMNI_DEPOSIT_FT, OMNI_DEPOSIT_LOG, OMNI_DEPOSIT_NATIVE } from "./constants";
import { PendingDeposit, TransferType } from "../types";
import { parseAmount, wait } from "../utils";
import { Network } from "../chains";
import OmniToken from "../token";
import OmniService from "..";

class EvmOmniService {
  constructor(readonly omni: OmniService) {}

  get evm() {
    if (this.omni.signers.evm == null) throw "Connect EVM";
    return this.omni.signers.evm;
  }

  async getWithdrawFee(chain: Network) {
    const gasPrice = await this.evm.getGasPrice(chain);
    return gasPrice * 400_000n;
  }

  async isNonceUsed(chain: number, nonce: string): Promise<boolean> {
    const contractId = OMNI_CONTRACT;
    const provider = this.evm.provider(chain);
    if (provider == null || contractId == null) return true;

    const contract = new Contract(contractId, OMNI_ABI, provider);
    return await contract.usedNonces(nonce);
  }

  async withdraw(args: { transfer: TransferType; signature: string; nonce: string; takeFee?: boolean }) {
    const runner = await this.evm.runner(args.transfer.chain_id);
    const contract = new Contract(OMNI_CONTRACT, OMNI_ABI, runner);

    const fee = args.transfer.chain_id === Network.Bnb ? parseAmount(0.00015, 18) : parseAmount(0.00005, 18);
    const tx = await contract.withdraw(
      args.nonce, //
      hexlify(baseDecode(args.transfer.contract_id)),
      hexlify(baseDecode(args.transfer.receiver_id)),
      BigInt(args.transfer.amount),
      hexlify(baseDecode(args.signature)),
      args.takeFee ? { value: fee } : {}
    );

    await tx.wait();
  }

  async deposit(chain: Network, token: OmniToken, amount: bigint, to?: string) {
    const receiver = to ? this.omni.getOmniAddressHex(to) : this.omni.omniAddressHex;
    const { address } = await token.metadata(chain);

    const wallet = await this.evm.runner(chain);
    const gasPrice = await this.evm.getGasPrice(chain);

    if (address === "native") {
      const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_NATIVE], wallet);
      const depositTx = await contract.deposit(receiver, { value: amount, gasPrice });

      const deposit = this.omni.addPendingDeposit({
        timestamp: Date.now(),
        amount: String(amount),
        tx: depositTx.hash,
        token: token.id,
        nonce: "",
        receiver,
        chain,
      });

      await depositTx.wait();
      return deposit;
    }

    await this.evm.approveToken(chain, address, OMNI_CONTRACT, amount);
    const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_FT], wallet);
    const depositTx = await await contract.deposit(receiver, address, amount, { gasPrice });

    const deposit = this.omni.addPendingDeposit({
      timestamp: Date.now(),
      amount: String(amount),
      tx: depositTx.hash,
      token: token.id,
      nonce: "",
      receiver,
      chain,
    });

    await depositTx.wait();
    return deposit;
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    await this.omni.removePendingDeposit(deposit);
  }

  async parseDeposit(chain: number, hash: string) {
    const wallet = this.evm.provider(chain);
    const waitReceipt = async (attemps = 0): Promise<null | TransactionReceipt> => {
      const receipt = await wallet.getTransactionReceipt(hash);
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
