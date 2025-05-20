import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Networks,
  rpc,
  scValToBigInt,
  StrKey,
  TimeoutInfinite,
  TransactionBuilder,
  xdr,
  XdrLargeInt,
} from "@stellar/stellar-sdk";
import { Operation, Transaction } from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import BigNumber from "bignumber.js"; // @ts-ignore

import { omniEphemeralReceiver, parseAmount } from "../utils";
import { PendingDeposit, PendingDepositWithIntent } from "../types";
import { Network } from "../chains";
import OmniService from "../bridge";
import OmniApi from "../api";

export const ACCOUNT_FOR_SIMULATE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
export const CONTRACT = "CCLWL5NYSV2WJQ3VBU44AMDHEVKEPA45N2QP2LL62O3JVKPGWWAQUVAG";

class StellarService {
  readonly soroban: rpc.Server;
  readonly horizon: Horizon.Server;

  constructor(readonly omni: OmniService) {
    this.soroban = new rpc.Server("https://mainnet.sorobanrpc.com");
    this.horizon = new Horizon.Server("https://horizon.stellar.org");
  }

  async isWithdrawUsed(nonce: string) {
    const tx = await this.buildSmartContactTx(ACCOUNT_FOR_SIMULATE, CONTRACT, "is_executed", new XdrLargeInt("u128", nonce).toU128());
    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;
    return result.result?.retval.value();
  }

  async buildDepositTx(sender: string, token: string, amount: bigint, intentAccount: Buffer) {
    const ts = await OmniApi.shared.getTime();

    const contractId = token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : token;
    const call = new Contract(CONTRACT).call(
      "deposit",
      Address.fromString(sender).toScVal(),
      new XdrLargeInt("u128", amount.toString()).toU128(),
      xdr.ScVal.scvAddress(Address.contract(StrKey.decodeContract(contractId)).toScAddress()),
      xdr.ScVal.scvBytes(intentAccount),
      new XdrLargeInt("u128", ts.toString()).toU128()
    );

    const account = await this.horizon.loadAccount(sender);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    return { nonce: String(ts), tx: await this.soroban.prepareTransaction(tx.build()) };
  }

  async deposit(args: {
    token: string;
    amount: bigint;
    getIntentAccount: () => Promise<string>;
    getAddress: () => Promise<string>;
    sendTransaction: (tx: Transaction) => Promise<string>;
  }): Promise<PendingDepositWithIntent> {
    const sender = await args.getAddress();
    const intentAccount = await args.getIntentAccount();
    const receiver = omniEphemeralReceiver(intentAccount);
    const { tx, nonce } = await this.buildDepositTx(sender, args.token, args.amount, receiver);
    const hash = await args.sendTransaction(tx);

    return {
      intentAccount,
      receiver: baseEncode(receiver),
      timestamp: Date.now(),
      amount: String(args.amount),
      chain: Network.Stellar,
      token: args.token,
      tx: hash,
      sender,
      nonce,
    };
  }

  async withdraw(args: {
    amount: bigint;
    token: string;
    signature: string;
    nonce: string;
    receiver: string;
    getAddress: () => Promise<string>;
    sendTransaction: (tx: Transaction) => Promise<string>;
  }) {
    const to = new Contract(CONTRACT);
    const sign = Buffer.from(baseDecode(args.signature));

    if (args.token !== "native") await this.activateToken(args);
    const contractId = args.token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : args.token;

    const call = to.call(
      "withdraw",
      new XdrLargeInt("u128", args.amount.toString()).toU128(),
      new XdrLargeInt("u128", args.nonce).toU128(),
      Address.fromString(contractId).toScVal(),
      Address.fromString(args.receiver).toScVal(),
      xdr.ScVal.scvBytes(sign)
    );

    const sender = await args.getAddress();
    const account = await this.horizon.loadAccount(sender);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    const preparedTx = await this.soroban.prepareTransaction(tx.build());
    return await args.sendTransaction(preparedTx);
  }

  async clearDepositNonceIfNeeded(_: PendingDeposit) {}

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;
    const txResult = await this.soroban.getTransaction(deposit.tx);
    if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw "";
    const nonce = scValToBigInt(txResult.resultMetaXdr.v3().sorobanMeta()!.returnValue());
    return { ...deposit, nonce: nonce.toString() };
  }

  async activateToken(args: {
    token: string | Asset;
    getAddress: () => Promise<string>;
    sendTransaction: (tx: Transaction) => Promise<string>;
  }) {
    const sender = await args.getAddress();
    const asset = args.token instanceof Asset ? args.token : await this.getAssetFromContractId(args.token);
    const account = await this.horizon.loadAccount(sender);

    const trustlineOp = Operation.changeTrust({ asset: asset, source: sender });
    const trustlineTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(trustlineOp)
      .setTimeout(TimeoutInfinite)
      .build();

    return await args.sendTransaction(trustlineTx);
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

    const tx = await this.buildSmartContactTx(ACCOUNT_FOR_SIMULATE, id, "name");
    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;

    const value = result?.result?.retval?.value();
    if (!value) throw "Asset not found";

    const [code, issuer] = value.toString().split(":");
    const asset = issuer ? new Asset(code, issuer) : Asset.native();
    this.assetsCache.set(id, asset);
    return asset;
  }

  async getTokenBalance(token: Asset | string, contract = CONTRACT) {
    const tx = await this.buildSmartContactTx(
      ACCOUNT_FOR_SIMULATE, //
      typeof token === "string"
        ? token === "native"
          ? new Asset("XLM").contractId(Networks.PUBLIC)
          : token
        : token.contractId(Networks.PUBLIC),
      "balance",
      Address.fromString(contract).toScVal()
    );

    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;
    if (result) return BigInt(parseAmount(this.i128ToInt(result.result?.retval.value() as xdr.Int128Parts), 7));
    return 0n;
  }

  i128ToInt(val: xdr.Int128Parts): string {
    // @ts-ignore
    return new BigNumber(val.hi()._value).plus(val.lo()._value).div(1e7).toString();
  }
}

export default StellarService;
