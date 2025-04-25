import { baseDecode } from "@near-js/utils";
import { Action } from "near-api-js/lib/transaction";
import chunk from "lodash/chunk";

import { Logger, TGAS, OMNI_HOT_V2, toOmniIntent, encodeReceiver, encodeTokenAddress, decodeTokenAddress, decodeReceiver } from "./utils";
import { PendingDeposit, PendingWithdraw } from "./types";
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
    evmRpc?: Record<number, string>;
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

    const tasks = withdrawals.map(async (withdraw: any) => {
      const isUsed = await this.isWithdrawUsed(chain, withdraw.nonce, withdraw.receiver_id);
      if (isUsed) return;

      return {
        nonce: withdraw.nonce,
        chain: withdraw.chain_id,
        amount: withdraw.amount,
        timestamp: withdraw.created_ts * 1000,
        token: decodeTokenAddress(withdraw.chain_id, withdraw.contract_id),
        receiver: withdraw.receiver_id,
        completed: false,
      };
    });

    const pending = await Promise.all(tasks);
    return pending.filter((p) => p !== undefined);
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
    const isUsed = await this.isWithdrawUsed(transfer.chain_id, nonce, transfer.receiver_id).catch(() => false);
    if (isUsed) throw "Already claimed";

    this.logger?.log(`Depositing on ${chains.get(transfer.chain_id)?.symbol}`);
    const token = decodeTokenAddress(transfer.chain_id, transfer.contract_id);

    this.logger?.log("Signing withdraw");
    const signature = await OmniApi.shared.withdrawSign(nonce);

    return {
      chain: +transfer.chain_id,
      amount: BigInt(transfer.amount),
      receiver: decodeReceiver(transfer.chain_id, transfer.receiver_id),
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
        if (!isUsed) throw "You have pending withdrawals, finish them first";

        const signature = await OmniApi.shared.clearWithdrawSign(withdraw.nonce, Buffer.from(baseDecode(withdraw.receiver_id)));
        return this.near.functionCall({
          methodName: "clear_withdraw",
          args: { nonce: withdraw.nonce, signature },
          gas: String(80n * TGAS),
          deposit: "0",
        });
      })
    );

    return actions.filter((a) => a !== null);
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

    if (args.chain !== Network.Near) {
      // Check withdraw locker
      this.logger?.log(`Clear withdraw locker`);
      const ClearWithdrawActions = await this.checkWithdrawLocker(args.chain, args.receiver);
      if (ClearWithdrawActions?.length) await this.executeNearTransaction({ actions: ClearWithdrawActions, receiverId: OMNI_HOT_V2 });
    }

    this.logger?.log(`Build withdraw intent`);
    const intentId = toOmniIntent(args.chain, args.token);
    const intentAccount = await args.getIntentAccount();

    const intent = await buildWithdrawIntentAction(intentAccount, intentId, args.amount, receiver);

    this.logger?.log(`Sign withdraw intent ${intentId}`);
    const signedIntent = await args.signIntent(intent);

    this.logger?.log(`Push withdraw intent ${intentId}`);
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
