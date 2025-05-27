import { baseDecode } from "@near-js/utils";
import { Action } from "near-api-js/lib/transaction";
import chunk from "lodash/chunk";

import { Logger, TGAS, OMNI_HOT_V2, toOmniIntent, encodeReceiver, encodeTokenAddress, decodeTokenAddress, decodeReceiver } from "./utils";
import { PendingDepositWithIntent, PendingWithdraw } from "./types";
import { Network, chains } from "./chains";
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
    evmRpc,
    solanaRpc,
    executeNearTransaction,
  }: {
    logger?: Logger;
    tonApiKey?: string;
    evmRpc?: Record<number, string[]>;
    solanaRpc?: string[];
    executeNearTransaction: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
  }) {
    this.executeNearTransaction = executeNearTransaction;
    this.logger = logger;

    this.ton = new TonOmniService(this, tonApiKey);
    this.evm = new EvmOmniService(this, evmRpc);
    this.solana = new SolanaOmniService(this, solanaRpc);
    this.stellar = new StellarService(this);
    this.near = new NearBridge(this);
  }

  async executeIntents(intents: any[]) {
    return await this.executeNearTransaction({
      receiverId: "intents.near",
      actions: [
        this.near.functionCall({
          methodName: "execute_intents",
          args: { signed: intents },
          gas: String(300n * TGAS),
          deposit: "0",
        }),
      ],
    });
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

  async buildWithdrawIntent(args: { chain: Network; token: string; amount: bigint; receiver: string; intentAccount: string }) {
    this.logger?.log(`Build withdraw intent`);
    const token = toOmniIntent(args.chain, args.token);
    const receiver = encodeReceiver(args.chain, args.receiver);
    return await buildWithdrawIntentAction(args.intentAccount, token, args.amount, receiver);
  }

  async withdrawToken(args: {
    chain: Network;
    token: string;
    amount: bigint;
    receiver: string;
    intentAccount: string;
    signIntent: (intent: any) => Promise<any>;
  }) {
    this.logger?.log(`Withdrawing ${args.amount} ${args.chain} ${args.token}`);

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
    const signedIntent = await args.signIntent(intent);

    this.logger?.log(`Push withdraw intent`);
    const tx = await this.executeIntents([signedIntent]);

    // Intent withdraw directry on NEAR for receiver
    if (args.chain === Network.Near) return;

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx.hash, tx.sender);

    this.logger?.log(`Depositing to ${args.chain}`);
    return await this.buildWithdraw(nonce);
  }
}

export default HotBridge;
