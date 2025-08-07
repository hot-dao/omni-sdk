import { ReviewFee } from "./fee";

import { Network } from "./types";
import OmniApi from "./api";
import { toOmni, wait } from "./utils";

class PoaBridge {
  constructor(private readonly api: OmniApi) {}

  chainIdToIntentsChainId(chain: number) {
    switch (chain) {
      case Network.Btc:
        return "btc:mainnet";
      case Network.Eth:
        return "eth:1";
      case Network.Solana:
        return "sol:mainnet";
      case Network.Zcash:
        return "zec:mainnet";
      case Network.Tron:
        return "tron:mainnet";
      default:
        return null;
    }
  }

  async getDepositAddress(intentAccount: string, chain: number) {
    const intentsChainId = this.chainIdToIntentsChainId(chain);
    const response = await fetch("https://bridge.chaindefuser.com/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: [{ account_id: intentAccount, chain: intentsChainId }],
        method: "deposit_address",
        jsonrpc: "2.0",
        id: "dontcare",
      }),
    });

    const { result } = await response.json();
    return result.address;
  }

  async getDepositFee(chain: number, token: string, intentAccount: string): Promise<ReviewFee> {
    const address = await this.getDepositAddress(intentAccount, chain);
    return new ReviewFee({ gasless: true, chain, baseFee: 1n, token: `${chain}:${token}` });
  }

  async getTokenInfo(address: string, chain: number, token: string) {
    const intentsChainId = this.chainIdToIntentsChainId(chain);
    if (!intentsChainId) return null;

    const response = await fetch("https://bridge.chaindefuser.com/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "withdrawal_estimate",
        params: [
          {
            chain: this.chainIdToIntentsChainId(chain),
            token: toOmni(chain, token),
            address,
          },
        ],
      }),
    });

    const { result } = await response.json();
    return result.token as { min_deposit_amount: string; min_withdrawal_amount: string; withdrawal_fee: string };
  }

  async getLastDeposit(intentAccount: string, chain: number, amount: bigint, minCreatedAt: number) {
    const intentsChainId = this.chainIdToIntentsChainId(chain);
    const response = await fetch("https://bridge.chaindefuser.com/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: [{ account_id: intentAccount, chain: intentsChainId }],
        method: "recent_deposits",
        jsonrpc: "2.0",
        id: "dontcare",
      }),
    });

    const { result } = await response.json();
    return result.deposits.find((t: any) => {
      if (String(t.amount) !== String(amount)) return false;
      if (+new Date(t.created_at) < minCreatedAt) return false;
      if (t.status !== "COMPLETED") return false;
      return true;
    });
  }

  async waitDeposit(intentAccount: string, chain: number, amount: bigint, hash: string) {
    const receiver = await this.getDepositAddress(intentAccount, chain);
    const minCreatedAt = await this.api.getTime();

    fetch("https://bridge.chaindefuser.com/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: [{ deposit_address: receiver, tx_hash: hash }],
        method: "notify_deposit",
        jsonrpc: "2.0",
        id: "dontcare",
      }),
    });

    const waitComplete = async () => {
      const deposit = await this.getLastDeposit(intentAccount, chain, amount, minCreatedAt * 1000).catch(() => null);
      if (deposit?.status === "FAILED") throw "Deposit failed";
      if (deposit?.status === "COMPLETED") return;

      await wait(3000);
      return await waitComplete();
    };

    await waitComplete();
    return { hash, receiver };
  }
}

export default PoaBridge;
