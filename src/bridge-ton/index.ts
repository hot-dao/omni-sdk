import { address, Address, beginCell, OpenedContract, SenderArguments, toNano } from "@ton/core";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import { omniEphemeralReceiver, wait } from "../utils";
import OmniService from "../bridge";

import { Network, PendingDeposit, PendingDepositWithIntent } from "../types";
import { MIN_COMMISSION } from "./constants";

import { TonMetaWallet as TonMetaWalletV2 } from "./wrappers/TonMetaWallet";
import { DepositJetton as DepositJettonV2 } from "./wrappers/DepositJetton";
import { JettonMinter as JettonMinterV2 } from "./wrappers/JettonMinter";
import { JettonWallet as JettonWalletV2 } from "./wrappers/JettonWallet";
import { UserJetton as UserJettonV2 } from "./wrappers/UserJetton";
import { ReviewFee } from "../fee";

class TonLegacyOmniService {
  readonly tonApi: TonApiClient;
  readonly client: ContractAdapter;

  private metaWallet?: OpenedContract<TonMetaWalletV2>;
  constructor(readonly omni: OmniService, rpc?: TonApiClient | string) {
    this.tonApi = rpc instanceof TonApiClient ? rpc : new TonApiClient({ apiKey: rpc });
    this.client = new ContractAdapter(this.tonApi);
  }

  getMetaWallet() {
    if (!this.metaWallet) this.metaWallet = this.client.open(TonMetaWalletV2.createFromAddress(Address.parse("EQDJ1i5VKRWYJKDDcu0EEKqSllCOoLluXWDksHqy6mix2jQJ")));
    return { metaWallet: this.metaWallet, DepositJetton: DepositJettonV2, UserJetton: UserJettonV2, JettonMinter: JettonMinterV2, JettonWallet: JettonWalletV2 };
  }

  async getWithdrawFee(): Promise<ReviewFee> {
    const additional = 0n;
    const realGas = toNano(0.025);
    const needNative = toNano(0.05);
    return new ReviewFee({ reserve: needNative, baseFee: realGas, priorityFee: 0n, gasLimit: 1n, chain: Network.Ton, additional });
  }

  async getDepositFee(token: string): Promise<ReviewFee> {
    const need = token === "native" ? toNano(0.12) : toNano(0.12);
    return new ReviewFee({ reserve: need, baseFee: need / 2n, priorityFee: 0n, chain: Network.Ton, gasLimit: 1n });
  }

  executor(sendTransaction: (tx: SenderArguments) => Promise<string>) {
    const executor = {
      hash: "",
      send: async (args: SenderArguments) => {
        executor.hash = await sendTransaction(args);
      },
    };

    return executor;
  }

  async getTokenBalance(token: string, address?: string): Promise<bigint> {
    const { metaWallet, JettonMinter, JettonWallet } = this.getMetaWallet();
    const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(token)));
    const metaJettonWalletAddress = await minter.getWalletAddressOf(address ? Address.parse(address) : metaWallet.address); // TODO: fix this
    const userJetton = this.client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
    return await userJetton.getJettonBalance();
  }

  async isWithdrawUsed(nonce: string, receiver: string): Promise<boolean> {
    const { metaWallet, UserJetton } = this.getMetaWallet();
    const userJettonAddress = await metaWallet.getUserJettonAddress(Address.parse(receiver));
    const userJetton = this.client.open(UserJetton.createFromAddress(userJettonAddress));
    const lastNonce = await userJetton.getLastWithdrawnNonce();
    return BigInt(nonce) <= BigInt(lastNonce.toString());
  }

  async withdraw(args: { refundAddress: string; amount: bigint; token: string; signature: string; nonce: string; receiver: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet } = this.getMetaWallet();
    const executor = this.executor(args.sendTransaction);

    if (args.token === "native") {
      await metaWallet.sendUserNativeWithdraw(executor, {
        userWallet: Address.parse(args.receiver),
        receiver: Address.parse(args.receiver),
        signature: Buffer.from(baseDecode(args.signature)),
        excessAcc: Address.parse(args.refundAddress),
        nonce: BigInt(args.nonce),
        value: args.amount + toNano("0.12"),
        amount: args.amount,
      });
    }

    // withdraw token
    else {
      console.log("withdraw token", args);
      await metaWallet.sendUserTokenWithdraw(executor, {
        userWallet: Address.parse(args.receiver),
        receiver: Address.parse(args.receiver),
        signature: Buffer.from(baseDecode(args.signature)),
        excessAcc: Address.parse(args.refundAddress),
        token: Address.parse(args.token),
        nonce: BigInt(args.nonce),
        amount: args.amount,
        value: toNano("0.12"),
      });
    }
  }

  async deposit(args: { refundAddress: string; token: string; amount: bigint; intentAccount: string; sender: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet, JettonMinter, JettonWallet } = this.getMetaWallet();
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const executor = this.executor(args.sendTransaction);

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing ${args.amount} TON to ${args.intentAccount}`);
      await metaWallet.sendNativeDeposit(executor, {
        value: args.amount + toNano(0.07),
        excessAcc: Address.parse(args.refundAddress),
        receiver: receiver,
        amount: args.amount,
        queryId: 0,
      });
    }

    // deposit token
    else {
      this.omni.logger?.log(`Depositing ${args.amount} ${args.token} to ${args.intentAccount}`);
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));

      this.omni.logger?.log(`Getting wallet address of ${address}`);
      const userJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(args.sender));

      this.omni.logger?.log(`Sending transfer`);
      const userJetton = this.client.open(JettonWallet.createFromAddress(userJettonWalletAddress));
      const refundAddress = Address.parse(args.refundAddress);

      await userJetton.sendTransfer(
        executor,
        toNano(0.06), // value
        toNano(0.07), // forwardValue
        metaWallet.address, // receiver
        args.amount,
        beginCell().storeBuffer(receiver).storeAddress(refundAddress).endCell(),
        refundAddress
      );
    }

    let token = args.token;
    if (token !== "native") {
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));
      const metaJettonWalletAddress = await minter.getWalletAddressOf(metaWallet.address);
      token = metaJettonWalletAddress.toString();
    }

    if (!executor.hash) throw "Failed to send transaction";
    const deposit: PendingDepositWithIntent = {
      chain: Network.Ton,
      intentAccount: args.intentAccount,
      receiver: baseEncode(receiver),
      timestamp: Date.now(),
      amount: String(args.amount),
      sender: args.sender,
      tx: executor.hash,
      nonce: "",
      token,
    };

    const waitParseDeposit = async (attemps = 0) => {
      try {
        return await this.parseDeposit(deposit);
      } catch (e) {
        if (attemps > 15) throw e;
        await wait(5000);
        this.omni.logger?.log(`Retrying parse deposit ${e}`);
        return waitParseDeposit(attemps + 1);
      }
    };

    this.omni.logger?.log(`Parsing deposit`);
    const { nonce } = await waitParseDeposit();
    return { ...deposit, nonce };
  }

  async clearDepositNonceIfNeeded(args: { nonce: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet, DepositJetton } = this.getMetaWallet();
    const isUsed = await this.omni.isDepositUsed(Network.Ton, args.nonce);
    if (!isUsed) return;

    const depositAddress = await metaWallet.getDepositJettonAddress(BigInt(args.nonce));
    const depositJetton = this.client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.executor(args.sendTransaction), { value: MIN_COMMISSION });
  }

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;

    const events = await this.tonApi.events.getEvent(deposit.tx);
    const deployTxHashes = events.actions.filter((t) => t.ContractDeploy != null).map((t) => t.baseTransactions[0]);

    const parseDeployTx = async (hash: string) => {
      const tx = await this.tonApi.blockchain.getBlockchainTransaction(hash);
      if (tx.inMsg?.init?.boc == null) throw "Deploy tx not found";

      const slice = tx.inMsg.init.boc.beginParse();
      slice.loadRef();

      const slice1 = slice.loadRef().beginParse();
      slice1.loadAddressAny();
      slice1.loadAddressAny();
      return slice1.loadUintBig(128).toString();
    };

    for (const hash of deployTxHashes) {
      const nonce = await parseDeployTx(hash).catch(() => null);
      if (nonce) return { ...deposit, nonce };
    }

    throw "Deposit not found";
  }
}

export default TonLegacyOmniService;
