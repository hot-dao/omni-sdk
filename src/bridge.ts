import { baseDecode } from "@near-js/utils";
import { JsonRpcProvider } from "@near-js/providers";
import { Action } from "near-api-js/lib/transaction";
import { Connection } from "@solana/web3.js";
import { rpc } from "@stellar/stellar-sdk";
import { TonApiClient } from "@ton-api/client";
import * as ethers from "ethers";

import { Logger, TGAS, OMNI_HOT_V2, toOmniIntent, encodeReceiver, encodeTokenAddress, decodeTokenAddress, decodeReceiver, wait, toOmni, functionCall, isTon } from "./utils";
import { BuildedWithdraw, Network, PendingDepositWithIntent, PendingWithdraw } from "./types";
import OmniApi from "./api";

import SolanaOmniService from "./bridge-solana";
import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonLegacyOmniService from "./bridge-ton-v1";
import TonOmniService from "./bridge-ton";
import NearBridge from "./bridge-near";

export class GaslessNotAvailable extends Error {
  constructor(chain: number) {
    super(`Gasless withdraw not available for chain ${chain}`);
  }
}

export class GaslessWithdrawTxNotFound extends Error {
  constructor(readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw tx not found for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class GaslessWithdrawCanceled extends Error {
  constructor(readonly reason: string, readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw canceled for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

interface BridgeOptions {
  logger?: Logger;

  evmRpc?: Record<number, string[]> | ((chain: number) => ethers.AbstractProvider);
  solanaRpc?: Connection | string[];
  tonRpc?: TonApiClient | string;
  stellarRpc?: string | rpc.Server;
  nearRpc?: JsonRpcProvider | string[];

  enableApproveMax?: boolean;

  solverBusRpc?: string;
  mpcApi?: string[];
  api?: string;

  executeNearTransaction: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
}

class HotBridge {
  logger?: Logger;
  solverBusRpc: string;
  executeNearTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;

  stellar: StellarService;
  solana: SolanaOmniService;
  legacyTon: TonLegacyOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;
  api: OmniApi;

  constructor(options: BridgeOptions) {
    this.executeNearTransaction = options.executeNearTransaction;
    this.logger = options.logger;

    this.api = new OmniApi(options.api, options.mpcApi);
    this.evm = new EvmOmniService(this, options.evmRpc, { enableApproveMax: options.enableApproveMax });
    this.solverBusRpc = options.solverBusRpc ?? "https://api0.herewallet.app/api/v1/evm/intent-solver";
    this.solana = new SolanaOmniService(this, options.solanaRpc);
    this.stellar = new StellarService(this, options.stellarRpc);
    this.legacyTon = new TonLegacyOmniService(this, options.tonRpc);
    this.ton = new TonOmniService(this, options.tonRpc);
    this.near = new NearBridge(this, options.nearRpc);
  }

  async executeIntents(signedDatas: any[], quoteHashes: string[]) {
    const res = await fetch(this.solverBusRpc, {
      method: "POST",
      body: JSON.stringify({
        params: [{ signed_datas: signedDatas, quote_hashes: quoteHashes }],
        method: "publish_intents",
        id: "dontcare",
        jsonrpc: "2.0",
      }),
    });

    const { result } = await res.json();
    if (result.reason) throw result.reason;
    if (!result.intent_hashes?.length) throw "No intent hashes";

    const intentResult = result.intent_hashes[0];
    const getStatus = async () => {
      const statusRes = await fetch(this.solverBusRpc, {
        body: JSON.stringify({ id: "dontcare", jsonrpc: "2.0", method: "get_status", params: [{ intent_hash: intentResult }] }),
        method: "POST",
      });

      const { result } = await statusRes.json();
      return result;
    };

    const fetchResult = async () => {
      await wait(1000);
      const result = await getStatus().catch(() => null);
      if (result == null) return await fetchResult();
      if (result.status === "SETTLED") return result.data.hash;
      if (result.status === "FAILED") throw "Swap failed";
      return await fetchResult();
    };

    const hash = await fetchResult();
    return { sender: "intents.near", hash };
  }

  getContractReceiver(chain: number) {
    if (chain === Network.Tron) return "";
    if (chain === Network.Near) return OMNI_HOT_V2;
    if (chain === Network.Solana) return "5bG1Kru6ifRmkWMigYaGRKbBKp3WrgcmB6ARNKsV2y2v";
    if (chain === Network.Stellar) return "CDP4UWXJAGZRZNNDRTQRG23N56SM5BU6AFTKQLNAUUXSEHU5XYFYPP4I";
    if (chain === Network.LegacyTon) return this.legacyTon.getMetaWalletV1().metaWallet.address.toString({ bounceable: false });
    if (chain === Network.Ton) return this.ton.getMetaWallet().metaWallet.address.toString({ bounceable: false });
    return "0x42351e68420D16613BBE5A7d8cB337A9969980b4";
  }

  async getAllIntentBalances(intentAccount: string) {
    const accounts = new Set<string>();
    const limit = 250;
    let fromIndex = 0n;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await this.near.viewFunction({
        args: { account_id: intentAccount, from_index: fromIndex.toString(), limit },
        methodName: "mt_tokens_for_owner",
        contractId: "intents.near",
      });

      batch.forEach((account: any) => accounts.add(account.token_id));
      if (batch.length < limit) break;
      fromIndex += BigInt(limit);
    }

    return await this.getIntentBalances(Array.from(accounts), intentAccount);
  }

  async getIntentBalances(intents: string[], intentAccount: string) {
    const balances = await this.near.viewFunction({
      args: { token_ids: intents, account_id: intentAccount },
      methodName: "mt_batch_balance_of",
      contractId: "intents.near",
    });

    return intents.reduce((acc, id, index) => {
      acc[id] = BigInt(balances[index] || 0n);
      return acc;
    }, {} as Record<string, bigint>);
  }

  async getIntentBalance(intentId: string, intentAccount: string) {
    const balances = await this.getIntentBalances([intentId], intentAccount);
    return balances[intentId] || 0n;
  }

  async getTokenBalance(chain: Network, token: string, address: string) {
    if (chain === Network.Near) return await this.near.getTokenBalance(token, address);
    if (chain === Network.Solana) return await this.solana.getTokenBalance(token, address);
    if (chain === Network.Stellar) return await this.stellar.getTokenBalance(token, address);
    if (chain === Network.LegacyTon) return await this.legacyTon.getTokenBalance(token, address);
    if (chain === Network.Ton) return await this.ton.getTokenBalance(token, address);
    return await this.evm.getTokenBalance(token, chain, address);
  }

  async getPendingWithdrawals(chain: number, receiver: string): Promise<PendingWithdraw[]> {
    const withdrawals = await this.near.viewFunction({
      args: { receiver_id: encodeReceiver(chain, receiver), chain_id: chain },
      methodName: "get_withdrawals_by_receiver",
      contractId: OMNI_HOT_V2,
    });

    if (!withdrawals) return [];
    return withdrawals.map((withdraw: any) => {
      return {
        nonce: withdraw.nonce,
        chain: withdraw.chain_id,
        amount: withdraw.amount,
        timestamp: withdraw.created_ts * 1000,
        token: decodeTokenAddress(withdraw.chain_id, withdraw.contract_id),
        receiver: decodeReceiver(withdraw.chain_id, withdraw.receiver_id),
      };
    });
  }

  async getPendingWithdrawalsWithStatus(chain: number, receiver: string): Promise<(PendingWithdraw & { completed: boolean })[]> {
    const pendings = await this.getPendingWithdrawals(chain, receiver);
    const tasks = pendings.map<Promise<PendingWithdraw & { completed: boolean }>>(async (pending) => {
      const completed = await this.isWithdrawUsed(chain, pending.nonce, receiver).catch(() => false);
      return { ...pending, completed };
    });

    return await Promise.all(tasks);
  }

  async clearPendingWithdrawals(withdrawals: PendingWithdraw[]) {
    const tasks = withdrawals.map(async (withdraw) => {
      const receiver = encodeReceiver(withdraw.chain, withdraw.receiver);
      const signature = await this.api.clearWithdrawSign(withdraw.nonce, Buffer.from(baseDecode(receiver)));
      return functionCall({
        methodName: "clear_completed_withdrawal",
        args: { nonce: withdraw.nonce, signature },
        gas: String(80n * TGAS),
        deposit: "0",
      });
    });

    const actions = await Promise.all(tasks);
    return await this.executeNearTransaction({ receiverId: OMNI_HOT_V2, actions });
  }

  async isDepositUsed(chain: number, nonce: string) {
    return await this.near.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT_V2,
    });
  }

  async isWithdrawUsed(chain: number, nonce: string, receiver: string) {
    if (chain === Network.LegacyTon) return await this.legacyTon.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Ton) return await this.ton.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Solana) return await this.solana.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Stellar) return await this.stellar.isWithdrawUsed(nonce);
    return await this.evm.isWithdrawUsed(chain, nonce);
  }

  async buildWithdraw(nonce: string): Promise<BuildedWithdraw> {
    this.logger?.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer = await this.near.viewFunction({
      contractId: OMNI_HOT_V2,
      methodName: "get_transfer",
      args: { nonce },
    });

    if (!transfer) throw "Withdrawal not found";
    this.logger?.log(`Transfer: ${JSON.stringify(transfer, null, 2)}`);

    this.logger?.log(`Checking if nonce is used`);
    const receiver = decodeReceiver(transfer.chain_id, transfer.receiver_id);

    const isUsed = await this.isWithdrawUsed(transfer.chain_id, nonce, receiver).catch(() => false);
    if (isUsed) throw "Already claimed";

    this.logger?.log(`Depositing on ${transfer.chain_id}`);
    const token = decodeTokenAddress(transfer.chain_id, transfer.contract_id);

    this.logger?.log("Signing withdraw");
    const signature = await this.api.withdrawSign(nonce);

    return {
      chain: +transfer.chain_id,
      amount: BigInt(transfer.amount),
      receiver,
      signature,
      token,
      nonce,
    };
  }

  /** Returns { hash } or null if deposit already finished */
  async finishDeposit(deposit: PendingDepositWithIntent) {
    this.logger?.log(`Checking if depos it is executed`);
    const isExecuted = await this.near.viewFunction({
      args: { nonce: deposit.nonce, chain_id: deposit.chain },
      contractId: OMNI_HOT_V2,
      methodName: "is_executed",
    });

    if (isExecuted) return null;
    this.logger?.log(`Signing deposit`);
    const signature = await this.api.depositSign(deposit.chain, deposit.nonce, deposit.sender, deposit.receiver, encodeTokenAddress(deposit.chain, deposit.token), deposit.amount);

    const depositAction = functionCall({
      methodName: "mt_deposit_call",
      gas: String(80n * TGAS),
      deposit: "1",
      args: {
        signature,
        nonce: deposit.nonce,
        chain_id: deposit.chain,
        amount: deposit.amount,
        contract_id: encodeTokenAddress(deposit.chain, deposit.token),
        deposit_call_args: {
          account_id: "intents.near",
          msg: JSON.stringify({ receiver_id: deposit.intentAccount }),
        },
      },
    });

    try {
      this.logger?.log(`Calling deposit to omni and deposit to intents`);
      return await this.executeNearTransaction({ actions: [depositAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      if (!e?.toString?.().includes("Nonce already used")) throw e;
      return null;
    }
  }

  async getGaslessWithdrawFee(chain: Network, token: string): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    return await this.api.getWithdrawFee(chain, token);
  }

  async buildWithdrawIntent(args: { chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string }) {
    const token = toOmniIntent(args.chain, args.token);
    const [format, address] = token.split(/:(.*)/s);

    if (format === "nep245") {
      const [mt_contract, token_id] = address.split(":");
      const receiver = encodeReceiver(args.chain, args.receiver);

      return {
        intent: "mt_withdraw",
        amounts: [args.amount.toString()],
        receiver_id: OMNI_HOT_V2,
        token_ids: [token_id],
        token: mt_contract,
        memo: receiver,
      };
    }

    if (format === "nep141") {
      return {
        intent: address === "wrap.near" ? "native_withdraw" : "ft_withdraw",
        memo: args.chain !== Network.Near ? `WITHDRAW_TO:${args.receiver}` : undefined,
        receiver_id: args.chain !== Network.Near ? token : args.intentAccount,
        token: address === "wrap.near" ? undefined : address,
        amount: args.amount.toString(),
      };
    }

    throw `Unsupported token format ${format}`;
  }

  async buildSwapExectInIntent(intentAccount: string, tokensFrom: Record<string, string>, tokenTo: string, amount: number) {
    const quote = await this.api.estimateSwap(intentAccount, tokensFrom, tokenTo, amount);
    // TODO: Add intents validations

    return {
      quote_hashes: quote.quote_hashes,
      signed_fee_quote: quote.signed_fee_quote,
      intents: quote.quote.intents,
      amountOut: quote.amountOut,
      fees: quote.fees,
    };
  }

  async buildSwapExectOutIntent(args: { chainFrom: Network; tokenFrom: string; chainTo: Network; tokenTo: string; amount: bigint }) {
    const from = toOmniIntent(args.chainFrom, args.tokenFrom);
    const to = toOmniIntent(args.chainTo, args.tokenTo);
    const quote = await this.api.getSwapQuoteExectOut(from, to, args.amount);

    return {
      quote_hashes: quote.quote_hashes,
      amount_in: quote.amount_in,
      intent: {
        diff: { [from]: `-${quote.amount_in}`, [to]: String(args.amount) },
        referral: "intents.tg",
        intent: "token_diff",
      },
    };
  }

  async buildGaslessWithdrawIntent(args: { feeToken: string; feeAmount: bigint; chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string }) {
    const blockNumber = args.chain !== Network.Ton ? await this.evm.getProvider(args.chain).getBlockNumber() : 0;
    const tokenAddress = toOmni(args.chain, args.token);
    const feeTokenAddress = toOmni(args.chain, args.feeToken);
    const receiver = encodeReceiver(args.chain, args.receiver);
    const withFee = tokenAddress !== feeTokenAddress && args.feeAmount > 0n;

    return {
      intent: "mt_withdraw",
      receiver_id: "bridge-refuel.hot.tg",
      amounts: withFee ? [args.amount.toString(), args.feeAmount.toString()] : [args.amount.toString()],
      token_ids: withFee ? [tokenAddress, feeTokenAddress] : [tokenAddress],
      token: "v2_1.omni.hot.tg",
      msg: JSON.stringify({
        receiver_id: receiver,
        amount_native: args.feeAmount.toString(),
        block_number: blockNumber,
      }),
    };
  }

  async getGaslessWithdrawStatus(nonce: string) {
    return await this.near.viewFunction({
      contractId: "bridge-refuel.hot.tg",
      methodName: "get_withdrawal_hash",
      args: { nonce },
    });
  }

  async checkLocker(chain: number, receiver: string) {
    if (chain === Network.Near) return;
    const pendings = await this.getPendingWithdrawalsWithStatus(chain, receiver);
    const completed = pendings.filter((t) => t.completed);
    if (completed.length) await this.clearPendingWithdrawals(completed);
    if (pendings.some((t) => !t.completed)) throw "Complete previous withdrawals before make new";
  }

  async buildGaslessWithdrawToken(args: {
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
  }): Promise<{ gasless: boolean; intents: any[]; quoteHashes: string[] }> {
    if (args.chain === Network.Near) throw new GaslessNotAvailable(args.chain);
    if (args.chain === Network.Tron) throw new GaslessNotAvailable(args.chain);
    if (args.chain === Network.Btc) throw new GaslessNotAvailable(args.chain);
    if (args.chain === Network.Zcash) throw new GaslessNotAvailable(args.chain);

    // Get gas price
    const { gasPrice } = await this.getGaslessWithdrawFee(args.chain, args.token).catch(() => ({ gasPrice: null }));
    if (gasPrice == null) throw new GaslessNotAvailable(args.chain);
    this.logger?.log(`Gasless withdraw gas price: ${gasPrice}`);

    // Swap part of input token to gas token
    let qoute;
    if (gasPrice > 0n && args.token !== "native") {
      qoute = await this.buildSwapExectOutIntent({
        chainFrom: args.chain,
        tokenFrom: args.token,
        chainTo: args.chain,
        tokenTo: "native",
        amount: gasPrice,
      }).catch(() => null);

      // Not enough input amount for gas covering
      if (qoute == null || BigInt(qoute.amount_in) >= args.amount) {
        throw new GaslessNotAvailable(args.chain);
      }
    }

    // Not enough input amount for gas covering
    if (args.token === "native" && args.amount <= gasPrice) {
      throw new GaslessNotAvailable(args.chain);
    }

    const withdrawIntent = await this.buildGaslessWithdrawIntent({
      amount: args.amount - BigInt(qoute?.amount_in || 0n),
      intentAccount: args.intentAccount,
      receiver: args.receiver,
      chain: args.chain,
      token: args.token,
      feeToken: "native",
      feeAmount: gasPrice,
    });

    return {
      intents: qoute ? [qoute.intent, withdrawIntent] : [withdrawIntent],
      quoteHashes: qoute?.quote_hashes || [],
      gasless: true,
    };
  }

  async buildWithdrawToken(args: {
    chain: number;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
    gasless?: boolean;
  }): Promise<{ intents: any[]; quoteHashes: string[]; gasless: boolean }> {
    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);

    if (args.chain === Network.LegacyTon) {
      const receiver = decodeReceiver(Network.LegacyTon, encodeReceiver(Network.LegacyTon, args.receiver));
      const isUserExists = await this.legacyTon.isUserExists(receiver);
      if (!isUserExists) throw "User jetton not created, call bridge.createUserIfNeeded({ address, sendTransaction }) before withdraw";
    }

    if (args.gasless !== false) {
      try {
        return await this.buildGaslessWithdrawToken(args);
      } catch (e) {
        if (!(e instanceof GaslessNotAvailable)) throw e;
        this.logger?.log(`Gasless withdraw not available for chain ${args.chain}, using regular withdraw`);
      }
    }

    await this.checkLocker(args.chain, args.receiver);
    const intent = await this.buildWithdrawIntent(args);
    return { intents: [intent], quoteHashes: [], gasless: false };
  }

  async waitGaslessWithdraw(nonce: string, chain: number, receiver: string) {
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (attempts > 30) throw new GaslessWithdrawTxNotFound(nonce, chain, receiver);
      await wait(2000);

      const status = await this.getGaslessWithdrawStatus(nonce);
      if (status?.startsWith("CANCELED")) throw new GaslessWithdrawCanceled(status, nonce, chain, receiver);
      if (status === "COMPLETED") return "0x0";
      if (status) return `0x${status}`;
      attempts += 1;
    }
  }

  async waitPoaWithdraw(hash: string) {
    const getLastWithdraw = async (hash: string) => {
      const response = await this.api.request("/rpc", {
        method: "POST",
        endpoint: "https://bridge.chaindefuser.com",
        body: JSON.stringify({
          method: "withdrawal_status",
          params: [{ withdrawal_hash: hash }],
          jsonrpc: "2.0",
          id: "dontcare",
        }),
      });

      const { result } = await response.json();
      return result.status;
    };

    const status = await getLastWithdraw(hash).catch(() => null);
    if (status === "FAILED") throw "Withdraw failed";
    if (status === "COMPLETED") return;

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.waitPoaWithdraw(hash);
  }

  async gaslessWithdrawToken(args: { chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string; signIntents: (intents: any[]) => Promise<any> }) {
    const { intents, quoteHashes } = await this.buildGaslessWithdrawToken(args);
    const signedIntents = await args.signIntents(intents);
    const tx = await this.executeIntents([signedIntents], quoteHashes);

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    this.logger?.log(`Gasless withdraw tx: ${tx.hash}, nonce: ${nonce}`);
    await this.waitGaslessWithdraw(nonce, args.chain, args.receiver);
  }

  async withdrawToken(args: {
    chain: number;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
    signIntents: (intents: Record<string, any>[]) => Promise<any>;
    gasless?: boolean;
  }) {
    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);
    const result = await this.buildWithdrawToken(args);

    this.logger?.log(`Sign withdraw intent`);
    const signedIntents = await args.signIntents(result.intents);

    this.logger?.log(`Push withdraw intent`);
    const tx = await this.executeIntents([signedIntents], result.quoteHashes);

    if (args.chain === Network.Near) return;
    if (args.chain === Network.Btc || args.chain === Network.Zcash) return;
    if (args.chain === Network.Tron) return await this.waitPoaWithdraw(tx.hash);

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);
    console.log({ nonce, ...tx });

    this.logger?.log(`Wait gasless withdraw`);
    if (result.gasless) {
      await this.waitGaslessWithdraw(nonce, args.chain, args.receiver);
      return;
    }

    this.logger?.log(`Depositing to ${args.chain}`);
    return await this.buildWithdraw(nonce); // TODO: return tx hash
  }

  async swapTokens(args: { chainFrom: Network; chainTo: Network; tokenFrom: string; tokenTo: string; amount: number; intentAccount: string; signIntents: (intents: any[]) => Promise<any> }) {
    const tokenFrom = toOmniIntent(args.chainFrom, args.tokenFrom);
    const tokenTo = toOmniIntent(args.chainTo, args.tokenTo);

    const balance = await this.getIntentBalance(tokenFrom, args.intentAccount);
    const quote = await this.buildSwapExectInIntent(args.intentAccount, { [tokenFrom]: String(balance) }, tokenTo, args.amount);

    const signedIntents = await args.signIntents(quote.intents);
    return await this.executeIntents([quote.signed_fee_quote, signedIntents], quote.quote_hashes);
  }
}

export default HotBridge;
