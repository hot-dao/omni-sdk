import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Dictionary, Sender, SendMode, TupleItemInt } from "@ton/core";
import { OpCode } from "../constants";

export type TonMetaWalletConfig = {
  ownerAddress: Address;
  chainId: number;
  verifyingAddress: Buffer;
  depositJettonCode: Cell;
  userJettonCode: Cell;
};

export function tonMetaWalletConfigToCell(config: TonMetaWalletConfig): Cell {
  const verifierCell = beginCell().storeBuffer(config.verifyingAddress).endCell();

  return beginCell()
    .storeAddress(config.ownerAddress)
    .storeUint(config.chainId, 16)
    .storeRef(verifierCell)
    .storeRef(config.depositJettonCode)
    .storeRef(config.userJettonCode)
    .storeDict(Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.Address()))
    .storeCoins(0)
    .storeCoins(0)
    .endCell();
}

export class TonMetaWallet implements Contract {
  constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

  static createFromAddress(address: Address) {
    return new TonMetaWallet(address);
  }

  static createFromConfig(config: TonMetaWalletConfig, code: Cell, workchain = 0) {
    const data = tonMetaWalletConfigToCell(config);
    const init = { code, data };
    return new TonMetaWallet(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  async sendStorageDeposit(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.storageDeposit, 32).endCell(),
    });
  }

  async sendCreateUser(
    provider: ContractProvider,
    via: Sender,
    opts: {
      queryId: bigint;
      userId: bigint;
      bump: bigint;
      userWalletAddress: Address;
      value: bigint;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.createUser, 32).storeUint(opts.queryId, 64).storeUint(opts.userId, 64).storeUint(opts.bump, 8).storeAddress(opts.userWalletAddress).endCell(),
    });
  }

  async sendNativeDeposit(
    provider: ContractProvider,
    via: Sender,
    opts: {
      queryId: number;
      receiver: Buffer;
      amount: bigint;
      excessAcc: Address;
      value: bigint;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.nativeDeposit, 32).storeUint(opts.queryId, 64).storeBuffer(opts.receiver).storeCoins(opts.amount).storeAddress(opts.excessAcc).endCell(),
    });
  }

  async sendAdminNativeWithdraw(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      amount: bigint;
      receiver: Address;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.adminNativeWithdraw, 32).storeCoins(opts.amount).storeAddress(opts.receiver).endCell(),
    });
  }

  async sendAdminTokenWithdraw(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      queryId: number;
      amount: bigint;
      receiver: Address;
      token: Address;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.adminTokenWithdraw, 32).storeUint(opts.queryId, 64).storeCoins(opts.amount).storeAddress(opts.receiver).storeAddress(opts.token).endCell(),
    });
  }

  async sendChangeContractOwner(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      newOwner: Address;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.changeContractOwner, 32).storeAddress(opts.newOwner).endCell(),
    });
  }

  async sendChangeChainId(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      chainId: number;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.changeChainId, 32).storeInt(opts.chainId, 16).endCell(),
    });
  }

  async sendResetMaxNonce(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.resetMaxNonce, 32).endCell(),
    });
  }

  async sendChangeVerifyingPubkey(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      verifyingAddress: Buffer;
    }
  ) {
    const verifierCell = beginCell().storeBuffer(opts.verifyingAddress).endCell();

    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.changeVerifyingPubkey, 32).storeRef(verifierCell).endCell(),
    });
  }

  async sendAddToken(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      tokenAddress: Address;
      jettonWallet: Address;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.addToken, 32).storeAddress(opts.tokenAddress).storeAddress(opts.jettonWallet).endCell(),
    });
  }

  async sendRemoveToken(
    provider: ContractProvider,
    via: Sender,
    opts: {
      value: bigint;
      jettonWallet: Address;
    }
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.removeToken, 32).storeAddress(opts.jettonWallet).endCell(),
    });
  }

  async sendSelfDestruct(provider: ContractProvider, via: Sender, opts: { value: bigint }) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(OpCode.selfDestruct, 32).endCell(),
    });
  }

  async getDepositJettonAddress(provider: ContractProvider, nonce: bigint): Promise<Address> {
    const result = await provider.get("get_deposit_jetton_address", [{ type: "int", value: nonce } as TupleItemInt]);
    return result.stack.readAddress();
  }

  async getUserJettonAddress(provider: ContractProvider, userId: bigint): Promise<Address> {
    const result = await provider.get("get_user_jetton_address", [{ type: "int", value: userId } as TupleItemInt]);
    return result.stack.readAddress();
  }

  async getBalance(provider: ContractProvider): Promise<bigint> {
    const result = await provider.get("get_smc_balance", []);

    return result.stack.readBigNumber();
  }

  async getContractOwner(provider: ContractProvider): Promise<Address> {
    const result = await provider.get("get_contract_owner", []);

    return result.stack.readAddress();
  }

  async getVerifyingAddress(provider: ContractProvider): Promise<Buffer> {
    const result = await provider.get("get_verifying_pubkey", []);
    return result.stack.readBuffer();
  }

  async getTokens(provider: ContractProvider): Promise<Dictionary<Address, Address> | undefined> {
    const result = await provider.get("get_tokens", []);

    return result.stack.readCellOpt()?.beginParse().loadDictDirect(Dictionary.Keys.Address(), Dictionary.Values.Address());
  }

  async getChainId(provider: ContractProvider): Promise<number> {
    const result = await provider.get("get_chain_id", []);
    return result.stack.readNumber();
  }

  async getMaxNonce(provider: ContractProvider): Promise<bigint> {
    const result = await provider.get("get_max_nonce", []);
    return result.stack.readBigNumber();
  }

  async getLastGeneratedNonce(provider: ContractProvider): Promise<bigint> {
    const result = await provider.get("get_last_generated_nonce", []);
    return result.stack.readBigNumber();
  }

  async getMetaWalletData(provider: ContractProvider) {
    const res = await provider.get("get_meta_wallet_data", []);

    const contractOwner = res.stack.readAddress();
    const chainId = res.stack.readBigNumber();
    const verifyingAddress = res.stack.readBuffer();
    const depositJettonCode = res.stack.readCell();
    const userJettonCode = res.stack.readCell();
    const tokens = res.stack.readCellOpt()?.beginParse().loadDictDirect(Dictionary.Keys.Address(), Dictionary.Values.Address());
    const maxNonce = res.stack.readBigNumber();
    const lastGeneratedNonce = res.stack.readBigNumber();

    return {
      contractOwner,
      chainId,
      verifyingAddress,
      depositJettonCode,
      userJettonCode,
      tokens,
      maxNonce,
      lastGeneratedNonce,
    };
  }
}
