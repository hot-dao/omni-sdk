import { address, Address, beginCell, SenderArguments, toNano } from "@ton/core";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import { Network } from "../chains";
import { omniEphemeralReceiver, wait } from "../utils";
import OmniService from "../bridge";

import { PendingDeposit, PendingDepositWithIntent, ReviewFee } from "../types";
import { generateUserId, MIN_COMMISSION } from "./constants";
import { JettonMinter } from "./wrappers/jetton/JettonMinter";
import { JettonWallet } from "./wrappers/jetton/JettonWallet";
import { TonMetaWallet } from "./wrappers/TonMetaWallet";
import { DepositJetton } from "./wrappers/DepositJetton";
import { UserJetton } from "./wrappers/UserJetton";

class TonOmniService {
  readonly tonApi: TonApiClient;
  readonly client: ContractAdapter;

  constructor(readonly omni: OmniService, rpc?: TonApiClient | string) {
    this.tonApi = rpc instanceof TonApiClient ? rpc : new TonApiClient({ apiKey: rpc });
    this.client = new ContractAdapter(this.tonApi);
  }

  get metaWallet() {
    return this.client.open(TonMetaWallet.createFromAddress(Address.parse("EQAbCbnq3QDZCN2qi3wu6pM6e1xrSHkCdtLLSqJnWDYRGhPV")));
  }

  async getWithdrawFee(receiver: string): Promise<ReviewFee> {
    const userId = generateUserId(Address.parse(receiver), 0n);
    const omniUser = await this.getUserJettonAddress(userId);
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    const additional = lastNonce ? 0n : toNano(0.05);
    const needNative = toNano(0.05) + additional;
    const realGas = toNano(0.025);

    return { reserve: needNative, gasPrice: realGas, gasLimit: 1n, chain: Network.Ton, additional };
  }

  async getDepositFee(token: string): Promise<ReviewFee> {
    const need = token === "native" ? toNano(0.05) : toNano(0.1);
    return {
      reserve: need,
      gasPrice: need / 2n,
      chain: Network.Ton,
      gasLimit: 1n,
    };
  }

  async getTokenLiquidity(token: string): Promise<bigint> {
    const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(token)));
    const metaJettonWalletAddress = await minter.getWalletAddressOf(this.metaWallet.address);
    const userJetton = this.client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
    return await userJetton.getJettonBalance();
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

  async getUserJettonAddress(userId: bigint) {
    const address = await this.metaWallet.getUserJettonAddress(userId);
    return this.client.open(UserJetton.createFromAddress(address));
  }

  async getTokenBalance(token: string, address?: string): Promise<bigint> {
    if (token === "native") return await this.getTokenBalance("native");
    const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(token)));
    const metaJettonWalletAddress = await minter.getWalletAddressOf(address ? Address.parse(address) : this.metaWallet.address);
    const userJetton = this.client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
    return await userJetton.getJettonBalance();
  }

  async isWithdrawUsed(nonce: string, receiver: string): Promise<boolean> {
    const userId = Address.isFriendly(receiver) ? generateUserId(Address.parse(receiver), 0n) : BigInt(receiver);
    const omniUser = await this.getUserJettonAddress(userId);
    const lastNonce = await omniUser.getLastWithdrawnNonce();
    return BigInt(nonce) <= BigInt(lastNonce.toString());
  }

  async isUserExists(userId: string): Promise<boolean> {
    const omniUser = await this.getUserJettonAddress(BigInt(userId));
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    return lastNonce != null;
  }

  async getUserAddress(userId: bigint) {
    const omniUser = await this.getUserJettonAddress(userId);
    return await omniUser.getUserWalletAddress();
  }

  async createUserIfNeeded(args: { address: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const userId = generateUserId(Address.parse(args.address), 0n);
    const omniUser = await this.getUserJettonAddress(userId);

    const waitLastNonce = async (attemps = 0) => {
      if (attemps > 20) throw "Failed to fetch new last withdraw nonce";
      await wait(3000);

      const newNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
      if (newNonce == null) return await waitLastNonce(attemps + 1);
      return newNonce;
    };

    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce != null) return;

    await this.metaWallet.sendCreateUser(this.executor(args.sendTransaction), {
      userWalletAddress: Address.parse(args.address),
      value: toNano(0.05),
      userId: userId,
      bump: 0n,
    });

    await waitLastNonce();
  }

  async withdraw(args: { amount: bigint; token: string; signature: string; nonce: string; receiver: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const omniUser = await this.getUserJettonAddress(BigInt(args.receiver));
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce == null) throw "Create user before initiate withdraw on TON";
    if (lastNonce >= BigInt(args.nonce)) throw "Withdraw nonce already used";

    const executor = this.executor(args.sendTransaction);

    if (args.token === "native") {
      await omniUser.sendUserNativeWithdraw(executor, {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.amount),
        value: toNano(0.05),
      });
    }

    // withdraw token
    else {
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));
      const metaJettonWalletAddress = await minter.getWalletAddressOf(this.metaWallet.address);
      await omniUser.sendUserTokenWithdraw(executor, {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.amount),
        token: metaJettonWalletAddress,
        value: toNano(0.05),
      });
    }
  }

  async deposit(args: { token: string; amount: bigint; intentAccount: string; sender: string; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const executor = this.executor(args.sendTransaction);

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing ${args.amount} TON to ${args.intentAccount}`);
      await this.metaWallet.sendNativeDeposit(executor, {
        value: args.amount + toNano(0.05),
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

      await userJetton.sendTransfer(
        executor,
        toNano(0.05), // value
        toNano(0.05), // forwardValue
        this.metaWallet.address, // receiver
        args.amount,
        beginCell().storeBuffer(receiver).endCell()
      );
    }

    if (!executor.hash) throw "Failed to send transaction";
    const deposit: PendingDepositWithIntent = {
      chain: Network.Ton,
      intentAccount: args.intentAccount,
      receiver: baseEncode(receiver),
      timestamp: Date.now(),
      amount: String(args.amount),
      sender: args.sender,
      token: args.token,
      tx: executor.hash,
      nonce: "",
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
    const isUsed = await this.omni.isDepositUsed(Network.Ton, args.nonce);
    if (!isUsed) return;

    const depositAddress = await this.metaWallet.getDepositJettonAddress(BigInt(args.nonce));
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

export default TonOmniService;
