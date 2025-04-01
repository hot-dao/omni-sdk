import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Networks,
  rpc,
  scValToBigInt,
  StrKey,
  TimeoutInfinite,
  TransactionBuilder,
  xdr,
  XdrLargeInt,
} from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import { getBytes } from "ethers";

import { bigIntMax, getOmniAddressHex, parseAmount } from "../utils";
import { Chains, Network } from "../chains";
import { PendingDeposit } from "../types";
import OmniApi from "../api";
import OmniService from "../bridge";
import { ACCOUNT_FOR_SIMULATE } from "../signers/StellarSigner";

const CONTRACT = "CCLWL5NYSV2WJQ3VBU44AMDHEVKEPA45N2QP2LL62O3JVKPGWWAQUVAG";

class StellarService {
  constructor(readonly omni: OmniService) {}

  get stellar() {
    return this.omni.user.stellar!;
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee() {
    const needNative = 0n; // BigInt(parseAmount(0.15, 7));
    const realGas = 0n; // BigInt(parseAmount(0.1, 7));
    const balance = await this.getTokenLiquidity("native", this.stellar.address);

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

  async getDepositFee() {
    const { tx } = await this.buildDepositTx("native", 1n);
    const balance = await this.getTokenLiquidity("native", this.stellar.address);
    const fee = BigInt(tx.fee);

    return {
      maxFee: fee,
      need: bigIntMax(0n, fee - balance),
      isNotEnough: balance < fee,
      gasPrice: fee,
      gasLimit: 1n,
      chain: Network.Stellar,
    };
  }

  async getTokenLiquidity(token: string, address = CONTRACT) {
    const balance = await this.stellar.getTokenBalance(token, address);
    return BigInt(parseAmount(balance || "0", 7));
  }

  async isNonceUsed(nonce: string) {
    const tx = await this.stellar.buildSmartContactTx(
      ACCOUNT_FOR_SIMULATE,
      CONTRACT,
      "is_executed",
      new XdrLargeInt("u128", nonce).toU128()
    );

    const result = (await this.stellar.soroban.simulateTransaction(tx)) as rpc.Api.SimulateTransactionSuccessResponse;
    return result.result?.retval.value();
  }

  async buildDepositTx(address: string, amount: bigint, to?: string) {
    const receiver = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const ts = await OmniApi.shared.getTime();

    const contractId = address === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : address;
    const call = new Contract(CONTRACT).call(
      "deposit",
      Address.fromString(this.stellar.address).toScVal(),
      new XdrLargeInt("u128", amount.toString()).toU128(),
      xdr.ScVal.scvAddress(Address.contract(StrKey.decodeContract(contractId)).toScAddress()),
      xdr.ScVal.scvBytes(Buffer.from(getBytes(receiver))),
      new XdrLargeInt("u128", ts.toString()).toU128()
    );

    const account = await this.stellar.horizon.loadAccount(this.stellar.address);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    return { nonce: String(ts), tx: await this.stellar.soroban.prepareTransaction(tx.build()) };
  }

  async deposit(address: string, amount: bigint, to?: string) {
    const receiver = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const { tx, nonce } = await this.buildDepositTx(address, amount);

    await this.stellar.signTransaction(tx);
    const hash = await this.stellar.submitTransaction(tx);
    return this.omni.addPendingDeposit({
      receiver: baseEncode(getBytes(receiver)),
      timestamp: Date.now(),
      amount: String(amount),
      chain: Network.Stellar,
      token: address,
      tx: hash,
      nonce,
    });
  }

  async buildWithdrawTx() {}

  async withdraw(args: { amount: bigint; token: string; signature: string; nonce: string }) {
    const to = new Contract(CONTRACT);
    const sign = Buffer.from(baseDecode(args.signature));

    if (args.token !== "native") await this.stellar.activateToken(args.token);
    const contractId = args.token === "native" ? new Asset("XLM").contractId(Networks.PUBLIC) : args.token;

    const call = to.call(
      "withdraw",
      new XdrLargeInt("u128", args.amount.toString()).toU128(),
      new XdrLargeInt("u128", args.nonce).toU128(),
      Address.fromString(contractId).toScVal(),
      Address.fromString(this.stellar.address).toScVal(),
      xdr.ScVal.scvBytes(sign)
    );

    const account = await this.stellar.horizon.loadAccount(this.stellar.address);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.PUBLIC }) //
      .addOperation(call)
      .setTimeout(TimeoutInfinite);

    const preparedTx = await this.stellar.soroban.prepareTransaction(tx.build());
    await this.stellar.signTransaction(preparedTx);
    await this.stellar.submitTransaction(preparedTx);
  }

  async clearDepositNonceIfNeeded(_: PendingDeposit) {}

  async parseDeposit(deposit: PendingDeposit): Promise<PendingDeposit> {
    if (deposit.nonce) return deposit;
    const txResult = await this.stellar.soroban.getTransaction(deposit.tx);
    if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw "";
    const nonce = scValToBigInt(txResult.resultMetaXdr.v3().sorobanMeta()!.returnValue());
    return this.omni.addPendingDeposit({ ...deposit, nonce: nonce.toString() });
  }
}

export default StellarService;
