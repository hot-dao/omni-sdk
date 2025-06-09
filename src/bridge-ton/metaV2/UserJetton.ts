import { Address, beginCell, Cell, Contract, ContractProvider, Sender, SendMode } from "@ton/core";
import { OpCode } from "../constants";

export class UserJetton implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new UserJetton(address);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
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

  async sendUserNativeWithdraw(
    provider: ContractProvider,
    via: Sender,
    opts: {
      nonce: bigint;
      amount: bigint;
      signature: Buffer;
      excessAcc: Address;
      value: bigint;
    }
  ) {
    const signatureCell = beginCell().storeBuffer(opts.signature).endCell();

    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.userNativeWithdraw, 32).storeUint(opts.nonce, 128).storeCoins(opts.amount).storeRef(signatureCell).storeAddress(opts.excessAcc).endCell(),
    });
  }

  async sendUserTokenWithdraw(
    provider: ContractProvider,
    via: Sender,
    opts: {
      nonce: bigint;
      token: Address;
      amount: bigint;
      signature: Buffer;
      excessAcc: Address;
      value: bigint;
    }
  ) {
    const signatureCell = beginCell().storeBuffer(opts.signature).endCell();

    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(OpCode.userTokenWithdraw, 32)
        .storeUint(opts.nonce, 128)
        .storeCoins(opts.amount)
        .storeAddress(opts.token)
        .storeRef(signatureCell)
        .storeAddress(opts.excessAcc)
        .endCell(),
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

  async getUserWalletAddress(provider: ContractProvider): Promise<Address> {
    const result = await provider.get("get_user_wallet_address", []);

    return result.stack.readAddress();
  }

  async getLastWithdrawnNonce(provider: ContractProvider): Promise<bigint> {
    const result = await provider.get("get_last_withdrawn_nonce", []);

    return result.stack.readBigNumber();
  }

  async getUserJettonData(provider: ContractProvider) {
    const res = await provider.get("get_user_data", []);

    const metaWalletAddress = res.stack.readAddress();
    const userId = res.stack.readBigNumber();
    const userWalletAddress = res.stack.readAddress();
    const lastWithdrawnNonce = res.stack.readBigNumber();
    const prevWithdrawnNonce = res.stack.readBigNumber();
    const userJettonCode = res.stack.readCell();

    return {
      metaWalletAddress,
      userId,
      userWalletAddress,
      lastWithdrawnNonce,
      prevWithdrawnNonce,
      userJettonCode,
    };
  }
}
