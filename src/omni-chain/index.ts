import { getBytes, sha256 } from "ethers";
import { baseEncode } from "@near-js/utils";
import { Address } from "@ton/core";
import uniq from "lodash/uniq";

import NearSigner from "../signers/NearSigner";
import SolanaSigner from "../signers/SolanaSigner";
import TonSigner from "../signers/TonSigner";
import EvmSigner from "../signers/EvmSigner";

import { bigintToBuffer, generateUserId } from "./ton/constants";
import { PendingDeposit, PendingWithdraw, TransferType } from "./types";
import { bigIntMin, nativeToOmni, PendingControl, wait } from "./utils";
import { getChain, Network } from "./chains";
import SolanaOmniService from "./solana";
import EvmOmniService from "./evm";
import TonOmniService from "./ton";
import OmniApi from "./api";
import OmniToken, { TokenInput } from "./token";
import { TokenId } from "./tokens";

export const OMNI_HOT = "v1-1.omni.hot.tg";
export const OMNI_HELPER = "v1-1.omni-helper.hot.tg";
export const TGAS = 1000000000000n;

interface Options {
  solana?: SolanaSigner;
  near: NearSigner;
  ton?: TonSigner;
  evm?: EvmSigner;
}

class OmniService {
  withdrawals: Record<string, PendingWithdraw> = {};
  deposits: Record<string, PendingDeposit> = {};

  solana: SolanaOmniService;
  ton: TonOmniService;
  evm: EvmOmniService;

  constructor(readonly signers: Options) {
    this.ton = new TonOmniService(this);
    this.solana = new SolanaOmniService(this);
    this.evm = new EvmOmniService(this);
  }

  get storage(): any {
    return null;
  }

  signer(chain: Network) {
    if (chain === Network.Hot) return this.getOmniAddress(this.signers.near.accountId);
    if (chain === Network.Near) return this.signers.near.accountId;
    if (chain === Network.Solana) return this.signers.solana!.address;
    if (chain === Network.Ton) return this.signers.ton!.address;
    return this.signers.evm!.address;
  }

  getOmniAddress(address: string) {
    return baseEncode(getBytes(sha256(Buffer.from(address, "utf8"))));
  }

  getOmniAddressHex(address: string) {
    return sha256(Buffer.from(address, "utf8"));
  }

  token(id: TokenId) {
    return new OmniToken(this, id);
  }

  async findToken(chain: Network, address: string) {
    if (chain === 0) return new OmniToken(this, +address);
    const id = await this.signers.near.viewFunction({
      args: { contract_id: nativeToOmni(chain, address), chain_id: chain },
      methodName: "get_token_id",
      contractId: OMNI_HOT,
    });

    return new OmniToken(this, id);
  }

  get omniAddress() {
    return this.getOmniAddress(this.signers.near.accountId);
  }

  get omniAddressHex() {
    return sha256(Buffer.from(this.signers.near.accountId, "utf8"));
  }

  removePendingDeposit(deposit: PendingDeposit) {
    delete this.deposits[deposit.tx];
    this.storage?.set("omni:deposits:v2", Object.values(this.deposits));
  }

  addPendingDeposit(deposit: PendingDeposit) {
    this.deposits[deposit.tx] = deposit;
    this.storage?.set("omni:deposits:v2", Object.values(this.deposits));
    return deposit;
  }

  addPendingWithdraw(nonce: string, transfer: TransferType) {
    this.withdrawals[String(nonce)] = {
      receiver: transfer.receiver_id,
      amount: transfer.amount,
      token: transfer.token_id,
      chain: transfer.chain_id,
      nonce: String(nonce),
      timestamp: Date.now(),
      completed: false,
    };
  }

  completeWithdraw(nonce: string) {
    if (!this.withdrawals[nonce]) return;
    this.withdrawals[nonce].completed = true;
  }

  getReceiverRaw(chain: Network) {
    if (chain === Network.Near) return baseEncode(getBytes(sha256(Buffer.from(this.signers.near.accountId, "utf8"))));

    if (chain === Network.Solana) {
      if (this.signers.solana == null) throw "Connect Solana";
      return this.signers.solana.publicKey.toBase58();
    }

    if (chain === Network.Ton) {
      if (this.signers.ton == null) throw "Connect TON";
      const id = generateUserId(Address.parse(this.signers.ton.address), 0n);
      return baseEncode(bigintToBuffer(id, 32));
    }

    if (getChain(chain).isEvm) {
      if (this.signers.evm == null) throw "Connect EVM";
      return baseEncode(getBytes(this.signers.evm.address));
    }

    throw `Unsupported chain address ${chain}`;
  }

  async getOmniBalances(account = this.omniAddress): Promise<Record<number, string>> {
    return await this.signers.near.viewFunction({
      args: { account_id: account },
      methodName: "get_balance",
      contractId: OMNI_HOT,
    });
  }

  async isDepositUsed(chain: number, nonce: string) {
    return await await this.signers.near.viewFunction({
      args: { chain_id: chain, nonce: nonce },
      methodName: "is_executed",
      contractId: OMNI_HOT,
    });
  }

  async isWithdrawUsed(chain: number, nonce: string) {
    if (chain === Network.Ton) return await this.ton.isNonceUsed(nonce);
    if (chain === Network.Solana) return await this.solana.isNonceUsed(nonce);
    if (getChain(chain).isEvm) return await this.evm.isNonceUsed(chain, nonce);
    return false;
  }

  async updatePendingStatus(nonce: string) {
    if (+nonce <= 1728526736_000_000_000_000) return this.completeWithdraw(nonce);

    // More then 17 days -> expired nonce (non-refundable)
    const currentNonce = Date.now() * 1_000_000_000;
    const daysAgo = (currentNonce - +nonce) / 1_000_000_000_000 / 3600 / 24;
    if (daysAgo >= 16) return this.completeWithdraw(nonce);

    // already completed
    if (this.withdrawals[nonce]?.completed) return;

    const transfer = await this.signers.near.viewFunction({ methodName: "get_transfer", contractId: OMNI_HOT, args: { nonce } });
    if (transfer == null) return this.completeWithdraw(nonce);

    const isUsed = await this.isWithdrawUsed(transfer.chain_id, nonce);
    if (isUsed) return this.completeWithdraw(nonce);

    if (this.withdrawals[nonce] == null) {
      this.addPendingWithdraw(nonce, transfer);
    }
  }

  async getLastPendings() {
    const withdrawals = await this.signers.near.viewFunction({
      args: { account_id: this.omniAddress },
      methodName: "get_withdrawals",
      contractId: OMNI_HELPER,
    });

    const ids = Object.values(this.withdrawals)
      .filter((t) => !t.completed)
      .map((t) => String(t.nonce));

    const nonces = uniq(ids.concat(withdrawals || []));
    const promises = nonces.map((nonce) => this.updatePendingStatus(nonce));
    await Promise.allSettled(promises || []);
    return this.withdrawals;
  }

  isWithdrawNonceExpired(chain: Network, nonce: string) {
    const time = chain === Network.Ton ? 86400_000 : 480_000;
    const ts = BigInt(nonce) / 1000000000000n;
    return Date.now() - Number(ts) * 1000 > time;
  }

  timeLeftForRefund(nonce: string) {
    const ts = BigInt(nonce) / 1000000000000n;
    const time = Date.now() - Number(ts) * 1000;
    return Math.max(0, 602_000 - time);
  }

  async cancelWithdraw(nonce: string): Promise<TransferType> {
    const transfer = await await this.signers.near.viewFunction({
      contractId: OMNI_HOT,
      methodName: "get_transfer",
      args: { nonce },
    });

    if (transfer === null) {
      this.completeWithdraw(nonce);
      throw "Withdraw pending not found";
    }

    const isExpired = this.isWithdrawNonceExpired(transfer.chain_id, nonce);
    if (isExpired === false) throw "nonce does not expire yet";

    const timeToRefund = this.timeLeftForRefund(nonce);
    if (timeToRefund > 0) throw `Refund will be available in ${timeToRefund} seconds.`;

    const receiver = this.getReceiverRaw(transfer.chain_id)!;
    const token = await this.token(transfer.token_id).metadata(transfer.chain_id);
    const signature = OmniApi.shared.refundSign(transfer.chain_id, nonce, receiver, token.omniAddress, transfer.amount);

    await this.signers.near.functionCall({
      contractId: OMNI_HOT,
      methodName: "refund",
      gas: 120n * TGAS,
      attachedDeposit: 0n,
      args: {
        chain_id: transfer.chain_id,
        helper_contract_id: OMNI_HELPER,
        nonce: nonce,
        signature,
      },
    });

    this.completeWithdraw(nonce);
    return transfer;
  }

  async finishWithdrawal(nonce: string) {
    const transfer: TransferType = await this.signers.near.viewFunction({
      methodName: "get_transfer",
      contractId: OMNI_HOT,
      args: { nonce },
    });

    if (this.isWithdrawNonceExpired(transfer.chain_id, nonce)) {
      await this.cancelWithdraw(nonce);
      throw "Withdraw expired";
    }

    if (await this.isWithdrawUsed(transfer.chain_id, nonce)) {
      this.completeWithdraw(nonce);
      throw "Already claimed";
    }

    const signature = await OmniApi.shared.withdrawSign(nonce);

    // SOLANA WITHDRAW
    if (+transfer.chain_id === Network.Solana) {
      await this.solana.withdraw({ nonce, signature, transfer });
      this.completeWithdraw(nonce);
      return;
    }

    if (+transfer.chain_id === Network.Ton) {
      await this.ton.withdraw({ nonce, signature, transfer });
      this.completeWithdraw(nonce);
      return;
    }

    // EVM WITHDRAW
    if (getChain(+transfer.chain_id).isEvm) {
      await this.evm.withdraw({ nonce, signature, transfer });
      this.completeWithdraw(nonce);
      return;
    }
  }

  async finishDeposit(deposit: PendingDeposit) {
    // PARSE DEPOSIT NONCE
    if (getChain(deposit.chain).isEvm) deposit = await this.evm.parseDeposit(deposit.chain, deposit.tx);
    if (deposit.chain === Network.Solana) deposit = await this.solana.parseDeposit(deposit.tx);
    if (deposit.chain === Network.Ton) deposit = await this.ton.parseDeposit(deposit.tx);
    if (deposit == null) throw "Deposit nonce failed";

    const isExecuted = await this.signers.near.viewFunction({
      args: { nonce: deposit.nonce, chain_id: deposit.chain },
      methodName: "is_executed",
      contractId: OMNI_HOT,
    });

    if (isExecuted) {
      // CLEAR DEPOSIT PENDING
      if (deposit.chain === Network.Solana) await this.solana.clearDepositNonceIfNeeded(deposit).catch(() => {});
      if (deposit.chain === Network.Ton) await this.ton.clearDepositNonceIfNeeded(deposit).catch(() => {});
      if (getChain(deposit.chain).isEvm) await this.evm.clearDepositNonceIfNeeded(deposit).catch(() => {});
      this.removePendingDeposit(deposit);
      return;
    }

    const receiver = this.getReceiverRaw(deposit.chain);
    const token = await this.token(deposit.token).metadata(deposit.chain);

    const depositSign = async (attemps = 0) => {
      try {
        return await OmniApi.shared.depositSign(
          deposit.chain,
          deposit.nonce,
          receiver,
          deposit.receiver,
          token.omniAddress,
          deposit.amount
        );
      } catch (e) {
        if (attemps > 5) throw e;
        await wait(3000);
        return await depositSign(attemps + 1);
      }
    };

    const signature = await depositSign();
    try {
      await this.signers.near.functionCall({
        contractId: OMNI_HOT,
        methodName: "deposit",
        gas: 80n * TGAS,
        args: {
          nonce: deposit.nonce,
          chain_id: deposit.chain,
          contract_id: token.omniAddress,
          receiver_id: deposit.receiver,
          amount: deposit.amount,
          signature,
        },
      });
    } catch (e) {
      // Backend can call deposit automatically, so we just skip this error
      if (!e?.toString?.().includes("Nonce already used")) throw e;
    }

    // CLEAR DEPOSIT PENDING
    if (deposit.chain === Network.Ton) await this.ton.clearDepositNonceIfNeeded(deposit).catch(() => {});
    if (deposit.chain === Network.Solana) await this.solana.clearDepositNonceIfNeeded(deposit).catch(() => {});
    if (getChain(deposit.chain).isEvm) await this.evm.clearDepositNonceIfNeeded(deposit).catch(() => {});
    this.removePendingDeposit(deposit);
  }

  async depositToken(token: TokenInput, to?: string, pending = new PendingControl()) {
    if (token.chain === Network.Near) {
      pending?.step(`Withdrawing from NEAR to HOT Omni`, 2);
      const receiver = to ? this.getOmniAddress(to) : this.omniAddress;
      return await this.signers.near.functionCall({
        args: { amount: token.amount, receiver_id: OMNI_HOT, msg: receiver },
        methodName: "ft_transfer_call",
        contractId: token.address,
        attachedDeposit: 1n,
        gas: 80n * TGAS,
      });
    }

    // EVM DEPOSIT
    if (getChain(token.chain).isEvm) {
      pending?.step(`Withdrawing from ${getChain(token.chain).name}`);
      const deposit = await this.evm.deposit(token, to);

      pending?.step(`Receiving on HOT Omni`);
      return await this.finishDeposit(deposit);
    }

    // SOLANA DEPOSIT
    if (token.chain === Network.Solana) {
      pending?.step(`Withdrawing from Solana`);
      const deposit = await this.solana.deposit(token, to);

      pending?.step(`Receiving on HOT Omni`);
      return await this.finishDeposit(deposit);
    }

    // TON DEPOSIT
    if (token.chain === Network.Ton) {
      pending?.step(`Withdrawing from Ton`);
      const deposit = await this.ton.deposit(token, to, pending);

      pending?.step(`Receiving on HOT Omni`);
      return await this.finishDeposit(deposit);
    }

    throw "Unsupported chain";
  }

  async withdrawToken(token: TokenInput, pending = new PendingControl()) {
    if (token.chain === Network.Ton) {
      pending?.step("Creating TON bridge account", 0);
      await this.ton.createUserIfNeeded();
    }

    if (token.chain === Network.Near) {
      pending?.step("Depositting on NEAR", 2);
      const needReg = await this.signers.near.viewFunction({
        args: { account_id: this.signers.near.accountId },
        methodName: "storage_balance_of",
        contractId: token.address,
      });

      return await this.signers.near.functionCall({
        attachedDeposit: needReg == null ? 5000000000000000000000n : 1n,
        methodName: "withdraw_on_near",
        contractId: OMNI_HOT,
        gas: 80n * TGAS,
        args: {
          account_id: this.omniAddress,
          token_id: token.id,
          amount: token.amount,
        },
      });
    }

    // Convert to 24 decimal for omni format
    pending?.step("Withdrawing from HOT Omni");
    const tx = await this.signers.near.functionCall({
      contractId: OMNI_HOT,
      methodName: "withdraw",
      attachedDeposit: 1n,
      gas: 80n * TGAS,
      args: {
        helper_contract_id: OMNI_HELPER,
        receiver_id: this.getReceiverRaw(token.chain),
        account_id: this.omniAddress,
        token_id: token.id,
        chain_id: token.chain,
        amount: token.amount,
      },
    });

    const receipt = await this.signers.near.connection.provider.txStatusReceipts(
      tx.transaction_outcome.id,
      this.signers.near.accountId,
      "EXECUTED"
    );

    const transfer = (() => {
      for (let item of receipt.receipts_outcome) {
        for (let log of item.outcome.logs) {
          const nonce = `${log}`.match(/nonce.....(\d+)/)?.[1];
          const amount = `${log}`.match(/amount.....(\d+)/)?.[1];
          if (nonce && amount) return { amount, nonce };
        }
      }
    })();

    if (transfer == null) throw `Nonce not found, contact support please`;

    const tokenDecimalDiff = 10n ** BigInt(24 - token.decimals);
    this.addPendingWithdraw(transfer.nonce, {
      amount: String(token.amount / tokenDecimalDiff),
      receiver_id: this.getReceiverRaw(token.chain),
      contract_id: token.address,
      token_id: token.id,
      chain_id: token.chain,
    });

    pending?.step(`Depositting to ${getChain(token.chain).name}`);
    await this.finishWithdrawal(transfer.nonce);
  }
}

export default OmniService;
