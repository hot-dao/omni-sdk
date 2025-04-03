import { AbstractProvider, FeeData, JsonRpcProvider, Network, PerformActionRequest, TransactionRequest } from "ethers";

let methods = [
  "getBlock",
  "getBlockNumber",
  "getCode",
  "getGasPrice",
  "getLogs",
  "getPriorityFee",
  "getStorage",
  "getTransaction",
  "getTransactionCount",
  "getTransactionReceipt",
  "getTransactionResult",
];

export class EvmProvider extends AbstractProvider {
  constructor(
    readonly providers: JsonRpcProvider[],
    readonly chain: number,
    readonly address?: string,
    readonly submitter?: JsonRpcProvider[]
  ) {
    super(chain);
  }

  async getNetwork(): Promise<Network> {
    return Network.from(this.chain);
  }

  async send(method: string, params: any[]) {
    let lastError: any;
    for (const rpc of this.providers) {
      try {
        return await rpc.send(method, params);
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError;
  }

  estimateGas(_tx: TransactionRequest): Promise<bigint> {
    if (_tx.from == null) _tx.from = this.address;
    return super.estimateGas(_tx);
  }

  async getFeeData(): Promise<FeeData> {
    try {
      const res = await fetch(`https://api0.herewallet.app/api/v1/evm/${this.chain}/gas_price`);
      const { gas_price } = await res.json();
      return new FeeData(BigInt(gas_price));
    } catch {
      if (this.chain === 56) return new FeeData(1000000000n);
      return super.getFeeData();
    }
  }

  async _perform<T = any>(req: PerformActionRequest): Promise<T> {
    let lastError: any;
    let currentProviderIndex = -1;

    let rpcList = this.providers;
    if (req.method === "broadcastTransaction" || req.method === "getTransactionReceipt") {
      rpcList = [...(this.submitter || []), ...this.providers];
    }

    for (const rpc of rpcList) {
      currentProviderIndex += 1;
      if (methods.includes(req.method)) {
        const result = await rpc._perform(req).catch(() => null);
        if (result == null && rpcList[currentProviderIndex + 1] != null) continue;
        return result;
      }

      try {
        return await rpc._perform(req);
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError;
  }
}
