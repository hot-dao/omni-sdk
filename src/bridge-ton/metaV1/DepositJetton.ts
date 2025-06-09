import { Address, beginCell, Cell, Contract, ContractProvider, Sender, SendMode, TupleItemSlice } from "@ton/core";
import { OpCode } from "../constants";

export class DepositJetton implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new DepositJetton(address);
  }

  async sendSelfDestruct(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.selfDestruct, 32).endCell(),
    });
  }

  async getBalance(provider: ContractProvider): Promise<bigint> {
    const result = await provider.get("get_smc_balance", []);

    return result.stack.readBigNumber();
  }

  async getMetaWalletAddress(provider: ContractProvider): Promise<Address> {
    const result = await provider.get("get_meta_wallet_address", []);

    return result.stack.readAddress();
  }

  async getSenderAddress(provider: ContractProvider): Promise<Address> {
    const result = await provider.get("get_sender_address", []);

    return result.stack.readAddress();
  }

  async getDepositJettonNonce(provider: ContractProvider) {
    const result = await provider.get("get_deposit_nonce", []);

    return result.stack.readBigNumber();
  }

  async getDepositJettonHash(provider: ContractProvider) {
    const result = await provider.get("get_deposit_hash", []);

    return result.stack.readBigNumber();
  }

  async getWithdrawVerification(provider: ContractProvider, hash: Buffer): Promise<any> {
    const hashCell = beginCell().storeBuffer(hash).endCell();

    const result = await provider.get("verify_withdraw", [
      {
        type: "slice",
        cell: hashCell,
      } as TupleItemSlice,
    ]);

    return result.stack.readBigNumber();
  }
}
