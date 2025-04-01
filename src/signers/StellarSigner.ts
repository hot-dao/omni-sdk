import {
  rpc,
  Horizon,
  BASE_FEE,
  Asset,
  TimeoutInfinite,
  TransactionBuilder,
  Networks,
  Address,
  xdr,
  Contract,
  Operation,
  Transaction,
  FeeBumpTransaction,
  Keypair,
} from "@stellar/stellar-sdk";
import BigNumber from "bignumber.js"; // @ts-ignore

import { wait } from "../utils";
import { baseDecode } from "@near-js/utils";

export const ACCOUNT_FOR_SIMULATE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

export enum ASSET_CONTRACT_METHOD {
  GET_ALLOWANCE = "allowance",
  APPROVE_ALLOWANCE = "approve",
  GET_BALANCE = "balance",
  TRANSFER = "transfer",
  NAME = "name",
  BURN = "burn",
}

class StellarSigner {
  readonly soroban: rpc.Server;
  readonly horizon: Horizon.Server;
  readonly keyPair: Keypair;

  constructor(privateKey: string, horizon: string, soroban: string) {
    this.soroban = new rpc.Server(soroban);
    this.horizon = new Horizon.Server(horizon);
    this.keyPair = Keypair.fromRawEd25519Seed(Buffer.from(baseDecode(privateKey)));
  }

  get address() {
    return this.keyPair.publicKey();
  }

  async signTransaction(tx: Transaction | FeeBumpTransaction) {
    const hash = tx.hash();
    const signature = this.keyPair.signDecorated(hash);
    tx.signatures.push(signature);
  }

  async activateToken(address: string | Asset) {
    const asset = address instanceof Asset ? address : await this.getAssetFromContractId(address);
    const account = await this.horizon.loadAccount(this.address);
    const trustlineOp = Operation.changeTrust({ asset: asset, source: this.address });
    const trustlineTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(trustlineOp)
      .setTimeout(TimeoutInfinite)
      .build();

    await this.signTransaction(trustlineTx);
    await this.submitTransaction(trustlineTx);
  }

  async submitTransaction(tx: Transaction | FeeBumpTransaction): Promise<string> {
    const res = await this.soroban.sendTransaction(tx);
    if (res.status === "ERROR") throw `Transaction failed`;

    const poolTransaction = async (attempts = 0) => {
      if (attempts > 20) throw `Transaction failed`;
      await wait(2000);

      const status = await this.soroban.getTransaction(res.hash).catch(() => null);
      if (status?.status === "SUCCESS") return res.hash;
      await poolTransaction(attempts + 1);
    };

    await poolTransaction();
    return res.hash;
  }

  async buildSmartContactTx(publicKey: string, contactId: string, method: string, ...args: any[]) {
    const account = await this.soroban.getAccount(publicKey);
    const contract = new Contract(contactId);
    const builtTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC });

    if (args) builtTx.addOperation(contract.call(method, ...args));
    else builtTx.addOperation(contract.call(method));
    return builtTx.setTimeout(TimeoutInfinite).build();
  }

  assetsCache = new Map<string, Asset>();
  async getAssetFromContractId(id: string): Promise<Asset> {
    if (id === "native") return Asset.native();
    if (this.assetsCache.has(id)) {
      return Promise.resolve(this.assetsCache.get(id)!);
    }

    const tx = await this.buildSmartContactTx(ACCOUNT_FOR_SIMULATE, id, ASSET_CONTRACT_METHOD.NAME);
    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;

    const value = result?.result?.retval?.value();
    if (!value) throw "Asset not found";

    const [code, issuer] = value.toString().split(":");
    const asset = issuer ? new Asset(code, issuer) : Asset.native();
    this.assetsCache.set(id, asset);
    return asset;
  }

  async getTokenBalance(token: Asset | string, contract: string) {
    const tx = await this.buildSmartContactTx(
      ACCOUNT_FOR_SIMULATE, //
      typeof token === "string"
        ? token === "native"
          ? new Asset("XLM").contractId(Networks.PUBLIC)
          : token
        : token.contractId(Networks.PUBLIC),
      ASSET_CONTRACT_METHOD.GET_BALANCE,
      Address.fromString(contract).toScVal()
    );

    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;
    if (result) return this.i128ToInt(result.result?.retval.value() as xdr.Int128Parts);
    return null;
  }

  i128ToInt(val: xdr.Int128Parts): string {
    // @ts-ignore
    return new BigNumber(val.hi()._value).plus(val.lo()._value).div(1e7).toString();
  }
}

export default StellarSigner;
