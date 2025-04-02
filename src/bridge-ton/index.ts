import { Address, beginCell, OpenedContract, toNano } from "@ton/core";
import { baseDecode } from "@near-js/utils";
import uuid4 from "uuid4";

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
  constructor(readonly omni: OmniService) {}

  get ton() {
    return this.omni.user.ton!;
  }

  get metaWallet() {
    if (this.omni.user.ton == null) throw "Connect TON";
    return this.omni.user.ton.client.open(
      TonMetaWallet.createFromAddress(Address.parse("EQAbCbnq3QDZCN2qi3wu6pM6e1xrSHkCdtLLSqJnWDYRGhPV"))
    );
  }

  private userOmniContract!: OpenedContract<UserJetton>;
  async getUserJettonAddress() {
    if (this.userOmniContract) return this.userOmniContract;
    const userId = generateUserId(Address.parse(this.ton.address), 0n);
    const address = await this.metaWallet.getUserJettonAddress(userId);
    this.userOmniContract = this.ton.client.open(UserJetton.createFromAddress(address));
    return this.userOmniContract;
  }

  async getWithdrawFee() {
    const omniUser = await this.getUserJettonAddress();
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    const additional = lastNonce ? 0n : toNano(0.05);
    const needNative = toNano(0.05) + additional;
    const realGas = toNano(0.025);

    const balance = await this.getTokenLiquidity("native", this.ton.address);
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
    const balance = (await this.ton.getBalance("native")) || 0n;
    return {
      maxFee: toNano(0.05),
      need: bigIntMax(0n, toNano(0.05) - balance),
      isNotEnough: balance < toNano(0.05),
      gasPrice: toNano(0.025),
      gasLimit: 1n,
      chain: Network.Ton,
    };
  }

  async getTokenLiquidity(token: string, address?: string): Promise<bigint> {
    const minter = this.ton.client.open(JettonMinter.createFromAddress(Address.parse(token)));
    const metaJettonWalletAddress = await minter.getWalletAddressOf(address ? Address.parse(address) : this.metaWallet.address);
    const userJetton = this.ton.client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
    return await userJetton.getJettonBalance();
  }

  async isNonceUsed(nonce: string): Promise<boolean> {
    const omniUser = await this.getUserJettonAddress();
    const lastNonce = await omniUser.getLastWithdrawnNonce();
    return BigInt(nonce) <= BigInt(lastNonce.toString());
  }

  async createUserIfNeeded() {
    const userId = generateUserId(Address.parse(this.ton.address), 0n);
    const omniUser = await this.getUserJettonAddress();

    const waitLastNonce = async (attemps = 0) => {
      if (attemps > 20) throw "Failed to fetch new last withdraw nonce";
      await wait(3000);

      const newNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
      if (newNonce == null) return await waitLastNonce(attemps + 1);
      return newNonce;
    };

    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce != null) return;

    const id = uuid4();
    await this.metaWallet.sendCreateUser(this.ton.executor({ id }), {
      userWalletAddress: Address.parse(this.ton.address),
      value: toNano(0.05),
      bump: 0n,
      userId,
    });

    await new Promise<void>((resolve, reject) => {
      this.ton.events.on("transaction:failed", async ({ metadata }) => {
        if (metadata.id == id) return reject("Create user failed");
      });

      this.ton.events.on("transaction:success", async ({ metadata }) => {
        if (metadata.id !== id) return;
        await waitLastNonce();
        resolve();
      });
    });
  }

  async withdraw(args: { amount: bigint; token: string; signature: string; nonce: string }) {
    const omniUser = await this.getUserJettonAddress();

    await this.createUserIfNeeded();
    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce == null) throw "Create user before initiate withdraw on TON";
    if (lastNonce >= BigInt(args.nonce)) throw "Withdraw nonce already used";

    const id = uuid4();
    if (args.token === "native") {
      await omniUser.sendUserNativeWithdraw(this.ton.executor({ id }), {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.amount),
        value: toNano(0.05),
      });
    }

    // withdraw token
    else {
      const minter = this.ton.client.open(JettonMinter.createFromAddress(Address.parse(args.token)));
      const metaJettonWalletAddress = await minter.getWalletAddressOf(this.metaWallet.address);
      await omniUser.sendUserTokenWithdraw(this.ton.executor({ id }), {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.amount),
        token: metaJettonWalletAddress,
        value: toNano(0.05),
      });
    }

    await new Promise<void>((resolve, reject) => {
      this.ton.events.on("transaction:failed", async ({ metadata }) => {
        if (metadata.id == id) return reject("Withdraw failed");
      });

      this.ton.events.on("transaction:success", async ({ metadata }) => {
        if (metadata.id !== id) return;
        resolve();
      });
    });
  }

  async deposit(address: string, amount: bigint, to?: string) {
    const id = uuid4();
    const receiverAddr = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const receiver = Buffer.from(receiverAddr, "hex");

    if (address === "native") {
      await this.metaWallet.sendNativeDeposit(this.ton.executor({ id }), {
        value: amount + toNano(0.05),
        queryId: 0,
        receiver,
        amount,
      });
    }

    // deposit token
    else {
      const minter = this.ton.client.open(JettonMinter.createFromAddress(Address.parse(address)));
      const userJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(this.ton.address));
      const userJetton = this.ton.client.open(JettonWallet.createFromAddress(userJettonWalletAddress));
      await userJetton.sendTransfer(
        this.ton.executor({ id }),
        toNano(0.05), // value
        toNano(0.05), // forwardValue
        this.metaWallet.address, // receiver
        amount,
        beginCell().storeBuffer(receiver).endCell()
      );
    }

    return new Promise<PendingDeposit>((resolve, reject) => {
      this.ton.events.on("transaction:failed", async ({ metadata }) => {
        if (metadata.id == id) return reject("Transaction failed");
      });

      this.ton.events.on("transaction:success", async ({ tx, metadata }) => {
        if (metadata.id !== id) return;
        const deposit = this.omni.addPendingDeposit({
          chain: Network.Ton,
          receiver: receiverAddr,
          timestamp: Date.now(),
          amount: String(amount),
          token: address,
          nonce: "",
          tx: tx,
        });

        const waitParseDeposit = async (attemps = 0) => {
          try {
            return await this.parseDeposit(deposit);
          } catch (e) {
            if (attemps > 15) throw e;
            await wait(5000);
            return waitParseDeposit(attemps + 1);
          }
        };

        try {
          const deposit = await waitParseDeposit();
          resolve(this.omni.addPendingDeposit(deposit));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    const isUsed = await this.omni.isDepositUsed(Network.Ton, deposit.nonce);
    if (!isUsed) return;

    const depositAddress = await this.metaWallet.getDepositJettonAddress(BigInt(deposit.nonce));
    const depositJetton = this.ton.client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.ton.executor(), { value: MIN_COMMISSION });
  }

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;

    const events = await this.ton.tonApi.events.getEvent(deposit.tx);
    const deployTxHash = events.actions.reverse().find((t) => t.ContractDeploy != null)?.baseTransactions[0];
    if (deployTxHash == null) throw "Deposit address not found";

    const tx = await this.ton.tonApi.blockchain.getBlockchainTransaction(deployTxHash);
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
