import { address, Address, beginCell, SenderArguments, toNano } from "@ton/core";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import { Network } from "../chains";
import { omniEphemeralReceiver, wait } from "../utils";
import OmniService from "../bridge";

import { PendingDeposit } from "../types";
import { generateUserId, MIN_COMMISSION } from "./constants";
import { JettonMinter } from "./wrappers/jetton/JettonMinter";
import { JettonWallet } from "./wrappers/jetton/JettonWallet";
import { TonMetaWallet } from "./wrappers/TonMetaWallet";
import { DepositJetton } from "./wrappers/DepositJetton";
import { UserJetton } from "./wrappers/UserJetton";

class TonOmniService {
  tonApi: TonApiClient;
  client: ContractAdapter;

  constructor(readonly omni: OmniService, tonApiKey?: string) {
    this.tonApi = new TonApiClient({ apiKey: tonApiKey });
    this.client = new ContractAdapter(this.tonApi);
  }

  get metaWallet() {
    return this.client.open(TonMetaWallet.createFromAddress(Address.parse("EQAbCbnq3QDZCN2qi3wu6pM6e1xrSHkCdtLLSqJnWDYRGhPV")));
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

  async isWithdrawUsed(nonce: string, userId: string): Promise<boolean> {
    const omniUser = await this.getUserJettonAddress(BigInt(userId));
    const lastNonce = await omniUser.getLastWithdrawnNonce();
    return BigInt(nonce) <= BigInt(lastNonce.toString());
  }

  async isUserExists(userId: string): Promise<boolean> {
    const omniUser = await this.getUserJettonAddress(BigInt(userId));
    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    return lastNonce != null;
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

    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce != null) return;

    await this.metaWallet.sendCreateUser(this.executor(args.sendTransaction), {
      userWalletAddress: Address.parse(args.address),
      value: toNano(0.05),
      userId: userId,
      bump: 0n,
    });

    await waitLastNonce();
  }

  async withdraw(args: {
    amount: bigint;
    token: string;
    signature: string;
    nonce: string;
    receiver: string;
    sendTransaction: (tx: SenderArguments) => Promise<string>;
  }) {
    const omniUser = await this.getUserJettonAddress(BigInt(args.receiver));
    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
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

  async deposit(args: {
    token: string;
    amount: bigint;
    getIntentAccount: () => Promise<string>;
    getAddress: () => Promise<string>;
    sendTransaction: (tx: SenderArguments) => Promise<string>;
  }) {
    const intentAccount = await args.getIntentAccount();
    const receiver = omniEphemeralReceiver(intentAccount);
    const executor = this.executor(args.sendTransaction);

    if (args.token === "native") {
      this.omni.logger?.log(`Depositing ${args.amount} TON to ${intentAccount}`);
      await this.metaWallet.sendNativeDeposit(executor, {
        value: args.amount + toNano(0.05),
        receiver: receiver,
        amount: args.amount,
        queryId: 0,
      });
    }

    // deposit token
    else {
      this.omni.logger?.log(`Depositing ${args.amount} ${args.token} to ${intentAccount}`);
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));

      this.omni.logger?.log(`Getting wallet address of ${address}`);
      const userJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(await args.getAddress()));

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
    const sender = await args.getAddress();
    const deposit = {
      chain: Network.Ton,
      intentAccount,
      receiver: baseEncode(receiver),
      timestamp: Date.now(),
      amount: String(args.amount),
      tx: executor.hash,
      token: args.token,
      nonce: "",
      sender,
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
    return await waitParseDeposit();
  }

  async clearDepositNonceIfNeeded(args: { deposit: PendingDeposit; sendTransaction: (tx: SenderArguments) => Promise<string> }) {
    const isUsed = await this.omni.isDepositUsed(Network.Ton, args.deposit.nonce);
    if (!isUsed) return;

    const depositAddress = await this.metaWallet.getDepositJettonAddress(BigInt(args.deposit.nonce));
    const depositJetton = this.client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.executor(args.sendTransaction), { value: MIN_COMMISSION });
  }

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;

    const events = await this.tonApi.events.getEvent(deposit.tx);
    const deployTxHash = events.actions.reverse().find((t) => t.ContractDeploy != null)?.baseTransactions[0];
    if (deployTxHash == null) throw "Deposit address not found";

    const tx = await this.tonApi.blockchain.getBlockchainTransaction(deployTxHash);
    if (tx.inMsg?.init?.boc == null) throw "Deploy tx not found";

    const slice = tx.inMsg.init.boc.beginParse();
    slice.loadRef();

    const slice1 = slice.loadRef().beginParse();
    slice1.loadAddressAny();
    slice1.loadAddressAny();

    return { ...deposit, nonce: slice1.loadUintBig(128).toString() };
  }
}

export default TonOmniService;
