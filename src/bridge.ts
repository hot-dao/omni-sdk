import type { Action } from "@near-js/transactions";
import { baseDecode, baseEncode } from "@near-js/utils";

import {
  Logger,
  TGAS,
  OMNI_HOT_V2,
  toOmniIntent,
  encodeReceiver,
  encodeTokenAddress,
  decodeTokenAddress,
  decodeReceiver,
  wait,
  toOmni,
  functionCall,
  omniEphemeralReceiver,
  isTon,
  PoA_BRIDGE_TOKENS_INVERTED,
} from "./utils";
import {
  GaslessNotAvailable,
  GaslessWithdrawCanceled,
  GaslessWithdrawTxNotFound,
  IntentBalanceIsLessThanAmount,
  MismatchReceiverAndIntentAccount,
  NearTokenNotRegistered,
  ProcessAborted,
  SlippageError,
} from "./errors";
import { BridgeOptions, Network, PendingDepositWithIntent, PendingWithdraw } from "./types";
import OmniApi from "./api";

import SolanaOmniService from "./bridge-solana";
import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonOmniService from "./bridge-ton";
import NearBridge from "./bridge-near";

class HotBridge {
  logger?: Logger;
  executeNearTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;

  stellar: StellarService;
  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;
  api: OmniApi;

  constructor(options: BridgeOptions) {
    this.executeNearTransaction = options.executeNearTransaction;
    this.logger = options.logger;

    this.api = new OmniApi(options.api, options.mpcApi);
    this.evm = new EvmOmniService(this, options.evmRpc, { enableApproveMax: options.enableApproveMax });
    this.stellar = new StellarService(this, options.stellarRpc, options.stellarHorizonRpc, options.stellarBaseFee);
    this.solana = new SolanaOmniService(this, options.solanaRpc);
    this.ton = new TonOmniService(this, options.tonRpc);
    this.near = new NearBridge(this, options.nearRpc);
  }

  async executeIntents(signedDatas: any[], quoteHashes: string[]) {
    const res = await this.api.requestApi("/api/v1/evm/intent-solver", {
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
      const statusRes = await this.api.requestApi("/api/v1/evm/intent-solver", {
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
    if (isTon(chain)) return this.ton.getMetaWallet().metaWallet.address.toString({ bounceable: false });
    return "0x42351e68420D16613BBE5A7d8cB337A9969980b4";
  }

  async getAllIntentBalances(intentAccount: string) {
    const accounts = new Set<string>();
    const limit = 250;
    let fromIndex = 0n;

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
    if (isTon(chain)) return await this.ton.getTokenBalance(token, address);
    return await this.evm.getTokenBalance(token, chain, address);
  }

  async getPendingWithdrawals(chain: number, receiver: string): Promise<PendingWithdraw[]> {
    if (chain === 1111) chain = 1117; // TON_ID to OMNI_TON
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
        receiver: decodeReceiver(withdraw.chain_id, withdraw.receiver_id),
        token: decodeTokenAddress(withdraw.chain_id, withdraw.contract_id),
      };
    });
  }

  async getPendingWithdrawalsWithStatus(chain: number, receiver: string): Promise<(PendingWithdraw & { completed: boolean })[]> {
    if (chain === 1111) chain = 1117;
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

  async isDepositUsed(chain: number, nonce: string): Promise<boolean> {
    return await this.near.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT_V2,
    });
  }

  async isWithdrawUsed(chain: number, nonce: string, receiver: string) {
    if (isTon(chain)) return await this.ton.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Solana) return await this.solana.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Stellar) return await this.stellar.isWithdrawUsed(nonce);
    return await this.evm.isWithdrawUsed(chain, nonce);
  }

  async getPendingWithdrawal(nonce: string): Promise<PendingWithdraw> {
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

    return {
      chain: +transfer.chain_id,
      timestamp: transfer.timestamp,
      amount: BigInt(transfer.amount),
      receiver,
      token,
      nonce,
    };
  }

  async waitPendingDeposit(chain: number, hash: string, intentAccount: string, abort?: AbortSignal): Promise<PendingDepositWithIntent> {
    const waitPending = async () => {
      if (isTon(chain)) return await this.ton.parseDeposit(hash);
      if (chain === Network.Solana) return await this.solana.parseDeposit(hash);
      if (chain === Network.Stellar) return await this.stellar.parseDeposit(hash);
      return await this.evm.parseDeposit(chain, hash);
    };

    while (true) {
      if (abort?.aborted) throw new ProcessAborted("waitPendingDeposit");
      const deposit = await waitPending().catch(() => null);

      if (deposit) {
        const receiver = baseEncode(omniEphemeralReceiver(intentAccount));
        if (deposit.receiver !== receiver) throw new MismatchReceiverAndIntentAccount(deposit.receiver, intentAccount);
        return { ...deposit, intentAccount };
      }

      await wait(2000);
    }
  }

  /** Returns { hash } or null if deposit already finished */
  async finishDeposit(deposit: PendingDepositWithIntent) {
    this.logger?.log(`Checking if deposit is executed`);

    const chain = deposit.chain === 1111 ? 1117 : deposit.chain;
    if (await this.isDepositUsed(chain, deposit.nonce)) return null;

    this.logger?.log(`Signing deposit`);
    const token = encodeTokenAddress(chain, deposit.token);
    const signature = await this.api.depositSign(chain, deposit.nonce, deposit.sender, deposit.receiver, token, deposit.amount);

    const depositAction = functionCall({
      methodName: "mt_deposit_call",
      gas: String(80n * TGAS),
      deposit: "1",
      args: {
        signature,
        chain_id: chain,
        contract_id: token,
        nonce: deposit.nonce,
        amount: deposit.amount,
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

  async getGaslessWithdrawFee(chain: Network, receiver: string): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    if (chain === 1111) chain = 1117; // TON_ID to OMNI_TON
    return await this.api.getWithdrawFee(chain, receiver);
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
        receiver_id: args.chain !== Network.Near ? address : args.intentAccount,
        token: address === "wrap.near" ? undefined : address,
        amount: args.amount.toString(),
      };
    }

    throw `Unsupported token format ${format}`;
  }

  async buildSwapExectInIntent(args: { intentAccount: string; intentFrom: string; intentTo: string; amountIn: bigint }) {
    const quote = await this.api.getSwapQuoteExectIn(args.intentAccount, args.intentFrom, args.intentTo, args.amountIn);
    const amountOut = BigInt(quote.quote.intents[0].diff[args.intentTo] || 0);

    return {
      amountOut: amountOut,
      signed_fee_quote: quote.signed_fee_quote,
      quote_hashes: quote.quote_hashes,
      intent: {
        diff: { [args.intentFrom]: `-${args.amountIn}`, [args.intentTo]: String(amountOut) },
        referral: "intents.tg",
        intent: "token_diff",
      },
    };
  }

  async buildSwapExectOutIntent(args: { intentAccount: string; intentFrom: string; intentTo: string; amountOut: bigint }) {
    const quote = await this.api.getSwapQuoteExectOut(args.intentFrom, args.intentTo, args.amountOut);
    const amountIn = BigInt(quote.amount_in);

    return {
      signed_fee_quote: quote.signed_fee_quote,
      quote_hashes: quote.quote_hashes,
      amount_in: amountIn,
      intent: {
        diff: { [args.intentFrom]: `-${amountIn}`, [args.intentTo]: String(args.amountOut) },
        referral: "intents.tg",
        intent: "token_diff",
      },
    };
  }

  async buildGaslessWithdrawIntent(args: { feeToken: string; feeAmount: bigint; chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string }) {
    const nonEvm = args.chain === Network.Stellar || isTon(args.chain);
    const blockNumber = nonEvm ? 0 : await this.evm.getProvider(args.chain).getBlockNumber();

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

  async checkWithdrawNonce(chain: number, receiver: string, nonce: string) {
    const pendings = await this.getPendingWithdrawalsWithStatus(chain, receiver);
    const completed = pendings.filter((t) => t.completed);
    if (completed.length) await this.clearPendingWithdrawals(completed);

    const uncompleted = pendings.filter((t) => !t.completed);
    const earliest = uncompleted.find((t) => BigInt(t.nonce) < BigInt(nonce));
    if (earliest) throw `Withdrawal previous pending withdrawal`;
  }

  async checkLocker(chain: number, address: string, receiver: string) {
    if (PoA_BRIDGE_TOKENS_INVERTED[`${chain}:${address}`]) return;
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
    if (PoA_BRIDGE_TOKENS_INVERTED[`${args.chain}:${args.token}`]) throw new GaslessNotAvailable(args.chain);
    if (args.chain === Network.Near) throw new GaslessNotAvailable(args.chain);

    // Get gas price
    const { gasPrice } = await this.getGaslessWithdrawFee(args.chain, args.receiver).catch(() => ({ gasPrice: null }));
    if (gasPrice == null) throw new GaslessNotAvailable(args.chain);
    this.logger?.log(`Gasless withdraw gas price: ${gasPrice}`);

    // Swap part of input token to gas token
    let qoute;
    if (gasPrice > 0n && args.token !== "native") {
      qoute = await this.buildSwapExectOutIntent({
        intentFrom: toOmniIntent(args.chain, args.token),
        intentTo: toOmniIntent(args.chain, "native"),
        intentAccount: args.intentAccount,
        amountOut: gasPrice,
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

    if (args.gasless !== false) {
      try {
        return await this.buildGaslessWithdrawToken(args);
      } catch (e) {
        if (!(e instanceof GaslessNotAvailable)) throw e;
        this.logger?.log(`Gasless withdraw not available for chain ${args.chain}, using regular withdraw`);
      }
    }

    const intent = await this.buildWithdrawIntent(args);
    return { intents: [intent], quoteHashes: [], gasless: false };
  }

  async waitGaslessWithdraw(nonce: string, chain: number, receiver: string) {
    let attempts = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (attempts > 50) throw new GaslessWithdrawTxNotFound(nonce, chain, receiver);
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
      const response = await this.api.requestApi("/rpc", {
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
    adjustMax?: boolean;
    gasless?: boolean;
  }) {
    if (args.chain === Network.Near && args.token !== "wrap.near") {
      const isRegistered = await this.near.isTokenRegistered(args.token, args.intentAccount);
      if (!isRegistered) throw new NearTokenNotRegistered(args.token, args.intentAccount);
    }

    const balance = await this.getIntentBalance(toOmniIntent(args.chain, args.token), args.intentAccount);
    if (args.adjustMax && balance < args.amount) args.amount = balance;
    if (balance < args.amount) throw new IntentBalanceIsLessThanAmount(args.token, args.intentAccount, args.amount);

    await this.checkLocker(args.chain, args.token, args.receiver);

    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);
    const result = await this.buildWithdrawToken(args);

    this.logger?.log(`Sign withdraw intent`);
    const signedIntents = await args.signIntents(result.intents);

    this.logger?.log(`Push withdraw intent`);
    const tx = await this.executeIntents([signedIntents], result.quoteHashes);

    if (PoA_BRIDGE_TOKENS_INVERTED[`${args.chain}:${args.token}`]) return await this.waitPoaWithdraw(tx.hash);
    if (args.chain === Network.Near) return; // NEAR chain has native withdrawals

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    this.logger?.log(`Wait gasless withdraw`);
    if (result.gasless) {
      await this.waitGaslessWithdraw(nonce, args.chain, args.receiver);
      return;
    }

    return { nonce, tx: tx.hash, sender: tx.sender };
  }

  async waitUntilBalance(intent: string, amount: bigint, intentAccount: string, attempts = 0): Promise<bigint> {
    if (attempts > 120) throw "Balance is not changed after 120 seconds";
    const balance = await this.getIntentBalance(intent, intentAccount).catch(() => 0n);
    if (balance >= amount) return balance;

    await wait(1000);
    return await this.waitUntilBalance(intent, amount, intentAccount, attempts + 1);
  }

  async swapTokens(args: {
    intentFrom: string;
    intentTo: string;
    amountIn: bigint;
    minAmountOut: bigint;
    intentAccount: string;
    signIntents: (intents: any[]) => Promise<any>;
  }): Promise<{ amountOut: bigint }> {
    const quote = await this.buildSwapExectInIntent({
      intentAccount: args.intentAccount,
      intentFrom: args.intentFrom,
      intentTo: args.intentTo,
      amountIn: args.amountIn,
    });

    const amountOut = BigInt(quote.intent.diff[args.intentTo] || 0n);
    if (amountOut < args.minAmountOut) throw new SlippageError(args.minAmountOut, amountOut);
    quote.intent.diff[args.intentTo] = String(args.minAmountOut);

    const signedIntents = await args.signIntents([quote.intent]);
    await this.executeIntents([signedIntents, quote.signed_fee_quote].filter(Boolean), quote.quote_hashes);
    await this.waitUntilBalance(args.intentTo, args.minAmountOut, args.intentAccount);
    return { amountOut };
  }
}

export default HotBridge;
