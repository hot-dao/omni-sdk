import { Address as stellarAddress } from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import { HereCall } from "@here-wallet/core";
import { getBytes, sha256 } from "ethers";
import { Address } from "@ton/core";

import { formatAmount, Logger, TGAS, wait, address2base, base2Address, INTENT_PREFIX, OMNI_HOT_V2, toOmni, toOmniIntent } from "./utils";
import { IntentsService, signIntentAction, withdrawIntentAction } from "./intents";
import { PendingDeposit, PendingWithdraw, TransferType } from "./types";
import { Network, Chains } from "./chains";
import { omniTokens } from "./tokens";
import OmniV2 from "./omni_v2";
import OmniApi from "./api";

import { bigintToBuffer, generateUserId } from "./bridge-ton/constants";
import SolanaOmniService from "./bridge-solana";
import StellarService from "./bridge-stellar";
import EvmOmniService from "./bridge-evm";
import TonOmniService from "./bridge-ton";

import NearSigner from "./signers/NearSigner";
import EvmSigner from "./signers/EvmSigner";
import SolanaSigner from "./signers/SolanaSigner";
import StellarSigner from "./signers/StellarSigner";
import TonSigner from "./signers/TonSigner";

class OmniService {
  deposits: Record<string, PendingDeposit> = {};

  intents: IntentsService;
  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  stellar: StellarService;
  omniV2: OmniV2;

  constructor(readonly user: { near: NearSigner; evm?: EvmSigner; solana?: SolanaSigner; stellar?: StellarSigner; ton?: TonSigner }) {
    this.ton = new TonOmniService(this);
    this.solana = new SolanaOmniService(this);
    this.stellar = new StellarService(this);
    this.evm = new EvmOmniService(this);

    this.intents = new IntentsService(this);
    this.omniV2 = new OmniV2(this);
  }

  get assets() {
    return Object.values(omniTokens).map((t) => Object.entries(t).map(([chain, { address }]) => toOmniIntent(+chain, address)));
  }

  get near() {
    return this.user.near;
  }

  async fetchPendingWithdrawals() {
    const pending = new Set<PendingWithdraw>();
    const chains = new Set(Object.values(omniTokens).flatMap((t) => Object.keys(t).map((t) => +t)));
    const tasks = Array.from(chains).map(async (chain) => {
      const withdraw = await this.near.viewFunction({
        contractId: OMNI_HOT_V2,
        methodName: "get_withdraw_by_receiver",
        args: {
          receiver_id: this.getReceiverRaw(chain),
          chain_id: chain,
        },
      });

      if (!withdraw || (await this.isNonceUsed(chain, withdraw.nonce))) return;
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

  async fetchBalances() {
    return await this.intents.getBalances(
      this.assets.flatMap((t) => t),
      this.near!.accountId
    );
  }

  async getBalance(intentId: string) {
    const balances = await this.fetchBalances();
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

  getReceiverRaw(chain: Network) {
    if (chain === Network.Near) return baseEncode(getBytes(sha256(Buffer.from(this.near.accountId, "utf8"))));

    if (chain === Network.Solana) {
      if (this.user.solana == null) throw "Connect Solana";
      return this.user.solana.publicKey.toBase58();
    }

    if (chain === Network.Ton) {
      if (this.user.ton == null) throw "Connect TON";
      const id = generateUserId(Address.parse(this.user.ton.address), 0n);
      return baseEncode(bigintToBuffer(id, 32));
    }

    if (chain === Network.Stellar) {
      if (this.user.stellar == null) throw "Connect Stellar";
      return baseEncode(stellarAddress.fromString(this.user.stellar.address).toScVal().toXDR());
    }

    if (Chains.get(chain).isEvm) {
      if (this.user.evm == null) throw "Connect EVM";
      return baseEncode(getBytes(this.user.evm.address));
    }

    throw `Unsupported chain address ${chain}`;
  }

  async isDepositUsed(chain: number, nonce: string) {
    return await this.near.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT_V2,
    });
  }

  async isNonceUsed(chain: number, nonce: string) {
    if (chain === Network.Ton) return await this.ton.isNonceUsed(nonce);
    if (chain === Network.Solana) return await this.solana.isNonceUsed(nonce);
    if (chain === Network.Stellar) return await this.stellar.isNonceUsed(nonce);
    if (Chains.get(chain).isEvm) return await this.evm.isNonceUsed(chain, nonce);
    return false;
  }

  async getWithdrawFee(chain: number, token?: string) {
    if (chain === Network.Hot || chain === Network.Near) return { need: 0n, canPerform: true, decimal: 24, amount: 0n, additional: 0n };
    if (chain === Network.Ton) return await this.ton.getWithdrawFee();
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

  async finishWithdrawal(nonce: string, pending = new Logger()) {
    const transfer: TransferType = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "get_transfer", args: { nonce } });

    pending?.log("Signing request");
    const signature = await OmniApi.shared.withdrawSign(nonce);
    const isUsed = await this.isNonceUsed(transfer.chain_id, nonce).catch(() => false);
    if (isUsed) throw "Already claimed";

    pending?.log(`Depositing on ${Chains.get(transfer.chain_id).name}`);
    const token = base2Address(transfer.chain_id, transfer.contract_id);
    const withdraw = { chain: +transfer.chain_id, nonce, signature, token, amount: BigInt(transfer.amount) };

    if (withdraw.chain === Network.Ton) await this.ton.withdraw(withdraw);
    if (withdraw.chain === Network.Solana) await this.solana.withdraw(withdraw);
    if (withdraw.chain === Network.Stellar) await this.stellar.withdraw(withdraw);
    if (Chains.get(withdraw.chain).isEvm) await this.evm.withdraw(withdraw);
    await this.fetchBalances();
  }

  async finishDeposit(deposit: PendingDeposit): Promise<string> {
    // PARSE DEPOSIT NONCE
    if (Chains.get(deposit.chain).isEvm) deposit = await this.evm.parseDeposit(deposit.chain, deposit.tx);
    if (deposit.chain === Network.Solana) deposit = await this.solana.parseDeposit(deposit.tx);
    if (deposit.chain === Network.Stellar) deposit = await this.stellar.parseDeposit(deposit);
    if (deposit.chain === Network.Ton) deposit = await this.ton.parseDeposit(deposit);
    if (deposit == null) throw "Deposit nonce failed";

    const args = { nonce: deposit.nonce, chain_id: deposit.chain };
    const isExecuted = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "is_executed", args });

    if (isExecuted) {
      // CLEAR DEPOSIT PENDING
      if (deposit.chain === Network.Stellar) this.stellar.clearDepositNonceIfNeeded(deposit);
      if (deposit.chain === Network.Solana) this.solana.clearDepositNonceIfNeeded(deposit);
      if (deposit.chain === Network.Ton) this.ton.clearDepositNonceIfNeeded(deposit);
      if (Chains.get(deposit.chain).isEvm) this.evm.clearDepositNonceIfNeeded(deposit);
      this.removePendingDeposit(deposit);
      this.fetchBalances();
      return "x";
    }

    const receiver = this.getReceiverRaw(deposit.chain);

    const depositSign = async (attemps = 0) => {
      try {
        return await OmniApi.shared.depositSign(
          deposit.chain,
          deposit.nonce,
          receiver,
          deposit.receiver,
          address2base(deposit.chain, deposit.token),
          deposit.amount
        );
      } catch (e) {
        if (attemps > 5) throw e;
        await wait(3000);
        return await depositSign(attemps + 1);
      }
    };

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
          near_account_id: this.near.accountId,
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
      hash = await this.near.callTransaction({ actions: [depositAction, depositToIntentsAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      console.log({ error: e?.toString?.() });
      if (!e?.toString?.().includes("Nonce already used")) throw e;
    }

    // CLEAR DEPOSIT PENDING
    if (deposit.chain === Network.Ton) this.ton.clearDepositNonceIfNeeded(deposit);
    if (deposit.chain === Network.Solana) this.solana.clearDepositNonceIfNeeded(deposit);
    if (Chains.get(deposit.chain).isEvm) this.evm.clearDepositNonceIfNeeded(deposit);

    this.removePendingDeposit(deposit);
    this.fetchBalances();
    return hash!;
  }

  async depositToken(chain: Network, address: string, amount: bigint, to?: string, logger = new Logger()) {
    if (chain === Network.Near) {
      logger.log(`Depositing to NEAR`);
      address = address === "native" ? "wrap.near" : address;

      const call = await this.near.getRegisterTokenTrx(address, OMNI_HOT_V2);
      if (call) await this.near.callTransaction(call);

      const depositWnear: any[] = address === "wrap.near" ? await this.near.getWrapNearDepositAction(BigInt(amount)) : [];
      await this.near.callTransaction({
        receiverId: address,
        actions: [
          ...depositWnear,
          {
            type: "FunctionCall",
            params: {
              args: { amount: BigInt(amount), receiver_id: OMNI_HOT_V2, msg: this.near.accountId },
              methodName: "ft_transfer_call",
              gas: String(80n * TGAS),
              deposit: "1",
            },
          },
        ],
      });

      const tx = await this.near.callTransaction({
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
      logger.log(`Withdrawing from ${Chains.get(chain).name}`);
      deposit = await this.evm.deposit(chain, address, amount, to);
    }

    // Stellar DEPOSIT
    if (chain === Network.Stellar) {
      logger.log(`Withdrawing from Stellar`);
      deposit = await this.stellar.deposit(address, amount, to);
    }

    // SOLANA DEPOSIT
    if (chain === Network.Solana) {
      logger.log(`Withdrawing from Solana`);
      deposit = await this.solana.deposit(address, amount, to);
    }

    // TON DEPOSIT
    if (chain === Network.Ton) {
      logger.log(`Withdrawing from TON`);
      deposit = await this.ton.deposit(address, amount, to);
    }

    if (deposit == null) throw "Unsupported chain";

    logger.log(`Receiving on HOT Omni`);
    const hash = await this.finishDeposit(deposit);
    return { receiver: OMNI_HOT_V2, hash };
  }

  async checkWithdrawLocker(chain: number): Promise<HereCall["actions"][0] | null> {
    const withdraw = await this.near.viewFunction({
      contractId: OMNI_HOT_V2,
      methodName: "get_withdraw_by_receiver",
      args: {
        receiver_id: this.getReceiverRaw(chain),
        chain_id: chain,
      },
    });

    if (withdraw == null) return null;
    const isUsed = await this.isNonceUsed(withdraw.chain_id, withdraw.nonce);
    if (!isUsed) throw "Complete previous withdraw before making new";

    if (withdraw.sender_id === this.near.accountId) {
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

    const { amountOut } = await OmniApi.shared.estimateSwap(this.near.accountId, group, intentTo, amount);
    return amountOut;
  }

  async swapToken(intentFrom: string, intentTo: string, amount: number) {
    await this.intents.registerIntents();

    const group = await this.getGroup(intentFrom);
    const { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(this.near.accountId, group, intentTo, amount);

    const signed = await signIntentAction(this.near, quote);
    const tx = await this.near.callTransaction({
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
    await this.near.callTransaction({
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

  async withdrawToken(chain: Network, address: string, amount: bigint, logger = new Logger()) {
    if (chain === Network.Ton) {
      logger.log("Creating TON bridge account");
      await this.ton.createUserIfNeeded();
    }

    // Check withdraw locker
    logger.log(`Clear withdraw locker`);
    const ClearWithdrawAction = await this.checkWithdrawLocker(chain);
    if (ClearWithdrawAction) await this.near.callTransaction({ actions: [ClearWithdrawAction], receiverId: OMNI_HOT_V2 });

    // Register intents
    logger.log(`Register intents`);
    await this.intents.registerIntents();

    const balances = await this.fetchBalances();
    const intentId = toOmniIntent(chain, address);

    if (balances[intentId] >= amount) {
      const receiver = chain === Network.Near ? this.near.accountId : this.getReceiverRaw(chain);
      const tx = await this.intents.withdrawIntent(intentId, amount, receiver);
      if (chain === Network.Near) return;

      const nonce = await this.parseWithdrawalNonce(tx);
      logger.log(`Depositing to ${Chains.get(chain).name}`);
      await this.finishWithdrawal(nonce);
      return;
    }

    const group = await this.getGroup(intentId);
    const decimals = omniTokens[intentId]?.[chain]?.decimal;
    if (decimals == null) throw `Unsupported token ${intentId}`;

    // amount to swap minus balance in target intent token
    const amountInFloat = formatAmount(amount - (balances[intentId] || 0n), decimals);
    group[intentId] = "0"; // Dont swap target intent token

    let { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(this.near.accountId, group, intentId, amountInFloat);
    const signed = await signIntentAction(this.near, quote);

    amountOut += balances[intentId] || 0n;
    const receiver = chain === Network.Near ? this.near.accountId : this.getReceiverRaw(chain);
    const withdraw = await withdrawIntentAction(this.near, intentId, amountOut, receiver);

    const tx = await this.near.callTransaction({
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

    const nonce = await this.parseWithdrawalNonce(tx);
    logger.log(`Depositing to ${Chains.get(chain).name}`);
    await this.finishWithdrawal(nonce);
  }

  async parseWithdrawalNonce(tx: string) {
    const receipt = await this.near.connection.provider.txStatusReceipts(tx, this.near.accountId, "EXECUTED_OPTIMISTIC");

    const transfer = (() => {
      for (let item of receipt.receipts_outcome) {
        for (let log of item.outcome.logs) {
          const nonce = `${log}`.match(/"memo":"(\d+)"/)?.[1];
          if (nonce) return { nonce };
        }
      }
    })();

    if (transfer == null) throw `Nonce not found, contact support please`;
    return transfer.nonce;
  }
}

export default OmniService;
