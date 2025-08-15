import { ReviewFee } from "./fee";

import { Network } from "./types";
import { toOmni, wait } from "./utils";
import HotBridge from "./bridge";

class PoaBridge {
  static BRIDGE_TOKENS: Record<string, string> = {};
  static BRIDGE_TOKENS_INVERTED: Record<string, string> = {};

  static setupTokens(setup: Record<string, string>) {
    PoaBridge.BRIDGE_TOKENS = setup;
    PoaBridge.BRIDGE_TOKENS_INVERTED = Object.fromEntries(Object.entries(PoaBridge.BRIDGE_TOKENS).map(([k, v]) => [v, k]));
  }

  constructor(private readonly omni: HotBridge) {}

  getPoaId(chain: number, address: string) {
    return PoaBridge.BRIDGE_TOKENS_INVERTED[`${chain}:${address}`] || null;
  }

  getTokenId(poaId: string) {
    return PoaBridge.BRIDGE_TOKENS[poaId] || null;
  }

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

  async waitDeposit(intentAccount: string, chain: number, amount: bigint, hash: string, minCreatedMs: number) {
    const receiver = await this.getDepositAddress(intentAccount, chain);

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
      const deposit = await this.getLastDeposit(intentAccount, chain, amount, minCreatedMs).catch(() => null);
      if (deposit?.status === "FAILED") throw "Deposit failed";
      if (deposit?.status === "COMPLETED") return;

      await wait(3000);
      return await waitComplete();
    };

    await waitComplete();
    return { hash, receiver };
  }
}

PoaBridge.setupTokens({
  "tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near": `${Network.Tron}:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`,
  "tron.omft.near": `${Network.Tron}:native`,

  "eth.omft.near": `${Network.Eth}:native`,
  "eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": `${Network.Eth}:0xdac17f958d2ee523a2206206994597c13d831ec7`,
  "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": `${Network.Eth}:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`,

  "sol.omft.near": `${Network.Solana}:native`,
  "sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": `${Network.Solana}:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, // USDT
  "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": `${Network.Solana}:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, // USDC

  "btc.omft.near": `${Network.Near}:btc.omft.near`,
  "zec.omft.near": `${Network.Near}:zec.omft.near`,
});

export default PoaBridge;
