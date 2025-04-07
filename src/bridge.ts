import { baseDecode } from "@near-js/utils";
import { HereCall } from "@here-wallet/core";

import {
  formatAmount,
  Logger,
  TGAS,
  wait,
  address2base,
  base2Address,
  INTENT_PREFIX,
  OMNI_HOT_V2,
  toOmni,
  toOmniIntent,
  encodeReceiver,
} from "./utils";

import { HotBridgeConfig, PendingDeposit, PendingWithdraw, TransferType } from "./types";
import { IntentsService, signIntentAction, withdrawIntentAction } from "./intents";
import { Network, Chains } from "./chains";
import { omniTokens } from "./tokens";
import OmniV2 from "./omni_v2";
import OmniApi from "./api";

import SolanaOmniService from "./bridge-solana";
import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonOmniService from "./bridge-ton";
import NearBridge from "./bridge-near";

class HotBridge {
  logger?: Logger;
  deposits: Record<string, PendingDeposit> = {};

  intents: IntentsService;
  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;
  stellar: StellarService;
  omniV2: OmniV2;

  constructor(readonly signers: HotBridgeConfig) {
    this.ton = new TonOmniService(this);
    this.solana = new SolanaOmniService(this);
    this.stellar = new StellarService(this);
    this.evm = new EvmOmniService(this);
    this.near = new NearBridge(this);

    this.intents = new IntentsService(this);
    this.omniV2 = new OmniV2(this);
  }

  get assets() {
    return Object.values(omniTokens).map((t) => Object.entries(t).map(([chain, { address }]) => toOmniIntent(+chain, address)));
  }

  async fetchPendingWithdrawals() {
    const pending = new Set<PendingWithdraw>();
    const chains = new Set(Object.values(omniTokens).flatMap((t) => Object.keys(t).map((t) => +t)));

    const tasks = Array.from(chains).map(async (chain) => {
      const withdraw = await this.near.viewFunction({
        args: { receiver_id: encodeReceiver(chain), chain_id: chain },
        methodName: "get_withdraw_by_receiver",
        contractId: OMNI_HOT_V2,
      });

      if (!withdraw || (await this.isNonceUsed(chain, withdraw.nonce, withdraw.receiver_id))) return;
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

  async fetchBalances(address?: string) {
    return await this.intents.getBalances(
      this.assets.flatMap((t) => t),
      address || this.near.address
    );
  }

  async getTokenBalance(chain: Network, token: string, address?: string) {
    address = address || (await this.getAddress(chain));
    if (chain === Network.Ton) return await this.ton.getTokenBalance(token, address);
    if (chain === Network.Near) return await this.near.getTokenBalance(token, address);
    if (chain === Network.Solana) return await this.solana.getTokenBalance(token, address);
    if (chain === Network.Stellar) return await this.stellar.getTokenBalance(token, address);
    if (Chains.get(chain).isEvm) return await this.evm.getTokenBalance(token, chain, address);
    throw `Unsupported chain address ${chain}`;
  }

  async getBalance(intentId: string, address?: string) {
    const balances = await this.fetchBalances(address);
    return balances[intentId] || 0n;
  }

  async getGroup(intentId: string) {
    const stables = await this.omniV2.getStableGroups();
    const balances = await this.fetchBalances();

    const linked = Object.entries(stables)
      .filter(([_, symbol]) => symbol.group === stables[toOmni(intentId)]?.group)
      .map((t) => INTENT_PREFIX + t[0]);

    return linked.reduce((acc, id) => {
      if (BigInt(balances[id] || 0n) === 0n) return acc;
      return { ...acc, [id]: String(balances[id] || 0n) };
    }, {} as Record<string, string>);
  }

  removePendingDeposit(deposit: PendingDeposit) {
    delete this.deposits[deposit.tx];
  }

  addPendingDeposit(deposit: PendingDeposit) {
    this.deposits[deposit.tx] = deposit;
    return deposit;
  }

  async getAddress(chain: Network) {
    if (chain === Network.Near) return this.signers.near?.getAddress();
    if (chain === Network.Solana) return this.signers.solana?.getAddress();
    if (chain === Network.Stellar) return this.signers.stellar?.getAddress();
    if (chain === Network.Ton) return this.signers.ton?.getAddress();
    if (Chains.get(chain).isEvm) return this.signers.evm?.getAddress();
    throw `Unsupported chain address ${chain}`;
  }

  async isDepositUsed(chain: number, nonce: string) {
    return await this.near.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT_V2,
    });
  }

  async isNonceUsed(chain: number, nonce: string, receiver: string) {
    if (chain === Network.Ton) return await this.ton.isNonceUsed(nonce, receiver);
    if (chain === Network.Solana) return await this.solana.isNonceUsed(nonce, receiver);
    if (chain === Network.Stellar) return await this.stellar.isNonceUsed(nonce, receiver);
    if (Chains.get(chain).isEvm) return await this.evm.isNonceUsed(chain, nonce, receiver);
    return false;
  }

  async getWithdrawFee(chain: number, receiver: string) {
    if (chain === Network.Hot || chain === Network.Near) return { need: 0n, canPerform: true, decimal: 24, amount: 0n, additional: 0n };
    if (chain === Network.Ton) return await this.ton.getWithdrawFee(receiver);
    if (chain === Network.Solana) return await this.solana.getWithdrawFee();
    if (chain === Network.Stellar) return await this.stellar.getWithdrawFee();
    if (Chains.get(chain).isEvm) return await this.evm.getWithdrawFee(chain);
    throw `Unsupported chain address ${chain}`;
  }

  async getDepositFee(chain: number, token: string) {
    if (chain === Network.Near || chain === Network.Hot)
      return { maxFee: 0n, need: 0n, isNotEnough: false, gasPrice: 0n, gasLimit: 0n, chain: chain };
    if (Chains.get(chain).isEvm) return this.evm.getDepositFee(chain, token);
    if (chain === Network.Solana) return this.solana.getDepositFee();
    if (chain === Network.Stellar) return this.stellar.getDepositFee();
    if (chain === Network.Ton) return this.ton.getDepositFee();
    throw "Unknown chain";
  }

  async finishWithdrawal(nonce: string) {
    this.logger?.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer: TransferType = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "get_transfer", args: { nonce } });
    this.logger?.log(`Transfer: ${JSON.stringify(transfer, null, 2)}`);

    this.logger?.log("Signing request");
    const signature = await OmniApi.shared.withdrawSign(nonce);
    this.logger?.log(`Signature: ${signature}`);

    this.logger?.log(`Checking if nonce is used`);
    const receiver = transfer.receiver_id;
    const isUsed = await this.isNonceUsed(transfer.chain_id, nonce, receiver).catch(() => false);
    if (isUsed) throw "Already claimed";

    this.logger?.log(`Depositing on ${Chains.get(transfer.chain_id).name}`);
    const token = base2Address(transfer.chain_id, transfer.contract_id);
    const withdraw = {
      chain: +transfer.chain_id,
      amount: BigInt(transfer.amount),
      receiver,
      signature,
      token,
      nonce,
    };

    if (withdraw.chain === Network.Ton) await this.ton.withdraw(withdraw);
    if (withdraw.chain === Network.Solana) await this.solana.withdraw(withdraw);
    if (withdraw.chain === Network.Stellar) await this.stellar.withdraw(withdraw);
    if (Chains.get(withdraw.chain).isEvm) await this.evm.withdraw(withdraw);
  }

  async finishDeposit(deposit: PendingDeposit): Promise<string> {
    // PARSE DEPOSIT NONCE
    this.logger?.log(`Parsing deposit nonce if needed`);
    if (Chains.get(deposit.chain).isEvm) deposit = await this.evm.parseDeposit(deposit.chain, deposit.tx);
    if (deposit.chain === Network.Solana) deposit = await this.solana.parseDeposit(deposit.tx);
    if (deposit.chain === Network.Stellar) deposit = await this.stellar.parseDeposit(deposit);
    if (deposit.chain === Network.Ton) deposit = await this.ton.parseDeposit(deposit);
    if (deposit == null) throw "Deposit nonce failed";

    this.logger?.log(`Checking if depos it is executed`);
    const args = { nonce: deposit.nonce, chain_id: deposit.chain };
    const isExecuted = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "is_executed", args });

    if (isExecuted) {
      // CLEAR DEPOSIT PENDING
      this.logger?.log(`Clearing deposit nonce if needed`);
      if (deposit.chain === Network.Stellar) this.stellar.clearDepositNonceIfNeeded(deposit);
      if (deposit.chain === Network.Solana) this.solana.clearDepositNonceIfNeeded(deposit);
      if (deposit.chain === Network.Ton) this.ton.clearDepositNonceIfNeeded(deposit);
      if (Chains.get(deposit.chain).isEvm) this.evm.clearDepositNonceIfNeeded(deposit);
      this.removePendingDeposit(deposit);
      this.fetchBalances();
      return "x";
    }

    const depositSign = async (attemps = 0) => {
      try {
        return await OmniApi.shared.depositSign(
          deposit.chain,
          deposit.nonce,
          deposit.sender,
          deposit.receiver,
          address2base(deposit.chain, deposit.token),
          deposit.amount
        );
      } catch (e) {
        if (attemps > 5) throw e;
        await wait(3000);
        this.logger?.log(`Signing deposit failed, retrying`);
        return await depositSign(attemps + 1);
      }
    };

    this.logger?.log(`Signing deposit`);
    const signature = await depositSign();
    let hash: string | null = null;

    const depositAction: HereCall["actions"][0] = {
      type: "FunctionCall",
      params: {
        methodName: "deposit",
        gas: String(80n * TGAS),
        deposit: "0",
        args: {
          nonce: deposit.nonce,
          chain_id: deposit.chain,
          contract_id: address2base(deposit.chain, deposit.token),
          near_account_id: this.near.address,
          receiver_id: deposit.receiver,
          amount: deposit.amount,
          signature,
        },
      },
    };

    const depositToIntentsAction: HereCall["actions"][0] = {
      type: "FunctionCall",
      params: {
        methodName: "mt_transfer_call",
        gas: String(80n * TGAS),
        deposit: "1",
        args: {
          receiver_id: "intents.near",
          token_id: toOmni(deposit.chain, deposit.token),
          amount: deposit.amount,
          msg: "",
        },
      },
    };

    try {
      this.logger?.log(`Calling deposit to omni and deposit to intents`);
      hash = await this.signers.near!.sendTransaction({ actions: [depositAction, depositToIntentsAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      console.log({ error: e?.toString?.() });
      if (!e?.toString?.().includes("Nonce already used")) throw e;
    }

    // CLEAR DEPOSIT PENDING
    this.logger?.log(`Clearing deposit nonce if needed`);
    if (deposit.chain === Network.Ton) this.ton.clearDepositNonceIfNeeded(deposit);
    if (deposit.chain === Network.Solana) this.solana.clearDepositNonceIfNeeded(deposit);
    if (Chains.get(deposit.chain).isEvm) this.evm.clearDepositNonceIfNeeded(deposit);

    this.removePendingDeposit(deposit);
    this.fetchBalances();
    return hash!;
  }

  async depositToken(chain: Network, address: string, amount: bigint, receiver: string) {
    this.logger?.log(`Call depositToken ${amount} ${chain} ${address}`);

    if (chain === Network.Near) {
      address = address === "native" ? "wrap.near" : address;
      this.logger?.log(`Depositing to NEAR ${address}`);

      this.logger?.log(`Check if token ${address} is not registered`);
      const call = await this.near.getRegisterTokenTrx(address, OMNI_HOT_V2);

      if (call) {
        this.logger?.log(`Registering token ${address}`);
        await this.signers.near!.sendTransaction(call);
      }

      const depositWnear: any[] = [];
      if (address === "wrap.near") {
        this.logger?.log(`Wrapping native NEAR`);
        depositWnear.push(await this.near.getWrapNearDepositAction(BigInt(amount), receiver));
      }

      this.logger?.log(`Depositing token to HOT Bridge`);
      await this.signers.near!.sendTransaction({
        receiverId: address,
        actions: [
          ...depositWnear,
          {
            type: "FunctionCall",
            params: {
              args: { amount: BigInt(amount), receiver_id: OMNI_HOT_V2, msg: receiver },
              methodName: "ft_transfer_call",
              gas: String(80n * TGAS),
              deposit: "1",
            },
          },
        ],
      });

      this.logger?.log(`Depositing token to intents`);
      const tx = await this.signers.near!.sendTransaction({
        receiverId: OMNI_HOT_V2,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "mt_transfer_call",
              gas: String(80n * TGAS),
              deposit: "1",
              args: {
                receiver_id: "intents.near",
                token_id: toOmni(chain, address),
                amount: BigInt(amount),
                msg: "",
              },
            },
          },
        ],
      });

      return { receiver: address, hash: tx };
    }

    let deposit: PendingDeposit | null = null;

    // EVM DEPOSIT
    if (Chains.get(chain).isEvm) {
      this.logger?.log(`Withdrawing from ${Chains.get(chain).name}`);
      deposit = await this.evm.deposit(chain, address, amount, receiver);
    }

    // Stellar DEPOSIT
    if (chain === Network.Stellar) {
      this.logger?.log(`Withdrawing from Stellar`);
      deposit = await this.stellar.deposit(address, amount, receiver);
    }

    // SOLANA DEPOSIT
    if (chain === Network.Solana) {
      this.logger?.log(`Withdrawing from Solana`);
      deposit = await this.solana.deposit(address, amount, receiver);
    }

    // TON DEPOSIT
    if (chain === Network.Ton) {
      this.logger?.log(`Withdrawing from TON`);
      deposit = await this.ton.deposit(address, amount, receiver);
    }

    this.logger?.log(`Deposit: ${JSON.stringify(deposit, null, 2)}`);
    if (deposit == null) throw "Unsupported chain";

    this.logger?.log(`Receiving on HOT Omni`);
    const hash = await this.finishDeposit(deposit);
    return { receiver: OMNI_HOT_V2, hash };
  }

  async checkWithdrawLocker(chain: number, receiver: string): Promise<HereCall["actions"][0] | null> {
    const withdraw = await this.near.viewFunction({
      contractId: OMNI_HOT_V2,
      methodName: "get_withdraw_by_receiver",
      args: {
        receiver_id: encodeReceiver(chain, receiver),
        chain_id: chain,
      },
    });

    if (withdraw == null) return null;
    const isUsed = await this.isNonceUsed(withdraw.chain_id, withdraw.nonce, receiver);
    if (!isUsed) throw "Complete previous withdraw before making new";

    if (withdraw.sender_id === this.near.address) {
      return {
        type: "FunctionCall",
        params: {
          deposit: "0",
          methodName: "clear_my_withdraw",
          gas: String(80n * TGAS),
          args: {
            chain_id: withdraw.chain_id,
            receiver_id: withdraw.receiver_id,
            last_nonce: withdraw.nonce,
          },
        },
      };
    }

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
  }

  async estimateSwap(intentFrom: string, intentTo: string, amount: number) {
    const group = await this.getGroup(intentFrom);
    group[intentFrom] = String(10n ** 24n); // For emulation

    const { amountOut } = await OmniApi.shared.estimateSwap(this.near.address, group, intentTo, amount);
    return amountOut;
  }

  async swapToken(intentFrom: string, intentTo: string, amount: number, logger = new Logger()) {
    logger.log(`Swapping ${amount} ${intentFrom} to ${intentTo}`);

    logger.log(`Register intents`);
    await this.intents.registerIntents();

    logger.log(`Get stable group`);
    const group = await this.getGroup(intentFrom);

    logger.log(`Estimate swap`);
    const { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(this.near.address, group, intentTo, amount);

    logger.log(`Signing intent`);
    const signed = await signIntentAction(this.signers.near, quote);

    logger.log(`Executing intents`);
    const tx = await this.signers.near!.sendTransaction({
      receiverId: "intents.near",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "execute_intents",
            args: { signed: [signed, signed_quote] },
            gas: String(300n * TGAS),
            deposit: "0",
          },
        },
      ],
    });

    return { receiver: "intents.near", hash: tx, amountOut };
  }

  async autoWithdraw(chain: Network, nonce: string) {
    const gasPrice = await this.evm.getGasPrice(chain);
    await this.signers.near!.sendTransaction({
      receiverId: "intents.near",
      actions: [
        {
          type: "FunctionCall",
          params: {
            deposit: "1",
            gas: String(40n * TGAS),
            methodName: "mt_transfer_call",

            args: {
              receiver_id: "gas.hot.tg",
              token_id: toOmniIntent(chain, "native"),
              msg: JSON.stringify({ withdrawal_nonce: nonce, chain_id: chain, standard: "bridge" }),
              amount: String(gasPrice * 300_000n),
            },
          },
        },
      ],
    });
  }

  async withdrawToken(chain: Network, address: string, amount: bigint, _receiver: string) {
    this.logger?.log(`Withdrawing ${amount} ${chain} ${address}`);
    const receiver = encodeReceiver(chain, _receiver);

    if (chain === Network.Ton) {
      this.logger?.log("Creating TON bridge account");
      await this.ton.createUserIfNeeded(_receiver);
    }

    // Check withdraw locker
    this.logger?.log(`Clear withdraw locker`);
    const ClearWithdrawAction = await this.checkWithdrawLocker(chain, receiver);
    if (ClearWithdrawAction) await this.signers.near!.sendTransaction({ actions: [ClearWithdrawAction], receiverId: OMNI_HOT_V2 });

    // Register intents
    this.logger?.log(`Register intents`);
    await this.intents.registerIntents();

    this.logger?.log(`Fetch balances`);
    const balances = await this.fetchBalances();
    const intentId = toOmniIntent(chain, address);
    this.logger?.log(`Withdraw intent ${intentId}`);

    if (balances[intentId] >= amount) {
      this.logger?.log(`Just withdrawing own liquidity`);
      const tx = await this.intents.withdrawIntent(intentId, amount, receiver, this.logger);
      if (chain === Network.Near) return;

      this.logger?.log(`Parsing withdrawal nonce`);
      const nonce = await this.near.parseWithdrawalNonce(tx, receiver);

      this.logger?.log(`Depositing to ${Chains.get(chain).name}`);
      await this.finishWithdrawal(nonce);
      return;
    }

    this.logger?.log(`Fetching stable group`);
    const group = await this.getGroup(intentId);
    const decimals = omniTokens[intentId]?.[chain]?.decimal;
    if (decimals == null) throw `Unsupported token ${intentId}`;

    // amount to swap minus balance in target intent token
    const amountInFloat = formatAmount(amount - (balances[intentId] || 0n), decimals);
    group[intentId] = "0"; // Dont swap target intent token

    this.logger?.log(`Estimating swap`);
    let { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(this.near.address, group, intentId, amountInFloat);

    this.logger?.log(`Signing intent for swap with amount ${amountOut}`);
    const signed = await signIntentAction(this.signers.near, quote);

    amountOut += balances[intentId] || 0n;
    this.logger?.log(`Withdrawing intent with amount ${amountOut}`);
    const withdraw = await withdrawIntentAction(this.signers.near, intentId, amountOut, receiver);

    this.logger?.log(`Executing intents`);
    const tx = await this.signers.near!.sendTransaction({
      receiverId: "intents.near",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "execute_intents",
            args: { signed: [signed, signed_quote, withdraw] },
            gas: String(300n * TGAS),
            deposit: "0",
          },
        },
      ],
    });

    if (chain === Network.Near) return;

    this.logger?.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx, receiver);

    this.logger?.log(`Depositing to ${Chains.get(chain).name}`);
    await this.finishWithdrawal(nonce);
  }
}

export default HotBridge;
