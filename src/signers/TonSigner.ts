import { TonApiClient } from "@ton-api/client";
import { ContractAdapter } from "@ton-api/ton-adapter";
import { KeyPair, keyPairFromSecretKey } from "@ton/crypto";
import EventEmitter from "eventemitter3";
import {
  Address,
  internal,
  beginCell,
  SendMode,
  MessageRelaxed,
  OpenedContract,
  SenderArguments,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
  Cell,
  storeMessage,
  StateInit,
  external,
} from "@ton/ton";

import { wait } from "../utils";
import { baseDecode, baseEncode } from "@near-js/utils";

function createStateInit(code: Cell, data: Cell) {
  return beginCell()
    .storeUint(0, 2) // split_depth:(Maybe (## 5)) special:(Maybe TickTock)
    .storeMaybeRef(code) // code:(Maybe ^Cell)
    .storeMaybeRef(data) // data:(Maybe ^Cell)
    .storeDict(null) // library:(HashmapE 256 SimpleLib)
    .endCell();
}

export const externalMessage = (address: Address, init: StateInit, seqno: number, body: Cell) => {
  return beginCell()
    .storeWritable(storeMessage(external({ to: address, init: seqno === 0 ? init : undefined, body: body })))
    .endCell();
};

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

class TonSigner {
  readonly keyPair: KeyPair;
  readonly wallet: OpenedContract<WalletContractV3R1 | WalletContractV3R2 | WalletContractV4 | WalletContractV5R1>;
  readonly events = new EventEmitter<{
    "transaction:success": { tx: string; metadata?: object };
    "transaction:failed": { metadata?: object; error: string };
  }>();

  tonApi: TonApiClient;
  client: ContractAdapter;
  pending: { event: any; messageHash: string; metadata?: object; seqno: number } | null = null;

  constructor(privateKey: string, readonly walletType: TonWalletType = "v5r1", tonApiKey: string) {
    this.tonApi = new TonApiClient({ apiKey: tonApiKey });
    this.client = new ContractAdapter(this.tonApi);

    this.keyPair = keyPairFromSecretKey(Buffer.from(baseDecode(privateKey)));
    this.wallet = this.client.open(createWallet(walletType, this.keyPair.publicKey));
  }

  tonApiRequest = async (request: string, params: { body?: object; method?: "GET" | "POST" } = {}) => {
    const res = await this.tonApi.http.request({ body: params.body, path: request, method: params.method || "GET", format: "json" });
    return res;
  };

  get address() {
    return this.wallet.address.toString({ bounceable: false });
  }

  get publicKey() {
    return this.wallet.publicKey;
  }

  async pendingProcessing() {
    if (!this.pending) return;

    // Remove pending after 10 minutes...
    if (Math.floor(Date.now() / 1000) - this.pending.event.timestamp > 600) {
      this.pending = null;
      return;
    }

    try {
      await this.waitNextSeqno(this.pending.seqno);
      const tx = await this.waitTransactionByMessageHash(this.pending.messageHash);
      this.events.emit("transaction:success", { tx, ...this.pending });
    } catch (error) {
      this.events.emit("transaction:failed", { error, ...this.pending });
    } finally {
      this.pending = null;
    }
  }

  async createTransfer(messages: MessageRelaxed[], sendMode?: SendMode, seqno?: number) {
    seqno = seqno || (await this.wallet.getSeqno());

    // @ts-ignore
    return await this.wallet.createTransfer({
      sendMode: sendMode != null ? sendMode : SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      timeout: (await this.tonApi.liteServer.getRawTime()).time + 300,
      secretKey: this.keyPair.secretKey,
      messages,
      seqno,
    });
  }

  getWalletStateInit() {
    return createStateInit(this.wallet.init.code, this.wallet.init.data).toBoc().toString("base64");
  }

  async sendTransaction(messages: MessageRelaxed[], sendMode?: any, metadata?: object) {
    if (this.pending != null) throw "Wait until the previous transaction on TON is completed";
    sendMode = sendMode ?? SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;

    const { seqno } = await this.tonApi.wallet.getAccountSeqno(this.wallet.address);
    const transfer: Cell = await this.createTransfer(messages, sendMode, seqno);

    const external = externalMessage(this.wallet.address, this.wallet.init, seqno, transfer);
    const { trace, event } = await this.tonApiRequest("/v2/wallet/emulate", {
      body: { boc: external.toBoc().toString("base64") },
      method: "POST",
    });

    const exitMessage = trace.transaction.compute_phase?.exit_code_description;
    if (!trace.transaction.success) throw exitMessage || "Transaction failed";

    const messageHash = trace.transaction.in_msg?.hash;
    if (messageHash == null) throw `Message hash is undefined`;

    await this.tonApi.blockchain.sendBlockchainMessage({ boc: external });
    this.pending = { event: event, messageHash, metadata, seqno };
  }

  setPendingMetadata(metadata: any) {
    if (!this.pending) return;
    this.pending.metadata = metadata;
  }

  async waitTransactionByMessageHash(hash: string, attemps = 0): Promise<string> {
    if (attemps > 3) return "";

    await wait(5000);
    const tx = await this.tonApi.blockchain.getBlockchainTransactionByMessageHash(hash).catch(() => null);
    if (tx == null) return await this.waitTransactionByMessageHash(hash, attemps + 1);

    if (!tx.success) throw tx.computePhase?.exitCodeDescription || "Transaction failed";
    return tx.hash;
  }

  executor(metadata?: object) {
    return {
      send: async (args: SenderArguments) => {
        const msg = internal({ to: args.to, value: args.value, init: args.init, body: args.body, bounce: args.bounce });
        await this.sendTransaction([msg], args.sendMode, metadata);
      },
    };
  }

  async waitNextSeqno(seqno: number): Promise<number> {
    await wait(3000);
    const nextSeqno = await this.tonApi.wallet.getAccountSeqno(this.wallet.address).catch(() => ({ seqno: 0 }));
    if (seqno >= nextSeqno.seqno) return await this.waitNextSeqno(seqno);
    return nextSeqno.seqno;
  }

  async getBalance(address: string) {
    try {
      if (address === "native") return await this.wallet.getBalance();
      const jetton = await this.tonApi.accounts.getAccountJettonBalance(this.wallet.address, Address.parse(address), {
        supported_extensions: ["custom_payload"],
      });

      return BigInt(jetton.balance);
    } catch (e) {
      return 0n;
    }
  }
}

export default TonSigner;
