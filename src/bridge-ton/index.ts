import { address, Address, beginCell, OpenedContract, SenderArguments, toNano } from "@ton/core";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import OmniService from "../bridge";
import { omniEphemeralReceiver } from "../utils";
import { Network, PendingDeposit, WithdrawArgs } from "../types";
import { MIN_COMMISSION } from "./constants";
import { DepositNotFoundError } from "../errors";

import { TON_MINTER_TO_JETTON_MAPPER, TON_JETTON_TO_MINTER_MAPPER } from "./jettons";
import { TonMetaWallet as TonMetaWalletV2 } from "./wrappers/TonMetaWallet";
import { DepositJetton as DepositJettonV2 } from "./wrappers/DepositJetton";
import { JettonMinter as JettonMinterV2 } from "./wrappers/JettonMinter";
import { JettonWallet as JettonWalletV2 } from "./wrappers/JettonWallet";
import { UserJetton as UserJettonV2 } from "./wrappers/UserJetton";
import { ReviewFee } from "../fee";

class TonOmniService {
  readonly tonApi: TonApiClient;
  readonly client: ContractAdapter;

  static TON_MINTER_TO_JETTON_MAPPER = TON_MINTER_TO_JETTON_MAPPER;
  static TON_JETTON_TO_MINTER_MAPPER = TON_JETTON_TO_MINTER_MAPPER;
  readonly contract: string;

  private metaWallet?: OpenedContract<TonMetaWalletV2>;
  constructor(readonly omni: OmniService, options: { rpc?: TonApiClient | string; metaWallet?: string; contract?: string }) {
    this.contract = options.contract || "EQANEViM3AKQzi6Aj3sEeyqFu8pXqhy9Q9xGoId_0qp3CNVJ";
    this.tonApi = options.rpc instanceof TonApiClient ? options.rpc : new TonApiClient({ apiKey: options.rpc });
    this.client = new ContractAdapter(this.tonApi);
  }

  async registerMinterJetton(minterAddress: string) {
    const { metaWallet, JettonMinter } = this.getMetaWallet();
    const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(minterAddress)));
    const tokenAddress = await minter.getWalletAddressOf(metaWallet.address);

    const key = Address.parse(minterAddress).toString({ bounceable: true });
    TonOmniService.TON_MINTER_TO_JETTON_MAPPER[key] = tokenAddress.toString({ bounceable: true });
    TonOmniService.TON_JETTON_TO_MINTER_MAPPER[tokenAddress.toString({ bounceable: true })] = key;
  }

  getMetaWallet() {
    if (!this.metaWallet) this.metaWallet = this.client.open(TonMetaWalletV2.createFromAddress(Address.parse(this.contract)));
    return { metaWallet: this.metaWallet, DepositJetton: DepositJettonV2, UserJetton: UserJettonV2, JettonMinter: JettonMinterV2, JettonWallet: JettonWalletV2 };
  }

  async getWithdrawFee(): Promise<ReviewFee> {
    return new ReviewFee({ baseFee: toNano(0.05), reserve: toNano(0.1), gasLimit: 1n, chain: Network.Ton });
  }

  async getDepositFee(token: string): Promise<ReviewFee> {
    const need = token === "native" ? toNano(0.07) : toNano(0.13);
    return new ReviewFee({ reserve: need, baseFee: toNano(0.025), chain: Network.Ton, gasLimit: 1n });
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

  async withdraw(args: WithdrawArgs & { refundAddress: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet } = this.getMetaWallet();
    const executor = this.executor(args.sendTransaction);
    const signature = await this.omni.api.withdrawSign(args.nonce);

    if (args.token === "native") {
      await metaWallet.sendUserNativeWithdraw(executor, {
        userWallet: Address.parse(args.receiver),
        signature: Buffer.from(baseDecode(signature)),
        excessAcc: Address.parse(args.refundAddress),
        nonce: BigInt(args.nonce),
        value: toNano("0.15"),
        amount: args.amount,
      });
    }

    // withdraw token
    else {
      const { metaWallet, JettonMinter } = this.getMetaWallet();
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));
      const tokenAddress = await minter.getWalletAddressOf(metaWallet.address);

      await metaWallet.sendUserTokenWithdraw(executor, {
        userWallet: Address.parse(args.receiver),
        signature: Buffer.from(baseDecode(signature)),
        excessAcc: Address.parse(args.refundAddress),
        token: tokenAddress,
        nonce: BigInt(args.nonce),
        amount: args.amount,
        value: toNano("0.15"),
      });
    }
  }

  async deposit(args: { refundAddress?: string; token: string; amount: bigint; intentAccount: string; sender: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet, JettonMinter, JettonWallet } = this.getMetaWallet();
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const executor = this.executor(args.sendTransaction);
    this.omni.api.registerDeposit(args.intentAccount);

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing ${args.amount} TON to ${args.intentAccount}`);
      await metaWallet.sendNativeDeposit(executor, {
        value: args.amount + toNano(0.07),
        excessAcc: Address.parse(args.refundAddress ?? args.sender),
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
      const refundAddress = Address.parse(args.refundAddress ?? args.sender);

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

    return executor.hash;
  }

  async clearDepositNonceIfNeeded(args: { nonce: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet, DepositJetton } = this.getMetaWallet();
    const isUsed = await this.omni.isDepositUsed(Network.Ton, args.nonce);
    if (!isUsed) return;

    const depositAddress = await metaWallet.getDepositJettonAddress(BigInt(args.nonce));
    const depositJetton = this.client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.executor(args.sendTransaction), { value: MIN_COMMISSION });
  }

  async parseDeposit(hash: string): Promise<PendingDeposit> {
    const events = await this.tonApi.events.getEvent(hash);
    const deployTxHashes = events.actions.filter((t) => t.ContractDeploy != null).map((t) => t.baseTransactions[0]);
    if (!deployTxHashes.length) throw new DepositNotFoundError(Network.Ton, hash, "Deposit tx not found");

    const OP_NATIVE = "0x205f209a";
    const OP_CREATE_DEPOSIT = "0xb7e30a3e";
    const isDepositCall = events.actions.some((t) => [OP_NATIVE, OP_CREATE_DEPOSIT].includes(t.SmartContractExec?.operation ?? ""));
    if (!isDepositCall) throw new DepositNotFoundError(Network.Ton, hash, "Deposit tx not found");

    const deposit: PendingDeposit = {
      timestamp: Date.now(),
      chain: Network.OmniTon,
      receiver: "",
      nonce: "",
      amount: "",
      token: "",
      sender: "",
      tx: hash,
    };

    const ftDepositCall = events.actions.find((t) => t.JettonTransfer != null);
    const nativeDepositCall = events.actions.find((t) => t.SmartContractExec?.operation === OP_NATIVE);

    if (ftDepositCall?.JettonTransfer) {
      for (const hash of ftDepositCall.baseTransactions) {
        try {
          const tx = await this.tonApi.blockchain.getBlockchainTransaction(hash);
          const body = tx.inMsg?.rawBody;
          if (body == null) continue;

          const slice = body.beginParse();
          slice.loadUint(32); // Load OP code
          slice.loadUintBig(64); // Load query id

          deposit.amount = slice.loadCoins().toString();
          deposit.receiver = baseEncode(slice.loadRef().beginParse().loadBuffer(32));

          deposit.sender = tx.account.address.toString({ bounceable: false });
          deposit.token = ftDepositCall.JettonTransfer.jetton.address.toString({ bounceable: true });
          break;
        } catch (e) {}
      }
    } else if (nativeDepositCall) {
      const tx = await this.tonApi.blockchain.getBlockchainTransaction(nativeDepositCall.baseTransactions[0]);
      const body = tx.inMsg?.rawBody;
      if (body == null) throw new DepositNotFoundError(Network.Ton, hash, "Deposit tx not found");

      const slice = body.beginParse();
      slice.loadUint(32); // Load OP code
      slice.loadUintBig(64); // Load query id

      deposit.sender = tx.account.address.toString({ bounceable: false });
      deposit.receiver = baseEncode(slice.loadBuffer(32));
      deposit.amount = slice.loadCoins().toString();
      deposit.token = "native";
    } else {
      throw new DepositNotFoundError(Network.Ton, hash, "Deposit tx not found");
    }

    const parseDeployTx = async (hash: string) => {
      const tx = await this.tonApi.blockchain.getBlockchainTransaction(hash);
      if (tx.inMsg?.init?.boc == null) throw new DepositNotFoundError(Network.Ton, hash, "Deploy tx not found");

      const slice = tx.inMsg.init.boc.beginParse();
      slice.loadRef();

      const slice1 = slice.loadRef().beginParse();
      slice1.loadAddressAny();
      slice1.loadAddressAny();
      return slice1.loadUintBig(128).toString();
    };

    for (const hash of deployTxHashes) {
      const nonce = await parseDeployTx(hash).catch(() => null);
      if (nonce && BigInt(nonce) > 10n ** 30n) continue; // incorrect uint cell
      if (nonce) return { ...deposit, nonce };
    }

    throw new DepositNotFoundError(Network.Ton, hash, "Deposit not found");
  }
}

export default TonOmniService;
