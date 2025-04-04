import { Address as stellarAddress } from "@stellar/stellar-sdk";
import { baseDecode, baseEncode } from "@near-js/utils";
import { HereCall } from "@here-wallet/core";
import { getBytes, sha256 } from "ethers";
import { Address } from "@ton/core";

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
  getOmniAddressHex,
} from "./utils";

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
import NearBridge from "./bridge-near";

class OmniService {
  deposits: Record<string, PendingDeposit> = {};

  intents: IntentsService;
  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;
  near: NearBridge;
  stellar: StellarService;
  omniV2: OmniV2;

  constructor(readonly signers: { near: NearSigner; evm?: EvmSigner; solana?: SolanaSigner; stellar?: StellarSigner; ton?: TonSigner }) {
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

  get omniAddressHex() {
    return getOmniAddressHex(this.near.address);
  }

  async fetchPendingWithdrawals() {
    const pending = new Set<PendingWithdraw>();
    const chains = new Set(Object.values(omniTokens).flatMap((t) => Object.keys(t).map((t) => +t)));

    const tasks = Array.from(chains).map(async (chain) => {
      const withdraw = await this.near.viewFunction({
        args: { receiver_id: this.getReceiverRaw(chain), chain_id: chain },
        methodName: "get_withdraw_by_receiver",
        contractId: OMNI_HOT_V2,
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

  async fetchBalances(address?: string) {
    return await this.intents.getBalances(
      this.assets.flatMap((t) => t),
      address || this.near.address
    );
  }

  async getTokenBalance(chain: Network, token: string, address?: string) {
    if (chain === Network.Ton) return await this.ton.getTokenBalance(token, address || this.signers.ton?.address);
    if (chain === Network.Near) return await this.near.getTokenBalance(token, address || this.signers.near.accountId);
    if (chain === Network.Solana) return await this.solana.getTokenBalance(token, address || this.signers.solana?.address);
    if (chain === Network.Stellar) return await this.stellar.getTokenBalance(token, address || this.signers.stellar?.address);
    if (Chains.get(chain).isEvm) return await this.evm.getTokenBalance(token, chain, address || this.signers.evm?.address);
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

  getAddress(chain: Network) {
    if (chain === Network.Near) return this.signers.near.accountId;
    if (chain === Network.Solana) return this.signers.solana?.address;
    if (chain === Network.Stellar) return this.signers.stellar?.address;
    if (chain === Network.Ton) return this.signers.ton?.address;
    if (Chains.get(chain).isEvm) return this.signers.evm?.address;
    throw `Unsupported chain address ${chain}`;
  }

  getReceiverRaw(chain: Network) {
    if (chain === Network.Solana) return this.signers.solana!.address;
    if (Chains.get(chain).isEvm) return baseEncode(getBytes(this.signers.evm!.address));
    if (chain === Network.Near) return baseEncode(getBytes(sha256(Buffer.from(this.signers.near.accountId, "utf8"))));
    if (chain === Network.Stellar) return baseEncode(stellarAddress.fromString(this.signers.stellar!.address).toScVal().toXDR());
    if (chain === Network.Ton) {
      const id = generateUserId(Address.parse(this.signers.ton!.address), 0n);
      return baseEncode(bigintToBuffer(id, 32));
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

  async finishWithdrawal(nonce: string, logger = new Logger()) {
    logger.log(`Getting withdrawal by nonce ${nonce}`);
    const transfer: TransferType = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "get_transfer", args: { nonce } });
    logger.log(`Transfer: ${JSON.stringify(transfer, null, 2)}`);

    logger.log("Signing request");
    const signature = await OmniApi.shared.withdrawSign(nonce);
    logger.log(`Signature: ${signature}`);

    logger.log(`Checking if nonce is used`);
    const isUsed = await this.isNonceUsed(transfer.chain_id, nonce).catch(() => false);
    if (isUsed) throw "Already claimed";

    logger.log(`Depositing on ${Chains.get(transfer.chain_id).name}`);
    const token = base2Address(transfer.chain_id, transfer.contract_id);
    const withdraw = { chain: +transfer.chain_id, nonce, signature, token, amount: BigInt(transfer.amount) };

    if (withdraw.chain === Network.Ton) await this.ton.withdraw(withdraw);
    if (withdraw.chain === Network.Solana) await this.solana.withdraw(withdraw);
    if (withdraw.chain === Network.Stellar) await this.stellar.withdraw(withdraw);
    if (Chains.get(withdraw.chain).isEvm) await this.evm.withdraw(withdraw, logger);
  }

  async finishDeposit(deposit: PendingDeposit, logger?: Logger): Promise<string> {
    // PARSE DEPOSIT NONCE
    logger?.log(`Parsing deposit nonce if needed`);
    if (Chains.get(deposit.chain).isEvm) deposit = await this.evm.parseDeposit(deposit.chain, deposit.tx);
    if (deposit.chain === Network.Solana) deposit = await this.solana.parseDeposit(deposit.tx);
    if (deposit.chain === Network.Stellar) deposit = await this.stellar.parseDeposit(deposit);
    if (deposit.chain === Network.Ton) deposit = await this.ton.parseDeposit(deposit);
    if (deposit == null) throw "Deposit nonce failed";

    logger?.log(`Checking if deposit is executed`);
    const args = { nonce: deposit.nonce, chain_id: deposit.chain };
    const isExecuted = await this.near.viewFunction({ contractId: OMNI_HOT_V2, methodName: "is_executed", args });

    if (isExecuted) {
      // CLEAR DEPOSIT PENDING
      logger?.log(`Clearing deposit nonce if needed`);
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
        logger?.log(`Signing deposit failed, retrying`);
        return await depositSign(attemps + 1);
      }
    };

    logger?.log(`Signing deposit`);
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
      logger?.log(`Calling deposit to omni and deposit to intents`);
      hash = await this.near.callTransaction({ actions: [depositAction, depositToIntentsAction], receiverId: OMNI_HOT_V2 });
    } catch (e) {
      console.log({ error: e?.toString?.() });
      if (!e?.toString?.().includes("Nonce already used")) throw e;
    }

    // CLEAR DEPOSIT PENDING
    logger?.log(`Clearing deposit nonce if needed`);
    if (deposit.chain === Network.Ton) this.ton.clearDepositNonceIfNeeded(deposit);
    if (deposit.chain === Network.Solana) this.solana.clearDepositNonceIfNeeded(deposit);
    if (Chains.get(deposit.chain).isEvm) this.evm.clearDepositNonceIfNeeded(deposit);

    this.removePendingDeposit(deposit);
    this.fetchBalances();
    return hash!;
  }

  async depositToken(chain: Network, address: string, amount: bigint, logger = new Logger()) {
    logger.log(`Call depositToken ${amount} ${chain} ${address}`);

    if (chain === Network.Near) {
      address = address === "native" ? "wrap.near" : address;
      logger.log(`Depositing to NEAR ${address}`);

      logger.log(`Check if token ${address} is not registered`);
      const call = await this.near.getRegisterTokenTrx(address, OMNI_HOT_V2);

      if (call) {
        logger.log(`Registering token ${address}`);
        await this.near.callTransaction(call);
      }

      const depositWnear: any[] = [];
      if (address === "wrap.near") {
        logger.log(`Wrapping native NEAR`);
        depositWnear.push(await this.near.getWrapNearDepositAction(BigInt(amount)));
      }

      logger.log(`Depositing token to HOT Bridge`);
      await this.near.callTransaction({
        receiverId: address,
        actions: [
          ...depositWnear,
          {
            type: "FunctionCall",
            params: {
              args: { amount: BigInt(amount), receiver_id: OMNI_HOT_V2, msg: this.near.address },
              methodName: "ft_transfer_call",
              gas: String(80n * TGAS),
              deposit: "1",
            },
          },
        ],
      });

      logger.log(`Depositing token to intents`);
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
      deposit = await this.evm.deposit(chain, address, amount, undefined, logger);
    }

    // Stellar DEPOSIT
    if (chain === Network.Stellar) {
      logger.log(`Withdrawing from Stellar`);
      deposit = await this.stellar.deposit(address, amount);
    }

    // SOLANA DEPOSIT
    if (chain === Network.Solana) {
      logger.log(`Withdrawing from Solana`);
      deposit = await this.solana.deposit(address, amount);
    }

    // TON DEPOSIT
    if (chain === Network.Ton) {
      logger.log(`Withdrawing from TON`);
      deposit = await this.ton.deposit(address, amount, undefined, logger);
    }

    logger.log(`Deposit: ${JSON.stringify(deposit, null, 2)}`);
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
    logger.log(`Withdrawing ${amount} ${chain} ${address}`);

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

    logger.log(`Fetch balances`);
    const balances = await this.fetchBalances();
    const intentId = toOmniIntent(chain, address);
    logger.log(`Withdraw intent ${intentId}`);

    if (balances[intentId] >= amount) {
      logger.log(`Just withdrawing own liquidity`);
      const receiver = chain === Network.Near ? this.near.address : this.getReceiverRaw(chain);
      const tx = await this.intents.withdrawIntent(intentId, amount, receiver, logger);
      if (chain === Network.Near) return;

      logger.log(`Parsing withdrawal nonce`);
      const nonce = await this.near.parseWithdrawalNonce(tx);

      logger.log(`Depositing to ${Chains.get(chain).name}`);
      await this.finishWithdrawal(nonce);
      return;
    }

    logger.log(`Fetching stable group`);
    const group = await this.getGroup(intentId);
    const decimals = omniTokens[intentId]?.[chain]?.decimal;
    if (decimals == null) throw `Unsupported token ${intentId}`;

    // amount to swap minus balance in target intent token
    const amountInFloat = formatAmount(amount - (balances[intentId] || 0n), decimals);
    group[intentId] = "0"; // Dont swap target intent token

    logger.log(`Estimating swap`);
    let { quote, signed_quote, amountOut } = await OmniApi.shared.estimateSwap(this.near.address, group, intentId, amountInFloat);

    logger.log(`Signing intent for swap with amount ${amountOut}`);
    const signed = await signIntentAction(this.signers.near, quote);

    amountOut += balances[intentId] || 0n;
    logger.log(`Withdrawing intent with amount ${amountOut}`);
    const receiver = chain === Network.Near ? this.signers.near.accountId : this.getReceiverRaw(chain);
    const withdraw = await withdrawIntentAction(this.signers.near, intentId, amountOut, receiver);

    logger.log(`Executing intents`);
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

    logger.log(`Parsing withdrawal nonce`);
    const nonce = await this.near.parseWithdrawalNonce(tx);

    logger.log(`Depositing to ${Chains.get(chain).name}`);
    await this.finishWithdrawal(nonce);
  }
}

export default OmniService;
