import { address, Address, beginCell, OpenedContract, SenderArguments, toNano } from "@ton/core";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import { omniEphemeralReceiver } from "../utils";
import OmniService from "../bridge";

import { Network, PendingDeposit } from "../types";
import { MIN_COMMISSION, OpCode } from "./constants";

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

  private metaWallet?: OpenedContract<TonMetaWalletV2>;
  constructor(readonly omni: OmniService, rpc?: TonApiClient | string) {
    this.tonApi = rpc instanceof TonApiClient ? rpc : new TonApiClient({ apiKey: rpc });
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
    if (!this.metaWallet) this.metaWallet = this.client.open(TonMetaWalletV2.createFromAddress(Address.parse("EQANEViM3AKQzi6Aj3sEeyqFu8pXqhy9Q9xGoId_0qp3CNVJ")));
    return { metaWallet: this.metaWallet, DepositJetton: DepositJettonV2, UserJetton: UserJettonV2, JettonMinter: JettonMinterV2, JettonWallet: JettonWalletV2 };
  }

  async getWithdrawFee(): Promise<ReviewFee> {
    const realGas = toNano(0.025);
    const needNative = toNano(0.12);
    return new ReviewFee({ reserve: needNative, baseFee: realGas, gasLimit: 1n, chain: Network.Ton });
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

  async withdraw(args: { sender: string; refundAddress: string; amount: bigint; token: string; nonce: string; receiver: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet } = this.getMetaWallet();
    const executor = this.executor(args.sendTransaction);
    const signature = await this.omni.api.withdrawSign(args.nonce);

    if (args.token === "native") {
      await metaWallet.sendUserNativeWithdraw(executor, {
        userWallet: Address.parse(args.sender),
        signature: Buffer.from(baseDecode(signature)),
        excessAcc: Address.parse(args.refundAddress),
        nonce: BigInt(args.nonce),
        value: args.amount + toNano("0.12"),
        amount: args.amount,
      });
    }

    // withdraw token
    else {
      console.log("withdraw token", args);
      const { metaWallet, JettonMinter } = this.getMetaWallet();
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));
      const tokenAddress = await minter.getWalletAddressOf(metaWallet.address);

      await metaWallet.sendUserTokenWithdraw(executor, {
        userWallet: Address.parse(args.sender),
        signature: Buffer.from(baseDecode(signature)),
        excessAcc: Address.parse(args.refundAddress),
        token: tokenAddress,
        nonce: BigInt(args.nonce),
        amount: args.amount,
        value: toNano("0.12"),
      });
    }
  }

  async deposit(args: { refundAddress?: string; token: string; amount: bigint; intentAccount: string; sender: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const { metaWallet, JettonMinter, JettonWallet } = this.getMetaWallet();
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const executor = this.executor(args.sendTransaction);

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

    const tx = await this.tonApi.blockchain.getBlockchainTransaction(hash);
    const body = tx.outMsgs[0]?.rawBody;
    if (body == null) throw "Deposit tx not found";

    const slice = body.beginParse();
    const opCode = slice.loadUint(32);
    const queryId = slice.loadUintBig(64); // load but not use
    if (opCode !== 0x0f8a7ea5 && opCode !== OpCode.nativeDeposit) throw "Invalid op code";

    const deposit: PendingDeposit = {
      timestamp: Date.now(),
      sender: tx.account.address.toString({ bounceable: false }),
      chain: Network.OmniTon,
      receiver: "",
      nonce: "",
      amount: "",
      token: "",
      tx: hash,
    };

    if (opCode === 0x0f8a7ea5) {
      const event = events.actions.find((t) => t.JettonTransfer != null);
      if (event?.JettonTransfer == null) throw "Jetton transfer not found";
      deposit.token = event.JettonTransfer.jetton.address.toString({ bounceable: true });
      deposit.amount = slice.loadCoins().toString();
      deposit.receiver = baseEncode(slice.loadRef().beginParse().loadBuffer(32));
    }

    if (opCode === OpCode.nativeDeposit) {
      deposit.receiver = baseEncode(slice.loadBuffer(32));
      deposit.amount = slice.loadCoins().toString();
      deposit.token = "native";
    }

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
      if (nonce && BigInt(nonce) > 10n ** 30n) continue; // incorrect uint cell
      if (nonce) return { ...deposit, nonce };
    }

    throw "Deposit not found";
  }
}

export default TonOmniService;
