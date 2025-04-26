import { Contract, ethers, getBytes, hexlify, Interface, TransactionReceipt } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";

import { ERC20_ABI, OMNI_ABI, OMNI_CONTRACT, OMNI_DEPOSIT_FT, OMNI_DEPOSIT_LOG, OMNI_DEPOSIT_NATIVE } from "./constants";
import { encodeTokenAddress, omniEphemeralReceiver, wait } from "../utils";
import { PendingDeposit } from "../types";
import { Network } from "../chains";
import OmniService from "../bridge";

class EvmOmniService {
  constructor(readonly omni: OmniService, readonly rpcs: Record<number, string[]> = {}) {}

  getProvider(chain: number) {
    if (!this.rpcs[chain]) throw `No rpc for chain ${chain}`;
    const list = Array.isArray(this.rpcs[chain]) ? this.rpcs[chain] : [this.rpcs[chain]];
    const provider = list.map((rpc) => new ethers.JsonRpcProvider(rpc, chain, { staticNetwork: true }));
    return new ethers.FallbackProvider(provider, chain, {});
  }

  async approveToken(args: {
    chain: number;
    token: string;
    allowed: string;
    need: bigint;
    getAddress: () => Promise<string>;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  }) {
    const provider = this.getProvider(args.chain);
    const erc20 = new ethers.Contract(args.token, ERC20_ABI, provider);

    const address = await args.getAddress();
    const allowance = await erc20.allowance(address, args.allowed);
    if (allowance >= args.need) return;

    const tx = await erc20.approve.populateTransaction(args.allowed, args.need);
    const hash = await args.sendTransaction({ ...tx, chainId: args.chain });
    this.omni.logger?.log(`Approve tx: ${hash}`);
  }

  async getTokenBalance(token: string, chain: Network, address = OMNI_CONTRACT): Promise<bigint> {
    const provider = this.getProvider(chain);
    if (token === "native") return await provider.getBalance(address);
    const contract = new Contract(token, ERC20_ABI, provider);
    const result = await contract.balanceOf(address);
    return BigInt(result);
  }

  async isWithdrawUsed(chain: number, nonce: string): Promise<boolean> {
    const provider = this.getProvider(chain);
    const contract = new Contract(OMNI_CONTRACT, OMNI_ABI, provider);
    return await contract.usedNonces(nonce);
  }

  async withdraw(args: {
    chain: number;
    amount: bigint;
    token: string;
    signature: string;
    nonce: string;
    receiver: string;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  }) {
    this.omni.logger?.log(`Withdrawing ${args.amount} ${args.token} from ${args.chain}`);
    const contract = new Contract(OMNI_CONTRACT, OMNI_ABI, this.getProvider(args.chain));

    const tx = await contract.withdraw.populateTransaction(
      args.nonce,
      hexlify(baseDecode(encodeTokenAddress(args.chain, args.token))),
      args.receiver,
      BigInt(args.amount),
      hexlify(baseDecode(args.signature))
    );

    const hash = await args.sendTransaction({ ...tx, chainId: args.chain });
    this.omni.logger?.log(`Withdraw tx: ${hash}`);
  }

  async deposit(args: {
    chain: Network;
    token: string;
    amount: bigint;
    getAddress: () => Promise<string>;
    getIntentAccount: () => Promise<string>;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
  }): Promise<PendingDeposit> {
    const intentAccount = await args.getIntentAccount();
    this.omni.logger?.log(`Call deposit ${args.amount} ${args.token} to ${intentAccount}`);

    const receiver = omniEphemeralReceiver(intentAccount);
    const sender = await args.getAddress();

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing native`);
      const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_NATIVE], this.getProvider(args.chain));
      const depositTx = await contract.deposit.populateTransaction(hexlify(receiver), { value: args.amount });
      const hash = await args.sendTransaction({ ...depositTx, chainId: args.chain });

      this.omni.logger?.log(`Parsing receipt`);
      const logs = await this.parseDeposit(args.chain, hash);
      return {
        timestamp: Date.now(),
        amount: String(args.amount),
        receiver: baseEncode(receiver),
        intentAccount,
        token: args.token,
        chain: args.chain,
        nonce: logs.nonce,
        tx: hash,
        sender,
      };
    }

    this.omni.logger?.log(`Approving token if needed ${args.token} ${args.amount}`);
    await this.approveToken({
      sendTransaction: args.sendTransaction,
      getAddress: args.getAddress,
      allowed: OMNI_CONTRACT,
      chain: args.chain,
      token: args.token,
      need: args.amount,
    });

    this.omni.logger?.log(`Depositing token`);
    const contract = new Contract(OMNI_CONTRACT, [OMNI_DEPOSIT_FT], this.getProvider(args.chain));
    const depositTx = await contract.deposit.populateTransaction(hexlify(receiver), args.token, args.amount);
    const hash = await args.sendTransaction({ ...depositTx, chainId: args.chain });

    this.omni.logger?.log(`Parsing receipt`);
    const logs = await this.parseDeposit(args.chain, hash);
    return {
      timestamp: Date.now(),
      intentAccount: intentAccount,
      receiver: baseEncode(receiver),
      amount: String(args.amount),
      token: args.token,
      chain: args.chain,
      nonce: logs.nonce,
      tx: hash,
      sender,
    };
  }

  async parseDeposit(chain: number, hash: string) {
    const wallet = this.getProvider(chain);
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
    const deposit = { amount, chain, receiver, timestamp, tx: hash, nonce, token: contractId, sender: receipt.from };

    const isUsed = await this.omni.isDepositUsed(chain, nonce);
    if (isUsed) throw "Deposit alredy claimed, check your omni balance";
    return deposit;
  }
}

export default EvmOmniService;
