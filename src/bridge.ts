import { baseDecode } from "@near-js/utils";
import { createAction } from "@here-wallet/core";
import { Action } from "near-api-js/lib/transaction";

import { Logger, TGAS, address2base, base2Address, INTENT_PREFIX, OMNI_HOT_V2, toOmni, toOmniIntent, encodeReceiver } from "./utils";
import { PendingDeposit, PendingWithdraw, TransferType } from "./types";
import { Network, Chains } from "./chains";
import { omniTokens } from "./tokens";
import OmniApi from "./api";

import { buildWithdrawIntentAction } from "./intents";
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

  constructor({
    logger,
    tonApiKey,
    executeNearTransaction,
  }: {
    logger?: Logger;
    tonApiKey?: string;
    executeNearTransaction: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
  }) {
    this.executeNearTransaction = executeNearTransaction;
    this.logger = logger;

    this.ton = new TonOmniService(this, tonApiKey);
    this.solana = new SolanaOmniService(this);
    this.stellar = new StellarService(this);
    this.evm = new EvmOmniService(this);
    this.near = new NearBridge(this);
  }

  get assets() {
    return Object.values(omniTokens).map((t) => Object.entries(t).map(([chain, { address }]) => toOmniIntent(+chain, address)));
  }

  async executeIntents(intents: any[]) {
    return await this.executeNearTransaction({
      receiverId: "intents.near",
      actions: [
        createAction({
          type: "FunctionCall",
          params: {
            methodName: "execute_intents",
            args: { signed: intents },
            gas: String(300n * TGAS),
            deposit: "0",
          },
        }),
      ],
    });
  }

  async getPendingWithdrawals(receiver: string) {
    const pending = new Set<PendingWithdraw>();
    const chains = new Set(Object.values(omniTokens).flatMap((t) => Object.keys(t).map((t) => +t)));

    const tasks = Array.from(chains).map(async (chain) => {
      const withdraw = await this.near.rpc.viewFunction({
        args: { receiver_id: receiver, chain_id: chain },
        methodName: "get_withdraw_by_receiver",
        contractId: OMNI_HOT_V2,
      });

      if (!withdraw) return;

      const isUsed = await this.isWithdrawUsed(chain, withdraw.nonce, withdraw.receiver_id);
      if (isUsed) return;

      pending.add({
        nonce: withdraw.nonce,
        chain: withdraw.chain_id,
        amount: withdraw.amount,
        timestamp: withdraw.created_ts * 1000,
        token: base2Address(withdraw.chain_id, withdraw.contract_id),
        receiver: withdraw.receiver_id,
        completed: false,
      });
    });

    await Promise.allSettled(tasks);
    return pending;
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
    if (Chains.get(chain).isEvm) return await this.evm.getTokenBalance(token, chain, address);
    throw `Unsupported chain address ${chain}`;
  }

  async getGroup(intentId: string, intentAccount: string) {
    const groups = await this.near.rpc.viewFunction({ contractId: "stable-swap.hot.tg", methodName: "get_groups" });
    const stables: Record<string, { group: string; decimal: number }> = {};
    groups.forEach((t: any) => (stables[t.contract_id] = { group: t.group_id, decimal: t.decimal }));

    const balances = await this.getIntentBalances(
      this.assets.flatMap((t) => t),
      intentAccount
    );

    const linked = Object.entries(stables)
      .filter(([_, symbol]) => symbol.group === stables[toOmni(intentId)]?.group)
      .map((t) => INTENT_PREFIX + t[0]);

    return linked.reduce((acc, id) => {
      if (BigInt(balances[id] || 0n) === 0n) return acc;
      return { ...acc, [id]: String(balances[id] || 0n) };
    }, {} as Record<string, string>);
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
    if (Chains.get(chain).isEvm) return await this.evm.isWithdrawUsed(chain, nonce);
    return false;
  }

  async buildWithdraw(nonce: string) {
    this.logger?.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer: TransferType = await this.near.rpc.viewFunction({
      contractId: OMNI_HOT_V2,
      methodName: "get_transfer",
      args: { nonce },
    });

    this.logger?.log(`Transfer: ${JSON.stringify(transfer, null, 2)}`);

    this.logger?.log(`Checking if nonce is used`);
    const isUsed = await this.isWithdrawUsed(transfer.chain_id, nonce, transfer.receiver_id).catch(() => false);
    if (isUsed) throw "Already claimed";

    this.logger?.log(`Depositing on ${Chains.get(transfer.chain_id).symbol}`);
    const token = base2Address(transfer.chain_id, transfer.contract_id);

    this.logger?.log("Signing withdraw");
    const signature = await OmniApi.shared.withdrawSign(nonce);

    return {
      chain: +transfer.chain_id,
      amount: BigInt(transfer.amount),
      receiver: transfer.receiver_id,
      signature,
      token,
      nonce,
    };
  }

  async finishDeposit(deposit: PendingDeposit) {
    this.logger?.log(`Checking if depos it is executed`);
    const isExecuted = await this.near.rpc.viewFunction({
      args: { nonce: deposit.nonce, chain_id: deposit.chain },
      contractId: OMNI_HOT_V2,
      methodName: "is_executed",
    });

    if (isExecuted) throw "Deposit already executed";

    this.logger?.log(`Signing deposit`);
    const signature = await OmniApi.shared.depositSign(
      deposit.chain,
      deposit.nonce,
      deposit.sender,
      deposit.receiver,
      address2base(deposit.chain, deposit.token),
      deposit.amount
    );

    const depositArgs = {
      account_id: "intents.near",
      msg: JSON.stringify({
        receiver_id: deposit.intentAccount,
        token_id: toOmni(deposit.chain, deposit.token),
        amount: deposit.amount,
      }),
    };

    const depositAction = createAction({
      type: "FunctionCall",
      params: {
        methodName: "mt_deposit_call",
        gas: String(80n * TGAS),
        deposit: "1",
        args: {
          nonce: deposit.nonce,
          chain_id: deposit.chain,
          contract_id: address2base(deposit.chain, deposit.token),
          deposit_call_args: depositArgs,
          amount: deposit.amount,
          signature,
        },
      },
    });

    try {
      this.logger?.log(`Calling deposit to omni and deposit to intents`);
      await this.executeNearTransaction({ actions: [depositAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      if (!e?.toString?.().includes("Nonce already used")) throw e;
    }
  }

  async checkWithdrawLocker(chain: number, receiver: string): Promise<Action[]> {
    const withdrawals = await this.near.rpc.viewFunction({
      args: { receiver_id: encodeReceiver(chain, receiver), chain_id: chain },
      methodName: "get_withdrawals_by_receiver",
      contractId: OMNI_HOT_V2,
    });

    const actions = await Promise.all(
      withdrawals.map(async (withdraw: any) => {
        const isUsed = await this.isWithdrawUsed(withdraw.chain_id, withdraw.nonce, receiver);
        if (!isUsed) return null;

        const signature = await OmniApi.shared.clearWithdrawSign(withdraw.nonce, Buffer.from(baseDecode(withdraw.receiver_id)));
        return {
          type: "FunctionCall",
          params: {
            deposit: "0",
            methodName: "clear_withdraw",
            args: { nonce: withdraw.nonce, signature },
            gas: String(80n * TGAS),
          },
        };
      })
    );

    return actions.filter((a) => a !== null).map((a) => createAction(a));
  }

  async estimateSwap(intentAccount: string, intentFrom: string, intentTo: string, amount: number) {
    const group = await this.getGroup(intentFrom, intentAccount);
    const { amountOut } = await OmniApi.shared.estimateSwap(intentAccount, group, intentTo, amount);
    return amountOut;
  }

  async swapToken(args: {
    intentFrom: string;
    intentTo: string;
    amount: number;
    intentAccount: string;
    signIntent: (intent: any) => Promise<string>;
  }) {
    this.logger?.log(`Swapping ${args.amount} ${args.intentFrom} to ${args.intentTo}`);

    this.logger?.log(`Get stable group`);
    const group = await this.getGroup(args.intentFrom, args.intentAccount);

    this.logger?.log(`Estimate swap`);
    const { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(args.intentAccount, group, args.intentTo, args.amount);

    this.logger?.log(`Signing intent`);
    const signed = await args.signIntent(quote);

    this.logger?.log(`Executing intents`);
    const { hash } = await this.executeIntents([signed, signed_quote]);
    return { hash, amountOut };
  }

  async withdrawToken(args: {
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    getIntentAccount: () => Promise<string>;
    signIntent: (intent: any) => Promise<any>;
  }) {
    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);
    const receiver = encodeReceiver(args.chain, args.receiver);

    // Check withdraw locker
    this.logger?.log(`Clear withdraw locker`);
    const ClearWithdrawActions = await this.checkWithdrawLocker(args.chain, args.receiver);
    if (ClearWithdrawActions?.length) await this.executeNearTransaction({ actions: ClearWithdrawActions, receiverId: OMNI_HOT_V2 });

    this.logger?.log(`Build withdraw intent`);
    const intentId = toOmniIntent(args.chain, args.token);
    const intentAccount = await args.getIntentAccount();
    const intent = buildWithdrawIntentAction(intentAccount, intentId, args.amount, receiver);

    this.logger?.log(`Sign withdraw intent ${intentId}`);
    const signedIntent = await args.signIntent(intent);

    this.logger?.log(`Push withdraw intent ${intentId}`);
    const tx = await this.executeIntents([signedIntent]);

    // Intent withdraw directry on NEAR for receiver
    if (args.chain === Network.Near) return;

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    this.logger?.log(`Depositing to ${Chains.get(args.chain).symbol}`);
    return await this.buildWithdraw(nonce);
  }
}

export default HotBridge;
