import { EventEmitter } from "events";
import {
  beginCell,
  MessageRelaxed,
  SendMode,
  OpenedContract,
  Cell,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
  internal,
  SenderArguments,
} from "@ton/ton";
import { KeyPair, keyPairFromSecretKey, mnemonicToPrivateKey } from "@ton/crypto";
import { bridge } from "./hooks/bridge";

export function createStateInit(code: Cell, data: Cell) {
  return beginCell()
    .storeUint(0, 2) // split_depth:(Maybe (## 5)) special:(Maybe TickTock)
    .storeMaybeRef(code) // code:(Maybe ^Cell)
    .storeMaybeRef(data) // data:(Maybe ^Cell)
    .storeDict(null) // library:(HashmapE 256 SimpleLib)
    .endCell();
}

export type TonWalletType = "v3r1" | "v3r2" | "v4" | "v5r1";
export const createWallet = (type: TonWalletType, publicKey: Buffer) => {
  switch (type) {
    case "v3r1":
      return WalletContractV3R1.create({ publicKey: publicKey, workchain: 0 });
    case "v3r2":
      return WalletContractV3R2.create({ publicKey: publicKey, workchain: 0 });
    case "v4":
      return WalletContractV4.create({ publicKey: publicKey, workchain: 0 });
    case "v5r1":
      return WalletContractV5R1.create({ publicKey: publicKey });
  }
};

export const tonWalletV5Address = (secret: Buffer) => {
  const keyPair = keyPairFromSecretKey(secret);
  const wallet = bridge.ton.client.open(createWallet("v5r1", keyPair.publicKey));
  const address = wallet.address.toString({ bounceable: false });
  return { type: "v5r1", address, balance: 0n } as const;
};

export const findTonWalletsByMnemonic = async (mnemonic: string) => {
  const keyPair = await mnemonicToPrivateKey(mnemonic.split(" "));
  return await findTonWallets(keyPair.secretKey);
};

export const findTonWallets = async (secret: Buffer) => {
  const keyPair = keyPairFromSecretKey(secret);

  const wallets = ["v5r1", "v4", "v3r2", "v3r1"] as const;
  const accounts: TonWallet[] = [];

  for (const type of wallets) {
    const wallet = bridge.ton.client.open(createWallet(type, keyPair.publicKey));
    const seqno = await wallet.getSeqno().catch(() => 0);
    if (seqno !== 0) accounts.push(new TonWallet(secret, type));
  }

  if (accounts.length === 0) {
    accounts.push(new TonWallet(secret, "v5r1"));
  }

  return accounts;
};

export class TonWallet {
  readonly keyPair: KeyPair;
  readonly contract: OpenedContract<WalletContractV3R1 | WalletContractV3R2 | WalletContractV4 | WalletContractV5R1>;

  constructor(readonly privateKey: Buffer, readonly walletType: TonWalletType = "v5r1") {
    this.keyPair = keyPairFromSecretKey(privateKey);
    this.contract = bridge.ton.client.open(createWallet(walletType, this.keyPair.publicKey));
  }

  pending: { event: any; messageHash: string; metadata: object; seqno: number } | null = null;
  events = new EventEmitter();

  get address() {
    return this.contract.address.toString({ bounceable: false });
  }

  get rawAddress() {
    return this.contract.address.toRawString();
  }

  get publicKey() {
    return this.keyPair.publicKey;
  }

  async createTransfer(messages: MessageRelaxed[], sendMode?: SendMode, seqno?: number) {
    seqno = seqno || (await this.contract.getSeqno());

    // @ts-expect-error: ---
    return await this.contract.createTransfer({
      sendMode: sendMode != null ? sendMode : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      timeout: (await bridge.ton.tonApi.liteServer.getRawTime()).time + 300,
      secretKey: this.keyPair.secretKey,
      messages,
      seqno,
    });
  }

  async pendingProcessing() {
    if (!this.pending) return;

    // Remove pending after 10 minutes...
    if (Math.floor(Date.now() / 1000) - this.pending.event.timestamp > 600) {
      this.pending = null;
      return;
    }

    await this.waitNextSeqno(this.pending.seqno);

    try {
      const tx = await this.waitTransactionByMessageHash(this.pending.messageHash);
      this.events.emit("transaction:success", { tx, ...this.pending });
    } catch (error) {
      this.events.emit("transaction:failed", { error, ...this.pending });
    } finally {
      this.pending = null;
    }
  }

  async sendTransactionAndWaitHash(args: SenderArguments) {
    const id = crypto.randomUUID();
    await this.sendTransaction([args], { id });
    return new Promise<string>((resolve, reject) => {
      this.events.on("transaction:success", (event) => {
        if (event.metadata?.id === id) resolve(event.tx);
      });

      this.events.on("transaction:failed", (event) => {
        if (event.metadata?.id === id) reject(event.error);
      });
    });
  }

  async sendTransaction(msgs: SenderArguments[], metadata?: object) {
    if (this.pending != null) throw "Wait until the previous transaction on TON is completed";
    const sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;

    const messages = msgs.map((msg) => internal(msg));
    const { seqno } = await bridge.ton.tonApi.wallet.getAccountSeqno(this.contract.address);
    const transfer: Cell = await this.createTransfer(messages, sendMode, seqno);

    const external = externalMessage(this.contract.address, this.contract.init, seqno, transfer);
    const { trace, event } = await bridge.ton.tonApi.request("/v2/wallet/emulate", {
      body: { boc: external.toBoc().toString("base64") },
      method: "POST",
    });

    const exitMessage = trace.transaction.compute_phase?.exit_code_description;
    if (!trace.transaction.success) throw exitMessage || "Transaction failed";

    const messageHash = trace.transaction.in_msg?.hash;
    if (messageHash == null) throw `Message hash is undefined`;

    await bridge.ton.tonApi.liteServer.sendRawMessage({ body: external });
    this.pending = { event, messageHash, seqno };
  }

  async waitTransactionByMessageHash(hash: string, attemps = 0): Promise<string> {
    if (attemps > 3) return "";

    await wait(5000);
    const tx = await bridge.ton.tonApi.blockchain.getBlockchainTransactionByMessageHash(hash).catch(() => null);
    if (tx == null) return await this.waitTransactionByMessageHash(hash, attemps + 1);
    if (!tx.success) throw tx.computePhase?.exitCodeDescription || "Transaction failed";
    return tx.hash;
  }
}
