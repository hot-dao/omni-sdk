import { baseDecode } from "@near-js/utils";
import { Action } from "near-api-js/lib/transaction";
import chunk from "lodash/chunk";

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
} from "./utils";
import { PendingDepositWithIntent, PendingWithdraw } from "./types";
import { Network, chains } from "./chains";
import OmniApi from "./api";

import SolanaOmniService from "./bridge-solana";
import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonOmniService from "./bridge-ton";
import NearBridge from "./bridge-near";
import { Api } from ".";

export class GaslessNotAvailable extends Error {
  constructor(chain: Network) {
    super(`Gasless withdraw not available for chain ${chain}`);
  }
}

export class GaslessWithdrawTxNotFound extends Error {
  constructor(readonly nonce: string, readonly chain: Network, readonly receiver: string) {
    super(`Gasless withdraw tx not found for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class GaslessWithdrawCanceled extends Error {
  constructor(readonly reason: string, readonly nonce: string, readonly chain: Network, readonly receiver: string) {
    super(`Gasless withdraw canceled for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

class HotBridge {
  logger?: Logger;
  solverBusRpc: string;
  executeNearTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;

  stellar: StellarService;
  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;

  constructor({
    logger,
    tonApiKey,
    evmRpc,
    solanaRpc,
    executeNearTransaction,
  }: {
    logger?: Logger;
    tonApiKey?: string;
    evmRpc?: Record<number, string[]>;
    solanaRpc?: string[];
    solverBusRpc?: string;
    executeNearTransaction: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
  }) {
    this.executeNearTransaction = executeNearTransaction;
    this.logger = logger;

    this.solverBusRpc = "https://api.herewallet.app/api/v1/evm/intent-solver";
    this.ton = new TonOmniService(this, tonApiKey);
    this.evm = new EvmOmniService(this, evmRpc);
    this.solana = new SolanaOmniService(this, solanaRpc);
    this.stellar = new StellarService(this);
    this.near = new NearBridge(this);
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

  async getAllIntentBalances(intentAccount: string) {
    const data = await fetch(`https://api.fastnear.com/v0/account/intents.near/ft`)
      .then((t) => t.json())
      .catch(() => null);

    const ids = new Set<string>(data?.contract_ids.map((t: any) => toOmniIntent(Network.Near, t)));
    const tokens = await OmniApi.shared.getBridgeTokens();
    Object.values(tokens.groups).forEach((t) => t.forEach((t) => ids.add(t)));

    const chunks = chunk(Array.from(ids), 200);
    const balances: Record<string, bigint> = {};
    for (const chunk of chunks) {
      const batch = await this.getIntentBalances(chunk, intentAccount);
      Object.assign(balances, batch);
    }

    return balances;
  }

  async getIntentBalances(intents: string[], intentAccount: string) {
    const balances = await this.near.rpc.viewFunction({
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
    if (chain === Network.Ton) return await this.ton.getTokenBalance(token, address);
    if (chain === Network.Near) return await this.near.getTokenBalance(token, address);
    if (chain === Network.Solana) return await this.solana.getTokenBalance(token, address);
    if (chain === Network.Stellar) return await this.stellar.getTokenBalance(token, address);
    if (chains.get(chain)?.isEvm) return await this.evm.getTokenBalance(token, chain, address);
    throw `Unsupported chain address ${chain}`;
  }

  async getPendingWithdrawals(chain: number, receiver: string): Promise<PendingWithdraw[]> {
    const withdrawals = await this.near.rpc.viewFunction({
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
      const completed = await this.isWithdrawUsed(chain, pending.nonce, receiver);
      return { ...pending, completed };
    });

    return await Promise.all(tasks);
  }

  async clearPendingWithdrawals(withdrawals: PendingWithdraw[]) {
    const tasks = withdrawals.map(async (withdraw) => {
      const receiver = encodeReceiver(withdraw.chain, withdraw.receiver);
      const signature = await OmniApi.shared.clearWithdrawSign(withdraw.nonce, Buffer.from(baseDecode(receiver)));
      return this.near.functionCall({
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
    return await this.near.rpc.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT_V2,
    });
  }

  async isWithdrawUsed(chain: number, nonce: string, receiver: string) {
    if (chain === Network.Ton) return await this.ton.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Solana) return await this.solana.isWithdrawUsed(nonce, receiver);
    if (chain === Network.Stellar) return await this.stellar.isWithdrawUsed(nonce);
    if (chains.get(chain)?.isEvm) return await this.evm.isWithdrawUsed(chain, nonce);
    return false;
  }

  async buildWithdraw(nonce: string) {
    this.logger?.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer = await this.near.rpc.viewFunction({
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

    this.logger?.log(`Depositing on ${chains.get(transfer.chain_id)?.symbol}`);
    const token = decodeTokenAddress(transfer.chain_id, transfer.contract_id);

    this.logger?.log("Signing withdraw");
    const signature = await OmniApi.shared.withdrawSign(nonce);

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
    const isExecuted = await this.near.rpc.viewFunction({
      args: { nonce: deposit.nonce, chain_id: deposit.chain },
      contractId: OMNI_HOT_V2,
      methodName: "is_executed",
    });

    if (isExecuted) return null;

    this.logger?.log(`Signing deposit`);
    const signature = await OmniApi.shared.depositSign(
      deposit.chain,
      deposit.nonce,
      deposit.sender,
      deposit.receiver,
      encodeTokenAddress(deposit.chain, deposit.token),
      deposit.amount
    );

    const depositAction = this.near.functionCall({
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

  async canWithdrawOnTon(address: string) {
    const receiver = decodeReceiver(Network.Ton, encodeReceiver(Network.Ton, address));
    return await this.ton.isUserExists(receiver);
  }

  async getWithdrawFee(chain: Network, token: string): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    return await Api.shared.getWithdrawFee(chain, token);
  }

  async buildWithdrawIntent(args: { chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string }) {
    const token = toOmniIntent(args.chain, args.token);
    const receiver = encodeReceiver(args.chain, args.receiver);
    const [format, address] = token.split(/:(.*)/s);

    if (format === "nep245") {
      const [mt_contract, token_id] = address.split(":");
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
        intent: address === "native" ? "native_withdraw" : "ft_withdraw",
        token: address === "native" ? undefined : address,
        amount: args.amount.toString(),
        receiver_id: receiver,
      };
    }

    throw `Unsupported token format ${format}`;
  }

  async buildSwapExectInIntent(tokensFrom: Record<string, bigint>, tokenTo: string, amount: number) {
    const quote = await Api.shared.getSwapQuoteExectIn(tokensFrom, tokenTo, amount);
    // TODO: Add intents validations

    return {
      quote_hashes: quote.quote_hashes,
      signed_fee_quote: quote.signed_fee_quote,
      intents: quote.quote.intents,
      amount_out: quote.amount_out,
      fees: quote.fees,
    };
  }

  async buildSwapExectOutIntent(args: { chainFrom: Network; tokenFrom: string; chainTo: Network; tokenTo: string; amount: bigint }) {
    const from = toOmniIntent(args.chainFrom, args.tokenFrom);
    const to = toOmniIntent(args.chainTo, args.tokenTo);
    const quote = await Api.shared.getSwapQuoteExectOut(from, to, args.amount);

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

  async buildGaslessWithdrawIntent(args: {
    feeToken: string;
    feeAmount: bigint;
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
  }) {
    const blockNumber = await this.evm.getProvider(args.chain).getBlockNumber();
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
    return await this.near.rpc.viewFunction({
      contractId: "bridge-refuel.hot.tg",
      methodName: "get_withdrawal_hash",
      args: { nonce },
    });
  }

  async swapTokens(args: {
    chainFrom: Network;
    chainTo: Network;
    tokenFrom: string;
    tokenTo: string;
    amount: number;
    intentAccount: string;
    signIntents: (intents: any[]) => Promise<any>;
  }) {
    const tokenFrom = toOmniIntent(args.chainFrom, args.tokenFrom);
    const tokenTo = toOmniIntent(args.chainTo, args.tokenTo);

    const balance = await this.getIntentBalance(tokenFrom, args.intentAccount);
    const quote = await this.buildSwapExectInIntent({ [tokenFrom]: balance }, tokenTo, args.amount);

    const signedIntents = await args.signIntents(quote.intents);
    return await this.executeIntents([quote.signed_fee_quote, signedIntents], quote.quote_hashes);
  }

  async gaslessWithdrawToken(args: {
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
    signIntents: (intents: any[]) => Promise<any>;
  }) {
    const { gasPrice } = await this.getWithdrawFee(args.chain, args.token).catch(() => ({ gasPrice: null }));
    if (gasPrice == null) throw new GaslessNotAvailable(args.chain);

    let qoute;
    if (gasPrice > 0n) {
      qoute = await this.buildSwapExectOutIntent({
        chainFrom: args.chain,
        tokenFrom: args.token,
        chainTo: args.chain,
        tokenTo: "native",
        amount: gasPrice,
      });
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

    const signedIntents = await args.signIntents([qoute?.intent, withdrawIntent].filter((t) => t != null));
    const tx = await this.executeIntents([signedIntents], qoute?.quote_hashes || []);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    let attempts = 0;
    while (true) {
      if (attempts > 30) throw new GaslessWithdrawTxNotFound(nonce, args.chain, args.receiver);
      await wait(2000);

      const status = await this.getGaslessWithdrawStatus(nonce);
      if (status?.startsWith("CANCELED")) throw new GaslessWithdrawCanceled(status, nonce, args.chain, args.receiver);
      if (status) return `0x${status}`;
      attempts += 1;
    }
  }

  async withdrawToken(args: {
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
    signIntents: (intents: Record<string, any>[]) => Promise<any>;
    gasless?: boolean;
  }) {
    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);

    if (args.gasless !== false) {
      try {
        await this.gaslessWithdrawToken(args);
        return null; // Completed!
      } catch (e) {
        if (!(e instanceof GaslessNotAvailable)) throw e;
        this.logger?.log(`Gasless withdraw not available for chain ${args.chain}, using regular withdraw`);
      }
    }

    if (args.chain === Network.Ton) {
      const isUserExists = await this.canWithdrawOnTon(args.receiver);
      if (!isUserExists) throw "User jetton not created, call bridge.createUserIfNeeded({ address, sendTransaction }) before withdraw";
    }

    if (args.chain !== Network.Near) {
      const pendings = await this.getPendingWithdrawalsWithStatus(args.chain, args.receiver);
      const completed = pendings.filter((t) => t.completed);

      if (completed.length) await this.clearPendingWithdrawals(completed);
      if (pendings.some((t) => !t.completed)) throw "Complete previous withdrawals before make new";
    }

    const intent = await this.buildWithdrawIntent(args);

    this.logger?.log(`Sign withdraw intent`);
    const signedIntent = await args.signIntents([intent]);

    this.logger?.log(`Push withdraw intent`);
    const tx = await this.executeIntents([signedIntent], []);

    // Intent withdraw directry on NEAR for receiver
    if (args.chain === Network.Near) return;

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    this.logger?.log(`Depositing to ${args.chain}`);
    return await this.buildWithdraw(nonce);
  }
}

export default HotBridge;
