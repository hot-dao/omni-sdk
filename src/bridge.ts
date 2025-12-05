import type { Action } from "@near-js/transactions";
import { baseEncode } from "@near-js/utils";

import {
  Logger,
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
  legacyUnsafeOmniEphemeralReceiver,
  fromOmni,
  isCosmos,
} from "./utils";
import {
  GaslessNotAvailableError,
  GaslessWithdrawCanceledError,
  GaslessWithdrawTxNotFoundError,
  IntentBalanceIsLessThanAmountError,
  MismatchReceiverAndIntentAccountError,
  NearTokenNotRegisteredError,
  ProcessAbortedError,
  SlippageError,
  DepositAlreadyClaimedError,
  CompletePreviousWithdrawalsError,
  WithdrawalNotFoundError,
  FailedToExecuteDepositError,
  UnsupportedTokenFormatError,
} from "./errors";
import { BridgeOptions, Network, PendingDepositWithIntent, PendingWidthdrawData, WithdrawArgsWithPending } from "./types";
import OmniApi from "./api";

import { INTENTS_CONTRACT, OMNI_HOT_V2, Settings } from "./env";
import { NEAR_PER_GAS, TGAS, ReviewFee } from "./fee";
import type { SolanaOmniService } from "./bridge-solana";
import type { CosmosService } from "./bridge-cosmos";

import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonOmniService from "./bridge-ton";
import NearBridge from "./bridge-near";

class HotBridge {
  logger?: Logger;
  executeNearTransaction?: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
  publishIntents: (signedDatas: any[], quoteHashes: string[]) => Promise<{ sender: string; hash: string }>;

  defaultEvmWithdrawFee: bigint = 1_000_000n;
  withdrawFees: Record<number, bigint> = {
    [Network.Bnb]: 200_000n,
    [Network.Eth]: 200_000n,
    [Network.Polygon]: 200_000n,
    [Network.Avalanche]: 200_000n,
    [Network.Base]: 200_000n,
    [Network.Optimism]: 200_000n,
    [Network.Xlayer]: 200_000n,
    [Network.Monad]: 200_000n,
  };

  stellar: StellarService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;
  api: OmniApi;

  constructor(readonly options: BridgeOptions) {
    this.executeNearTransaction = options.executeNearTransaction;
    this.publishIntents = options.publishIntents ?? this.executeIntents;
    this.logger = options.logger;

    this.api = new OmniApi(options.api, options.mpcApi);
    this.near = new NearBridge(this, options.nearRpc);

    this.evm = new EvmOmniService(this, {
      enableApproveMax: options.enableApproveMax,
      treasuryDefaultContract: options.evmTreasuryDefaultContract,
      treasuryContracts: options.evmTreasuryContracts,
      rpcs: options.evmRpc,
    });

    this.withdrawFees = Object.assign(this.withdrawFees, options.withdrawFees);
    this.defaultEvmWithdrawFee = options.defaultEvmWithdrawFee || 1_000_000n;

    this.stellar = new StellarService(this, {
      contract: options.stellarContract,
      sorobanRpc: options.stellarRpc,
      horizonRpc: options.stellarHorizonRpc,
      baseFee: options.stellarBaseFee,
    });

    this.ton = new TonOmniService(this, {
      contract: options.tonContract,
      rpc: options.tonRpc,
    });

    Object.assign(Settings.cosmos, options.cosmos);
  }

  _solana: SolanaOmniService | null = null;
  async solana() {
    if (this._solana) return this._solana;
    const pkg = await import("./bridge-solana");
    this._solana = new pkg.SolanaOmniService(this, { rpc: this.options.solanaRpc, programId: this.options.solanaProgramId });
    return this._solana!;
  }

  _cosmos: CosmosService | null = null;
  async cosmos() {
    if (this._cosmos) return this._cosmos;
    const pkg = await import("./bridge-cosmos");
    this._cosmos = new pkg.CosmosService(this);
    return this._cosmos!;
  }

  private _cacheCompleted: Record<string, boolean> = {};
  /** Check pending withdrawal and cache completed withdrawals  */
  async checkPendingWithdrawalWithCache(
    pending: WithdrawArgsWithPending,
    data: {
      completedWithHash?: (pending: WithdrawArgsWithPending) => Promise<any>;
      completedWithoutHash?: (pending: WithdrawArgsWithPending) => Promise<any>;
      needToExecute?: (pending: WithdrawArgsWithPending) => Promise<any>;
    }
  ) {
    if (pending.withdraw_hash) {
      await data.completedWithHash?.(pending);
      return;
    }

    const isCompleted = this._cacheCompleted[pending.nonce];
    if (isCompleted) {
      await data.completedWithoutHash?.(pending);
      return;
    }

    if (pending.chain === Network.Solana) {
      const solana = await this.solana();
      const isUsed = await solana.isWithdrawUsed(pending.nonce, pending.receiver);
      this._cacheCompleted[pending.nonce] = isUsed;
      if (isUsed) await data.completedWithoutHash?.(pending);
      else await data.needToExecute?.(pending);
      return;
    }

    if (pending.chain === Network.Stellar) {
      const isUsed = await this.stellar.isWithdrawUsed(pending.nonce);
      this._cacheCompleted[pending.nonce] = isUsed;
      if (isUsed) await data.completedWithoutHash?.(pending);
      else await data.needToExecute?.(pending);
      return;
    }

    if (isTon(pending.chain)) {
      const isUsed = await this.ton.isWithdrawUsed(pending.nonce, pending.receiver);
      this._cacheCompleted[pending.nonce] = isUsed;
      if (isUsed) await data.completedWithoutHash?.(pending);
      else await data.needToExecute?.(pending);
      return;
    }

    const isUsed = await this.evm.isWithdrawUsed(pending.chain, pending.nonce);
    this._cacheCompleted[pending.nonce] = isUsed;
    if (isUsed) await data.completedWithoutHash?.(pending);
    else await data.needToExecute?.(pending);
  }

  parsePendingWithdrawal(pending: PendingWidthdrawData): WithdrawArgsWithPending {
    const args: WithdrawArgsWithPending = {
      receiver: decodeReceiver(pending.chain_id, pending.withdraw_data.receiver_id),
      withdraw_hash: pending.withdraw_hash || undefined,
      amount: BigInt(pending.withdraw_data.amount),
      timestamp: pending.timestamp,
      near_trx: pending.near_trx,
      chain: pending.chain_id,
      nonce: pending.nonce,
      token: "",
    };

    // TODO: Fix it on backend
    const { contract_id, token_id } = pending.withdraw_data;
    const id = contract_id != null ? (contract_id.includes("_") ? contract_id : pending.chain_id + "_" + contract_id) : token_id?.includes("_") ? token_id : pending.chain_id + "_" + token_id;
    args.token = fromOmni(id).split(":")[1];
    return args;
  }

  /** Iterates over the withdrawals, in parallel for chains and sequentially and chronologically for each chain */
  async iterateWithdrawals(args: { logger?: Logger; signal?: AbortSignal; submitHashesPwd?: string; execute: (pending: WithdrawArgsWithPending) => Promise<string | null> }) {
    const logger = args.logger || new Logger();
    const pendings = await this.api.getPendingsWithdrawals();
    const receivers: Record<number, Set<string>> = {};
    pendings.forEach((pending) => {
      if (pending.withdraw_data == null) return;
      if (pending.sender_id !== "bridge-refuel.hot.tg") return;
      if (receivers[pending.chain_id] == null) receivers[pending.chain_id] = new Set<string>();
      receivers[pending.chain_id].add(decodeReceiver(pending.chain_id, pending.withdraw_data.receiver_id));
    });

    const tasks = Object.entries(receivers).map(async ([chain, receivers]) => {
      for (const receiver of receivers) {
        try {
          if (args.signal?.aborted) break;
          logger.log(`Getting pending withdrawals for chain ${chain} and receiver ${receiver}`);
          const pendings = await this.getPendingWithdrawalsWithStatus(Number(chain), receiver);
          const completed = pendings.filter((t) => t.completed);

          logger.log(`Pending withdrawals: ${pendings.length}, completed: ${completed.length}`);
          if (completed.length) {
            if (args.signal?.aborted) break;
            logger.log(`Clearing ${completed.length} completed withdrawals for chain ${chain} and receiver ${receiver}`, completed);
            await this.clearPendingWithdrawals(completed);
            if (args.signal?.aborted) break;
          }

          const uncompleted = pendings.filter((t) => !t.completed);
          for (const pending of uncompleted) {
            if (args.signal?.aborted) break;
            logger.log(`Executing withdrawal for chain ${chain} and receiver ${receiver}`, pending);
            const hash = await args.execute(pending);
            if (hash == null) throw "Execute failed because of no hash";

            if (args.submitHashesPwd) {
              this.api
                .requestApi("/api/v1/evm/bridge_withdrawal_hash", {
                  endpoint: "https://dev.herewallet.app",
                  method: "POST",
                  body: JSON.stringify({
                    nonce: pending.nonce,
                    withdraw_hash: hash,
                    pswd: args.submitHashesPwd,
                    chain_id: chain,
                  }),
                })
                .then(() => {
                  logger.log(`Submitted withdrawal hash for nonce ${pending.nonce}: ${hash}`);
                })
                .catch((e) => {
                  logger.warn(`Failed to submit withdrawal hash for nonce ${pending.nonce}: ${hash}`, e);
                });
            }

            logger.log(`Clearing withdrawal for chain ${chain} and receiver ${receiver}`, pending);
            await this.clearPendingWithdrawals([pending]);
          }
        } catch (e) {
          logger.warn(`Failed to execute withdrawal for chain ${chain} and receiver ${receiver}`, e);
        }
      }
    });

    await Promise.allSettled(tasks);
  }

  executeIntents = async (signedDatas: any[], quoteHashes: string[]) => {
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
    return { sender: INTENTS_CONTRACT, hash };
  };

  async getAllIntentBalances(intentAccount: string, intentsContract = INTENTS_CONTRACT) {
    const accounts = new Set<string>();
    const limit = 250;
    let fromIndex = 0n;

    while (true) {
      const batch = await this.near.viewFunction({
        args: { account_id: intentAccount, from_index: fromIndex.toString(), limit },
        methodName: "mt_tokens_for_owner",
        contractId: intentsContract,
      });

      batch.forEach((account: any) => accounts.add(account.token_id));
      if (batch.length < limit) break;
      fromIndex += BigInt(limit);
    }

    return await this.getIntentBalances(Array.from(accounts), intentAccount, intentsContract);
  }

  async getIntentBalances(intents: string[], intentAccount: string, intentsContract = INTENTS_CONTRACT) {
    const balances = await this.near.viewFunction({
      args: { token_ids: intents, account_id: intentAccount },
      methodName: "mt_batch_balance_of",
      contractId: intentsContract,
    });

    return intents.reduce((acc, id, index) => {
      acc[id] = BigInt(balances[index] || 0n);
      return acc;
    }, {} as Record<string, bigint>);
  }

  async getIntentBalance(intentId: string, intentAccount: string, intentsContract = INTENTS_CONTRACT) {
    const balances = await this.getIntentBalances([intentId], intentAccount, intentsContract);
    return balances[intentId] || 0n;
  }

  async getPendingWithdrawals(chain: number, receiver: string): Promise<WithdrawArgsWithPending[]> {
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

  async getPendingWithdrawalsWithStatus(chain: number, receiver: string): Promise<(WithdrawArgsWithPending & { completed: boolean })[]> {
    if (chain === 1111) chain = 1117;
    const pendings = await this.getPendingWithdrawals(chain, receiver);
    const tasks = pendings.map<Promise<WithdrawArgsWithPending & { completed: boolean }>>(async (pending) => {
      const completed = await this.isWithdrawUsed(chain, pending.nonce, receiver).catch(() => false);
      return { ...pending, completed };
    });

    return await Promise.all(tasks);
  }

  async clearPendingWithdrawals(withdrawals: WithdrawArgsWithPending[]) {
    const tasks = withdrawals.map<Promise<Action | null>>(async (withdraw) => {
      const { signature, hash, sender_id } = await this.api.executeClearWithdraw(withdraw.chain, withdraw.nonce, withdraw.receiver);
      if (hash && sender_id) return null;

      return functionCall({
        methodName: "clear_completed_withdrawal",
        args: { nonce: withdraw.nonce, signature },
        gas: String(80n * TGAS),
        deposit: "0",
      });
    });

    const actions: Action[] = (await Promise.all(tasks)).filter((t) => t != null);
    if (actions.length === 0) return null;

    if (!this.executeNearTransaction) throw "No executeNearTransaction";
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
    if (isCosmos(chain)) return await this.cosmos().then((s) => s.isWithdrawUsed(chain, nonce));
    if (chain === Network.Solana) return await this.solana().then((s) => s.isWithdrawUsed(nonce, receiver));
    if (chain === Network.Stellar) return await this.stellar.isWithdrawUsed(nonce);
    return await this.evm.isWithdrawUsed(chain, nonce);
  }

  async getPendingWithdrawal(nonce: string): Promise<WithdrawArgsWithPending> {
    this.logger?.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer = await this.near.viewFunction({
      contractId: OMNI_HOT_V2,
      methodName: "get_transfer",
      args: { nonce },
    });

    if (!transfer) throw new WithdrawalNotFoundError(nonce);
    this.logger?.log(`Transfer: ${JSON.stringify(transfer, null, 2)}`);

    this.logger?.log(`Checking if nonce is used`);
    const receiver = decodeReceiver(transfer.chain_id, transfer.receiver_id);

    const isUsed = await this.isWithdrawUsed(transfer.chain_id, nonce, receiver).catch(() => false);
    if (isUsed) throw new DepositAlreadyClaimedError(transfer.chain_id, nonce);

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
      if (isCosmos(chain)) return await this.cosmos().then((s) => s.parseDeposit(chain, hash));
      if (chain === Network.Solana) return await this.solana().then((s) => s.parseDeposit(hash));
      if (chain === Network.Stellar) return await this.stellar.parseDeposit(hash);
      return await this.evm.parseDeposit(chain, hash);
    };

    while (true) {
      if (abort?.aborted) throw new ProcessAbortedError("waitPendingDeposit");
      const deposit = await waitPending().catch((e) => {
        this.logger?.log(`Error waiting pending deposit: ${e}`);
        return null;
      });

      if (deposit) {
        const isUsed = await this.isDepositUsed(deposit.chain, deposit.nonce);
        if (isUsed) throw new DepositAlreadyClaimedError(deposit.chain, deposit.nonce);

        const receiver = baseEncode(omniEphemeralReceiver(intentAccount));
        const unsafeReceiver = baseEncode(legacyUnsafeOmniEphemeralReceiver(intentAccount));
        if (deposit.receiver !== receiver && deposit.receiver !== unsafeReceiver) {
          throw new MismatchReceiverAndIntentAccountError(deposit.receiver, intentAccount);
        }

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
    const msg = JSON.stringify({ receiver_id: deposit.intentAccount });
    const { signature, hash, sender_id, status } = await this.api.executeDeposit({
      receiver_id: deposit.receiver,
      sender_id: deposit.sender,
      amount: deposit.amount,
      nonce: deposit.nonce,
      chain_id: chain,
      token_id: token,
      msg,
    });

    if (hash && sender_id) return { hash, sender: sender_id };
    if (status === "ok") return null;

    if (!signature) throw new FailedToExecuteDepositError(status);
    const depositAction = functionCall({
      methodName: "mt_deposit_call",
      gas: String(80n * TGAS),
      deposit: "1",
      args: {
        deposit_call_args: { account_id: INTENTS_CONTRACT, msg },
        amount: deposit.amount,
        nonce: deposit.nonce,
        contract_id: token,
        chain_id: chain,
        signature,
      },
    });

    try {
      this.logger?.log(`Calling deposit to omni and deposit to intents`);
      if (!this.executeNearTransaction) throw "No executeNearTransaction";
      return await this.executeNearTransaction({ actions: [depositAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      if (!e?.toString?.().includes("Nonce already used")) throw e;
      return null;
    }
  }

  async getGaslessWithdrawFee(options: { chain: number; token: string; receiver: string }): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    if (options.chain === Network.Solana) throw new GaslessNotAvailableError(options.chain);

    if (options.chain === Network.Stellar) {
      const exists = await this.stellar.isAccountExists(options.receiver);
      if (!exists) return { gasPrice: 11000000n, blockNumber: 0n };
      return { gasPrice: 1000000n, blockNumber: 0n };
    }

    if ([Network.Juno, Network.Gonka, Network.Near, Network.Hot].includes(options.chain)) return { gasPrice: 0n, blockNumber: 0n };

    if ([Network.Ton, Network.OmniTon].includes(options.chain)) return { gasPrice: 40000000n, blockNumber: 0n };

    const { gasPrice } = await this.evm.getProvider(options.chain).getFeeData();
    const blockNumber = await this.evm.getProvider(options.chain).getBlockNumber();
    const gasLimit = this.withdrawFees[options.chain] || this.defaultEvmWithdrawFee;
    const fee = (BigInt(gasPrice || 0n) * 130n) / 100n;

    return { gasPrice: fee * gasLimit, blockNumber: BigInt(blockNumber) };
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
      const isNative = address === "wrap.near" || address === "native";
      return {
        intent: isNative ? "native_withdraw" : "ft_withdraw",
        memo: args.chain !== Network.Near ? `WITHDRAW_TO:${args.receiver}` : undefined,
        receiver_id: args.chain !== Network.Near ? address : args.receiver,
        token: isNative ? undefined : address,
        amount: args.amount.toString(),
      };
    }

    throw new UnsupportedTokenFormatError(token);
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

  async buildSwapExectOutIntent(args: { intentFrom: string; intentTo: string; amountOut: bigint }) {
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

  async buildGaslessWithdrawIntent(args: { feeToken: string; feeAmount: bigint; blockNumber: bigint; chain: Network; token: string; amount: bigint; receiver: string }) {
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
        block_number: Number(args.blockNumber),
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
    if (earliest) throw new CompletePreviousWithdrawalsError(chain, receiver, earliest.nonce);
  }

  async checkLocker(chain: number, address: string, receiver: string) {
    console.warn("use checkWithdrawLocker instead of checkLocker");
    await this.checkWithdrawLocker(chain, address, receiver);
  }

  async checkWithdrawLocker(chain: number, address: string, receiver: string) {
    if (chain === Network.Near) return;
    const pendings = await this.getPendingWithdrawalsWithStatus(chain, receiver);
    const completed = pendings.filter((t) => t.completed);

    if (completed.length) await this.clearPendingWithdrawals(completed);
    const earliest = pendings.find((t) => !t.completed);
    if (earliest) throw new CompletePreviousWithdrawalsError(chain, receiver, earliest.nonce);
  }

  async buildGaslessWithdrawToken(args: { chain: Network; token: string; amount: bigint; receiver: string; gasless?: boolean }): Promise<{ gasless: boolean; intents: any[]; quoteHashes: string[] }> {
    if (args.chain === Network.Near) throw new GaslessNotAvailableError(args.chain);

    // Get gas price
    const { gasPrice, blockNumber } = await this.getGaslessWithdrawFee({ chain: args.chain, token: args.token, receiver: args.receiver }).catch(() => ({ gasPrice: null, blockNumber: null }));
    if (gasPrice == null || blockNumber == null) throw new GaslessNotAvailableError(args.chain);
    this.logger?.log(`Gasless withdraw gas price: ${gasPrice}`);

    // Swap part of input token to gas token
    let qoute;
    if (gasPrice > 0n && args.token !== "native") {
      qoute = await this.buildSwapExectOutIntent({
        intentFrom: toOmniIntent(args.chain, args.token),
        intentTo: toOmniIntent(args.chain, "native"),
        amountOut: gasPrice,
      }).catch(() => null);

      // Not enough input amount for gas covering
      if (qoute == null || BigInt(qoute.amount_in) >= args.amount) {
        throw new GaslessNotAvailableError(args.chain);
      }
    }

    // Not enough input amount for gas covering
    if (args.token === "native" && args.amount <= gasPrice) {
      throw new GaslessNotAvailableError(args.chain);
    }

    const withdrawIntent = await this.buildGaslessWithdrawIntent({
      amount: args.amount - BigInt(qoute?.amount_in || 0n),
      receiver: args.receiver,
      chain: args.chain,
      token: args.token,
      feeToken: "native",
      feeAmount: gasPrice,
      blockNumber: blockNumber,
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

    if (args.gasless) {
      try {
        return await this.buildGaslessWithdrawToken(args);
      } catch (e) {
        if (!(e instanceof GaslessNotAvailableError)) throw e;
        this.logger?.log(`Gasless withdraw not available for chain ${args.chain}, using regular withdraw`);
      }
    }

    const intent = await this.buildWithdrawIntent(args);
    return { intents: [intent], quoteHashes: [], gasless: false };
  }

  async waitGaslessWithdraw(nonce: string, chain: number, receiver: string) {
    let attempts = 0;

    while (true) {
      if (attempts > 50) throw new GaslessWithdrawTxNotFoundError(nonce, chain, receiver);
      await wait(2000);

      const status = await this.getGaslessWithdrawStatus(nonce);
      if (status?.startsWith("CANCELED")) throw new GaslessWithdrawCanceledError(status, nonce, chain, receiver);
      if (status === "COMPLETED") return "0x0";
      if (status) return `0x${status}`;
      attempts += 1;
    }
  }

  async gaslessWithdrawToken(args: { chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string; signIntents: (intents: any[]) => Promise<any> }) {
    const { intents, quoteHashes } = await this.buildGaslessWithdrawToken(args);
    const signedIntents = await args.signIntents(intents);
    const tx = await this.publishIntents([signedIntents], quoteHashes);

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
    const isNative = args.token === "wrap.near" || args.token === "native";
    if (args.chain === Network.Near && !isNative) {
      const isRegistered = await this.near.isTokenRegistered(args.token, args.receiver);
      if (!isRegistered) throw new NearTokenNotRegisteredError(args.token, args.receiver);
    }

    const balance = await this.getIntentBalance(toOmniIntent(args.chain, args.token), args.intentAccount);
    if (args.adjustMax && balance < args.amount) args.amount = balance;
    if (balance < args.amount) throw new IntentBalanceIsLessThanAmountError(args.token, args.intentAccount, args.amount);

    await this.checkLocker(args.chain, args.token, args.receiver);

    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);
    const result = await this.buildWithdrawToken(args);

    this.logger?.log(`Sign withdraw intent`);
    const signedIntents = await args.signIntents(result.intents);

    this.logger?.log(`Push withdraw intent`);
    const tx = await this.publishIntents([signedIntents], result.quoteHashes);
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
    await this.publishIntents([signedIntents, quote.signed_fee_quote].filter(Boolean), quote.quote_hashes);
    await this.waitUntilBalance(args.intentTo, args.minAmountOut, args.intentAccount);
    return { amountOut };
  }

  async getWithdrawFee(address: string, chain: number, token: string, gasless = true): Promise<ReviewFee> {
    if (chain === Network.Near) return new ReviewFee({ gasless: true, baseFee: NEAR_PER_GAS, gasLimit: 300n * TGAS, chain });
    if (chain === Network.Hot) return new ReviewFee({ gasless: true, chain });

    if (gasless) {
      const fee = await this.getGaslessWithdrawFee({ chain, token, receiver: address }).catch(() => null);
      if (fee) return new ReviewFee({ gasless: true, chain, baseFee: BigInt(fee.gasPrice) });
    }

    if (isTon(chain)) return (await this.ton.getWithdrawFee()) as ReviewFee;
    if (isCosmos(chain)) return (await this.cosmos().then((s) => s.getWithdrawFee(chain))) as ReviewFee;
    if (chain === Network.Solana) return (await this.solana().then((s) => s.getWithdrawFee())) as ReviewFee;
    if (chain === Network.Stellar) return (await this.stellar.getWithdrawFee()) as ReviewFee;
    return (await this.evm.getWithdrawFee(chain)) as ReviewFee;
  }

  async getDepositFee(options: { chain: number; token: string; amount: bigint; sender: string; intentAccount: string }): Promise<ReviewFee> {
    const { chain, token, amount, sender, intentAccount } = options;
    if (chain === Network.Hot) return new ReviewFee({ gasless: true, chain });
    if (chain === Network.Near) return new ReviewFee({ gasless: true, baseFee: NEAR_PER_GAS, gasLimit: 300n * TGAS, chain });
    if (chain === Network.Stellar) return (await this.stellar.getDepositFee(sender, token, amount, intentAccount)) as ReviewFee;
    if (isCosmos(chain)) return (await this.cosmos().then((s) => s.getDepositFee(chain, sender, token, amount, intentAccount))) as ReviewFee;
    if (chain === Network.Solana) return (await this.solana().then((s) => s.getDepositFee(token))) as ReviewFee;
    if (isTon(chain)) return (await this.ton.getDepositFee(token)) as ReviewFee;
    return (await this.evm.getDepositFee(chain, token, amount, sender)) as ReviewFee;
  }
}

export default HotBridge;
