import { Address, beginCell, OpenedContract, SenderArguments, toNano } from "@ton/core";
import { baseDecode } from "@near-js/utils";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { TonApiClient } from "@ton-api/client";

import { Chains, Network } from "../chains";
import { bigIntMax, getOmniAddressHex, wait } from "../utils";
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

  constructor(readonly omni: OmniService) {
    this.tonApi = new TonApiClient({ apiKey: this.omni.signers.ton?.tonApiKey });
    this.client = new ContractAdapter(this.tonApi);
  }

  get ton() {
    return this.omni.signers.ton!;
  }

  get metaWallet() {
    return this.client.open(TonMetaWallet.createFromAddress(Address.parse("EQAbCbnq3QDZCN2qi3wu6pM6e1xrSHkCdtLLSqJnWDYRGhPV")));
  }

  _lastHash?: string;
  executor() {
    this._lastHash = undefined;
    return {
      send: async (args: SenderArguments) => {
        this._lastHash = await this.ton.sendTransaction(args);
      },
    };
  }

  private userOmniContract!: OpenedContract<UserJetton>;
  async getUserJettonAddress(receiver: string) {
    if (this.userOmniContract) return this.userOmniContract;
    const userId = generateUserId(Address.parse(receiver), 0n);
    const address = await this.metaWallet.getUserJettonAddress(userId);
    this.userOmniContract = this.client.open(UserJetton.createFromAddress(address));
    return this.userOmniContract;
  }

  async getWithdrawFee(receiver: string) {
    const omniUser = await this.getUserJettonAddress(receiver);
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    const additional = lastNonce ? 0n : toNano(0.05);
    const needNative = toNano(0.05) + additional;
    const realGas = toNano(0.025);

    const balance = await this.getTokenBalance("native");
    if (balance >= needNative) return { need: 0n, canPerform: true, amount: realGas, decimal: Chains.get(Network.Ton).decimal, additional };

    return {
      need: bigIntMax(0n, needNative - balance),
      canPerform: false,
      decimal: Chains.get(Network.Ton).decimal,
      amount: realGas,
      additional,
    };
  }

  async getDepositFee() {
    const balance = (await this.getTokenBalance("native")) || 0n;
    return {
      maxFee: toNano(0.05),
      need: bigIntMax(0n, toNano(0.05) - balance),
      isNotEnough: balance < toNano(0.05),
      gasPrice: toNano(0.025),
      gasLimit: 1n,
      chain: Network.Ton,
    };
  }

  async getTokenBalance(token: string, address?: string): Promise<bigint> {
    if (token === "native") return await this.getTokenBalance("native");
    const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(token)));
    const metaJettonWalletAddress = await minter.getWalletAddressOf(address ? Address.parse(address) : this.metaWallet.address);
    const userJetton = this.client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
    return await userJetton.getJettonBalance();
  }

  async isNonceUsed(nonce: string, receiver: string): Promise<boolean> {
    const omniUser = await this.getUserJettonAddress(receiver);
    const lastNonce = await omniUser.getLastWithdrawnNonce();
    return BigInt(nonce) <= BigInt(lastNonce.toString());
  }

  async createUserIfNeeded(receiver: string) {
    const userId = generateUserId(Address.parse(receiver), 0n);
    const omniUser = await this.getUserJettonAddress(receiver);

    const waitLastNonce = async (attemps = 0) => {
      if (attemps > 20) throw "Failed to fetch new last withdraw nonce";
      await wait(3000);

      const newNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
      if (newNonce == null) return await waitLastNonce(attemps + 1);
      return newNonce;
    };

    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce != null) return;

    await this.metaWallet.sendCreateUser(this.executor(), {
      userWalletAddress: Address.parse(receiver),
      value: toNano(0.05),
      bump: 0n,
      userId,
    });

    await waitLastNonce();
  }

  async withdraw(args: { amount: bigint; token: string; signature: string; nonce: string; receiver: string }) {
    const omniUser = await this.getUserJettonAddress(args.receiver);

    await this.createUserIfNeeded(args.receiver);
    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce == null) throw "Create user before initiate withdraw on TON";
    if (lastNonce >= BigInt(args.nonce)) throw "Withdraw nonce already used";

    if (args.token === "native") {
      await omniUser.sendUserNativeWithdraw(this.executor(), {
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
      await omniUser.sendUserTokenWithdraw(this.executor(), {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.amount),
        token: metaJettonWalletAddress,
        value: toNano(0.05),
      });
    }
  }

  async deposit(address: string, amount: bigint, to: string) {
    const receiverAddr = getOmniAddressHex(to);
    const receiver = Buffer.from(receiverAddr, "hex");

    if (address === "native") {
      this.omni.logger?.log(`Depositing ${amount} TON to ${receiverAddr}`);
      await this.metaWallet.sendNativeDeposit(this.executor(), {
        value: amount + toNano(0.05),
        queryId: 0,
        receiver,
        amount,
      });
    }

    // deposit token
    else {
      this.omni.logger?.log(`Depositing ${amount} ${address} to ${receiverAddr}`);
      const minter = this.client.open(JettonMinter.createFromAddress(Address.parse(address)));

      this.omni.logger?.log(`Getting wallet address of ${address}`);
      const userJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(to));

      this.omni.logger?.log(`Sending transfer`);
      const userJetton = this.client.open(JettonWallet.createFromAddress(userJettonWalletAddress));
      await userJetton.sendTransfer(
        this.executor(),
        toNano(0.05), // value
        toNano(0.05), // forwardValue
        this.metaWallet.address, // receiver
        amount,
        beginCell().storeBuffer(receiver).endCell()
      );
    }

    if (!this._lastHash) throw "Failed to send transaction";
    const sender = await this.ton.getAddress();
    const deposit = this.omni.addPendingDeposit({
      chain: Network.Ton,
      receiver: receiverAddr,
      timestamp: Date.now(),
      amount: String(amount),
      tx: this._lastHash,
      token: address,
      nonce: "",
      sender,
    });

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
    return this.omni.addPendingDeposit(await waitParseDeposit());
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    const isUsed = await this.omni.isDepositUsed(Network.Ton, deposit.nonce);
    if (!isUsed) return;

    const depositAddress = await this.metaWallet.getDepositJettonAddress(BigInt(deposit.nonce));
    const depositJetton = this.client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.executor(), { value: MIN_COMMISSION });
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
