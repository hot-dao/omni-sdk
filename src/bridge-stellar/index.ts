import { Address, Asset, Contract, Horizon, Networks, rpc, scValToBigInt, StrKey, TimeoutInfinite, TransactionBuilder, xdr, XdrLargeInt } from "@stellar/stellar-sdk";
import { Operation, Transaction } from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import BigNumber from "bignumber.js";

import { omniEphemeralReceiver, parseAmount } from "../utils";
import { Network, PendingDeposit } from "../types";
import { DepositNotFound } from "../errors";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";

export const ACCOUNT_FOR_SIMULATE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

class StellarService {
  readonly soroban: rpc.Server[];
  readonly horizon: Horizon.Server[];
  readonly contract: string;
  readonly baseFee: string;

  constructor(readonly omni: OmniService, readonly options: { contract?: string; sorobanRpc?: string[]; horizonRpc?: string[]; baseFee?: string }) {
    this.soroban = options.sorobanRpc ? options.sorobanRpc.map((r) => new rpc.Server(r)) : [new rpc.Server("https://mainnet.sorobanrpc.com")];
    this.horizon = options.horizonRpc ? options.horizonRpc.map((r) => new Horizon.Server(r)) : [new Horizon.Server("https://horizon.stellar.org")];
    this.contract = options.contract || "CCLWL5NYSV2WJQ3VBU44AMDHEVKEPA45N2QP2LL62O3JVKPGWWAQUVAG";
    this.baseFee = options.baseFee || "500000";
  }

  async callHorizon<T>(fn: (rpc: Horizon.Server) => Promise<T>) {
    let error: any;
    for (const rpc of this.horizon) {
      try {
        return await fn(rpc);
      } catch (e) {
        error = e;
        continue;
      }
    }

    throw error;
  }

  async callSoroban<T>(fn: (rpc: rpc.Server) => Promise<T>) {
    let error: any;
    for (const rpc of this.soroban) {
      try {
        return await fn(rpc);
      } catch (e) {
        error = e;
        continue;
      }
    }

    throw error;
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee(): Promise<ReviewFee> {
    const needNative = BigInt(parseAmount(0.15, 7));
    const realGas = BigInt(parseAmount(0.1, 7));
    return new ReviewFee({ reserve: needNative, baseFee: realGas, chain: Network.Stellar });
  }

  async getDepositFee(sender: string, token: string, amount: bigint, intentAccount: string): Promise<ReviewFee> {
    const receiver = omniEphemeralReceiver(intentAccount);
    const tx = await this.buildDepositTx(sender, token, 1n, receiver);
    const fee = BigInt(tx.fee);
    return new ReviewFee({ reserve: fee, baseFee: fee, chain: Network.Stellar });
  }

  async isWithdrawUsed(nonce: string) {
    const tx = await this.buildSmartContactTx(ACCOUNT_FOR_SIMULATE, this.contract, "is_executed", new XdrLargeInt("u128", nonce).toU128());
    const result = (await this.callSoroban((rpc) => rpc.simulateTransaction(tx))) as rpc.Api.SimulateTransactionSuccessResponse;
    return !!result.result?.retval.value();
  }

  async isTrustlineExists(sender: string, token: string) {
    if (token === "native") return true;
    const asset = await this.getAssetFromContractId(token);
    const account = await this.callHorizon((rpc) => rpc.accounts().accountId(sender).call());
    return account.balances.some((b) => "asset_issuer" in b && b.asset_issuer === asset.issuer);
  }

  async buildDepositTx(sender: string, token: string, amount: bigint, receiver: Buffer) {
    let ts = await this.omni.api.getTime();
    ts = String(BigInt(ts) - 20n * 10n ** 12n); // minus 20 second

    const contractId = token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : token;
    const call = new Contract(this.contract).call(
      "deposit",
      Address.fromString(sender).toScVal(),
      new XdrLargeInt("u128", amount.toString()).toU128(),
      xdr.ScVal.scvAddress(Address.contract(StrKey.decodeContract(contractId)).toScAddress()),
      xdr.ScVal.scvBytes(receiver),
      new XdrLargeInt("u128", ts.toString()).toU128()
    );

    const account = await this.callSoroban((rpc) => rpc.getAccount(sender));
    const tx = new TransactionBuilder(account, { fee: this.baseFee, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    return await this.callSoroban((rpc) => rpc.prepareTransaction(tx.build()));
  }

  async deposit(args: { token: string; amount: bigint; intentAccount: string; sender: string; sendTransaction: (tx: Transaction) => Promise<string> }): Promise<string> {
    this.omni.api.registerDeposit(args.intentAccount);
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const tx = await this.buildDepositTx(args.sender, args.token, args.amount, receiver);
    return await args.sendTransaction(tx);
  }

  async withdraw(args: { amount: bigint; token: string; nonce: string; receiver: string; sender: string; sendTransaction: (tx: Transaction) => Promise<string> }) {
    const to = new Contract(this.contract);
    const signature = await this.omni.api.withdrawSign(args.nonce);
    const sign = Buffer.from(baseDecode(signature));
    const contractId = args.token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : args.token;

    const call = to.call(
      "withdraw",
      new XdrLargeInt("u128", args.amount.toString()).toU128(),
      new XdrLargeInt("u128", args.nonce).toU128(),
      Address.fromString(contractId).toScVal(),
      Address.fromString(args.receiver).toScVal(),
      xdr.ScVal.scvBytes(sign)
    );

    const account = await this.callSoroban((rpc) => rpc.getAccount(args.sender));
    const tx = new TransactionBuilder(account, { fee: this.baseFee, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    const preparedTx = await this.callSoroban((rpc) => rpc.prepareTransaction(tx.build()));
    return await args.sendTransaction(preparedTx);
  }

  async clearDepositNonceIfNeeded(_: PendingDeposit) {}

  async parseDeposit(hash: string): Promise<PendingDeposit> {
    const txResult = await this.callSoroban((rpc) => rpc.getTransaction(hash));

    if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new DepositNotFound(Network.Stellar, hash, "tx not found");
    }

    // If not a fee bump tx, parse as regular transaction
    const tx = TransactionBuilder.fromXDR(txResult.envelopeXdr, Networks.PUBLIC);
    if (!tx.operations.length || tx.operations[0].type !== "invokeHostFunction") {
      throw new DepositNotFound(Network.Stellar, hash, "Deposit tx not found");
    }

    const args = tx.operations[0].func.invokeContract().args();
    const nativeToken = new Asset("XLM").contractId(Networks.PUBLIC);
    const sender = Address.fromScAddress(args[0].address());
    const amount = scValToBigInt(args[1]);
    const token = Address.fromScAddress(args[2].address()).toString();
    const receiver = baseEncode(args[3].bytes());

    let nonce;
    try {
      nonce = scValToBigInt(txResult.resultMetaXdr.v4().sorobanMeta()!.returnValue()!);
    } catch (e) {
      nonce = scValToBigInt(txResult.resultMetaXdr.v3().sorobanMeta()!.returnValue()!);
    }

    return {
      tx: hash,
      receiver,
      nonce: nonce.toString(),
      amount: amount.toString(),
      sender: sender.toString(),
      token: token === nativeToken ? "native" : token,
      chain: Network.Stellar,
      timestamp: Date.now(),
    };
  }

  async activateToken(args: { token: string | Asset; sender: string; sendTransaction: (tx: Transaction) => Promise<string> }) {
    const asset = args.token instanceof Asset ? args.token : await this.getAssetFromContractId(args.token);
    const account = await this.callSoroban((rpc) => rpc.getAccount(args.sender));

    const trustlineOp = Operation.changeTrust({ asset: asset, source: args.sender });
    const trustlineTx = new TransactionBuilder(account, { fee: this.baseFee, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(trustlineOp)
      .setTimeout(TimeoutInfinite)
      .build();

    return await args.sendTransaction(trustlineTx);
  }

  async buildSmartContactTx(publicKey: string, contactId: string, method: string, ...args: any[]) {
    const account = await this.callSoroban((rpc) => rpc.getAccount(publicKey));
    const contract = new Contract(contactId);
    const builtTx = new TransactionBuilder(account, { fee: this.baseFee, networkPassphrase: Networks.PUBLIC });

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
    const result = (await this.callSoroban((rpc) => rpc.simulateTransaction(tx))) as rpc.Api.SimulateTransactionSuccessResponse;

    const value = result?.result?.retval?.value();
    if (!value) throw "Asset not found";

    const [code, issuer] = value.toString().split(":");
    const asset = issuer ? new Asset(code, issuer) : Asset.native();
    this.assetsCache.set(id, asset);
    return asset;
  }

  async getTokenBalance(token: Asset | string, contract = this.contract) {
    const tx = await this.buildSmartContactTx(
      ACCOUNT_FOR_SIMULATE, //
      typeof token === "string" ? (token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : token) : token.contractId(Networks.PUBLIC),
      "balance",
      Address.fromString(contract).toScVal()
    );

    const result = (await this.callSoroban((rpc) => rpc.simulateTransaction(tx))) as rpc.Api.SimulateTransactionSuccessResponse;
    if (result) return BigInt(parseAmount(this.i128ToInt(result.result?.retval.value() as xdr.Int128Parts), 7));
    return 0n;
  }

  i128ToInt(val: xdr.Int128Parts): string {
    // @ts-expect-error: --
    return new BigNumber(val.hi()._value).plus(val.lo()._value).div(1e7).toString();
  }
}

export default StellarService;
