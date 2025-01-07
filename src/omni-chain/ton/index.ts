import { Address, beginCell, OpenedContract, toNano } from "@ton/core";
import { baseDecode } from "@near-js/utils";
import uuid4 from "uuid4";

import { client, tonApi } from "../../signers/TonSigner";
import { PendingDeposit, TransferType } from "../types";
import { Network } from "../chains";
import { wait } from "../utils";
import OmniService from "..";

import { generateUserId, MIN_COMMISSION } from "./constants";
import { JettonMinter } from "./wrappers/jetton/JettonMinter";
import { JettonWallet } from "./wrappers/jetton/JettonWallet";
import { TonMetaWallet } from "./wrappers/TonMetaWallet";
import { DepositJetton } from "./wrappers/DepositJetton";
import { UserJetton } from "./wrappers/UserJetton";
import OmniToken from "../token";

class TonOmniService {
  readonly metaWallet = client.open(TonMetaWallet.createFromAddress(Address.parse("EQCuVv07tBHuJrgFrMcDJFHESoE6TpLLoNTuqdL2LkXi7JGM")));
  constructor(readonly omni: OmniService) {}

  get ton() {
    if (this.omni.signers.ton == null) throw "Connect TON";
    return this.omni.signers.ton;
  }

  private userOmniContract!: OpenedContract<UserJetton>;
  async getUserJettonAddress() {
    if (this.userOmniContract) return this.userOmniContract;
    const userId = generateUserId(Address.parse(this.ton.address), 0n);
    const address = await this.metaWallet.getUserJettonAddress(userId);
    this.userOmniContract = client.open(UserJetton.createFromAddress(address));
    return this.userOmniContract;
  }

  async getWithdrawFee() {
    const omniUser = await this.getUserJettonAddress();
    const lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce == null) return { withdraw: toNano(0.05), creation: toNano(0.05) };
    return { withdraw: toNano(0.05), creation: 0n };
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

  async withdraw(args: { transfer: TransferType; signature: string; nonce: string; takeFee?: boolean }) {
    const metadata = await this.omni.token(args.transfer.token_id).metadata(args.transfer.chain_id);
    const omniUser = await this.getUserJettonAddress();

    let lastNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
    if (lastNonce == null) throw "Create user before initiate withdraw on TON";

    const waitLastNonce = async (attemps = 0) => {
      if (attemps > 20) throw "Failed to fetch new last withdraw nonce";
      await wait(3000);
      const newNonce = await omniUser.getLastWithdrawnNonce().catch(() => null);
      if (newNonce == null || lastNonce >= newNonce) return await waitLastNonce(attemps + 1);
      return newNonce;
    };

    const activeWithdrawals = Object.values(await this.omni.getLastPendings());
    const existOlderWithdraw = activeWithdrawals.filter((t) => !t.completed && t.chain === Network.Ton);

    let maxLastUncompletedNonce = 0n;
    existOlderWithdraw.forEach((t) => {
      if (BigInt(t.nonce) > maxLastUncompletedNonce) maxLastUncompletedNonce = BigInt(t.nonce);
    });

    if (lastNonce > 0n) {
      if (lastNonce >= BigInt(args.nonce)) throw "Withdraw nonce already used";
      if (maxLastUncompletedNonce > BigInt(args.nonce))
        throw "You have an older, unfinished withdraw. Go back to transactions history and claim first";
    }

    const id = uuid4();
    if (metadata.address === "native") {
      await omniUser.sendUserNativeWithdraw(this.ton.executor({ id }), {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.transfer.amount),
        value: toNano(0.05),
      });
    }

    // withdraw token
    else {
      const minter = client.open(JettonMinter.createFromAddress(Address.parse(metadata.address)));
      const metaJettonWalletAddress = await minter.getWalletAddressOf(this.metaWallet.address);
      await omniUser.sendUserTokenWithdraw(this.ton.executor({ id }), {
        nonce: BigInt(args.nonce),
        signature: Buffer.from(baseDecode(args.signature)),
        amount: BigInt(args.transfer.amount),
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
        await waitLastNonce()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  async deposit(token: OmniToken, amount: bigint, to?: string) {
    const id = uuid4();
    const metadata = await token.metadata(Network.Ton);
    const receiverAddr = to ? this.omni.getOmniAddress(to) : this.omni.omniAddress;
    const receiver = Buffer.from(baseDecode(receiverAddr));

    if (metadata.address === "native") {
      await this.metaWallet.sendNativeDeposit(this.ton.executor({ id }), {
        value: amount + toNano(0.05),
        queryId: 0,
        receiver,
        amount,
      });
    }

    // deposit token
    else {
      const minter = client.open(JettonMinter.createFromAddress(Address.parse(metadata.address)));
      const userJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(this.ton.address));
      const userJetton = client.open(JettonWallet.createFromAddress(userJettonWalletAddress));
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

        const waitParseDeposit = async (attemps = 0) => {
          try {
            return await this.parseDeposit(tx);
          } catch (e) {
            if (attemps > 15) throw e;
            await wait(5000);
            return waitParseDeposit(attemps + 1);
          }
        };

        try {
          const deposit = await waitParseDeposit();
          const pending = this.omni.addPendingDeposit(deposit);
          resolve(pending);
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
    const depositJetton = client.open(DepositJetton.createFromAddress(depositAddress));
    await depositJetton.sendSelfDestruct(this.ton.executor(), { value: MIN_COMMISSION });
  }

  async parseDeposit(hash: string): Promise<PendingDeposit> {
    if (this.omni.deposits[hash]) return this.omni.deposits[hash];

    const events = await tonApi.events.getEvent(hash);
    const deployTxHash = events.actions.find((t) => t.ContractDeploy != null)?.baseTransactions[0];
    if (deployTxHash == null) throw "Deposit address not found";

    const tokenAddress = events.actions.find((t) => t.JettonTransfer != null)?.JettonTransfer?.jetton.address;
    const tokenAmount = events.actions.find((t) => t.JettonTransfer != null)?.JettonTransfer?.amount;
    if (tokenAddress == null) throw "Token address not found";

    const token = await this.omni.findToken(Network.Ton, tokenAddress.toString());
    if (token == null) throw "Token omni id not found";

    const tx = await tonApi.blockchain.getBlockchainTransaction(deployTxHash);
    if (tx.inMsg?.init?.boc == null) throw "Deploy tx not found";

    const slice = tx.inMsg.init.boc.beginParse();
    slice.loadRef();

    const slice1 = slice.loadRef().beginParse();
    slice1.loadAddressAny();
    slice1.loadAddressAny();

    return {
      chain: Network.Ton,
      receiver: this.omni.omniAddress,
      timestamp: events.timestamp * 1000,
      nonce: slice1.loadUintBig(128).toString(),
      amount: String(tokenAmount || 0),
      token: token.id,
      tx: hash,
    };
  }
}

export default TonOmniService;
