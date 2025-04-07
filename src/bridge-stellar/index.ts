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
import { Operation, FeeBumpTransaction } from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import BigNumber from "bignumber.js"; // @ts-ignore
import { getBytes } from "ethers";

import { bigIntMax, getOmniAddressHex, parseAmount } from "../utils";
import { Chains, Network } from "../chains";
import { PendingDeposit } from "../types";
import OmniService from "../bridge";
import OmniApi from "../api";

export const ACCOUNT_FOR_SIMULATE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
export const CONTRACT = "CCLWL5NYSV2WJQ3VBU44AMDHEVKEPA45N2QP2LL62O3JVKPGWWAQUVAG";

class StellarService {
  readonly soroban: rpc.Server;
  readonly horizon: Horizon.Server;

  constructor(readonly omni: OmniService) {
    this.soroban = new rpc.Server(this.stellar.rpcs[0]);
    this.horizon = new Horizon.Server(this.stellar.horizonApi[0]);
  }

  get stellar() {
    return this.omni.signers.stellar!;
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee() {
    const needNative = 0n; // BigInt(parseAmount(0.15, 7));
    const realGas = 0n; // BigInt(parseAmount(0.1, 7));

    const sender = await this.stellar.getAddress();
    const balance = await this.getTokenBalance("native", sender);

    if (balance >= needNative)
      return { need: 0n, canPerform: true, amount: realGas, decimal: Chains.get(Network.Stellar).decimal, additional: 0n };

    return {
      need: bigIntMax(0n, needNative - balance),
      canPerform: false,
      decimal: Chains.get(Network.Stellar).decimal,
      amount: realGas,
      additional: 0n,
    };
  }

  async getDepositFee(receiver: string) {
    const { tx } = await this.buildDepositTx("native", 1n, receiver);
    const balance = await this.getTokenBalance("native", await this.stellar.getAddress());
    const fee = BigInt(tx.fee);
    return {
      maxFee: fee,
      chain: Network.Stellar,
      need: bigIntMax(0n, fee - balance),
      isNotEnough: balance < fee,
      gasPrice: fee,
      gasLimit: 1n,
    };
  }

  async isNonceUsed(nonce: string) {
    const tx = await this.buildSmartContactTx(ACCOUNT_FOR_SIMULATE, CONTRACT, "is_executed", new XdrLargeInt("u128", nonce).toU128());
    const result = (await this.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;
    return result.result?.retval.value();
  }

  async buildDepositTx(address: string, amount: bigint, to: string) {
    const receiver = getOmniAddressHex(to);
    const ts = await OmniApi.shared.getTime();
    const sender = await this.stellar.getAddress();

    const contractId = address === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : address;
    const call = new Contract(CONTRACT).call(
      "deposit",
      Address.fromString(sender).toScVal(),
      new XdrLargeInt("u128", amount.toString()).toU128(),
      xdr.ScVal.scvAddress(Address.contract(StrKey.decodeContract(contractId)).toScAddress()),
      xdr.ScVal.scvBytes(Buffer.from(getBytes(receiver))),
      new XdrLargeInt("u128", ts.toString()).toU128()
    );

    const account = await this.horizon.loadAccount(sender);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    return { nonce: String(ts), tx: await this.soroban.prepareTransaction(tx.build()) };
  }

  async deposit(address: string, amount: bigint, to: string) {
    const receiver = getOmniAddressHex(to);
    const { tx, nonce } = await this.buildDepositTx(address, amount, to);

    const hash = await this.stellar.sendTransaction(tx);
    return this.omni.addPendingDeposit({
      sender: address,
      receiver: baseEncode(getBytes(receiver)),
      timestamp: Date.now(),
      amount: String(amount),
      chain: Network.Stellar,
      token: address,
      tx: hash,
      nonce,
    });
  }

  async withdraw(args: { amount: bigint; token: string; signature: string; nonce: string; receiver: string }) {
    const to = new Contract(CONTRACT);
    const sign = Buffer.from(baseDecode(args.signature));

    if (args.token !== "native") await this.activateToken(args.token);
    const contractId = args.token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : args.token;

    const call = to.call(
      "withdraw",
      new XdrLargeInt("u128", args.amount.toString()).toU128(),
      new XdrLargeInt("u128", args.nonce).toU128(),
      Address.fromString(contractId).toScVal(),
      Address.fromString(args.receiver).toScVal(),
      xdr.ScVal.scvBytes(sign)
    );

    const address = await this.stellar.getAddress();
    const account = await this.horizon.loadAccount(address);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    const preparedTx = await this.soroban.prepareTransaction(tx.build());
    return await this.stellar.sendTransaction(preparedTx);
  }

  async clearDepositNonceIfNeeded(_: PendingDeposit) {}

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;
    const txResult = await this.soroban.getTransaction(deposit.tx);
    if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw "";
    const nonce = scValToBigInt(txResult.resultMetaXdr.v3().sorobanMeta()!.returnValue());
    return this.omni.addPendingDeposit({ ...deposit, nonce: nonce.toString() });
  }

  async activateToken(assetAddress: string | Asset) {
    const address = await this.stellar.getAddress();
    const asset = assetAddress instanceof Asset ? assetAddress : await this.getAssetFromContractId(assetAddress);
    const account = await this.horizon.loadAccount(address);

    const trustlineOp = Operation.changeTrust({ asset: asset, source: address });
    const trustlineTx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(trustlineOp)
      .setTimeout(TimeoutInfinite)
      .build();

    return await this.stellar.sendTransaction(trustlineTx);
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
