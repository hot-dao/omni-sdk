import RLP from "rlp";
import crypto from "crypto";
import { baseDecode, baseEncode } from "@near-js/utils";
import { encodeReceiver, wait } from "./utils";
import { Network, TokenAsset } from "./types";

type RequestOptions = RequestInit & { endpoint?: string | string[]; retry?: number; retryDelay?: number };

class OmniApi {
  constructor(readonly api: string[] = ["https://api0.herewallet.app", "https://api2.herewallet.app"], readonly mpcApi: string[] = ["https://rpc1.hotdao.ai", "https://rpc2.hotdao.ai"]) {}

  async request(req: RequestInfo, init: RequestOptions): Promise<Response> {
    try {
      const endpoints = Array.isArray(init.endpoint) ? init.endpoint : [init.endpoint];
      let error: Error | null = null;

      for (const endpoint of endpoints) {
        try {
          const headers = Object.assign(
            {
              "omni-version": `v2`,
              "Content-Type": "application/json",
              Referer: "https://api0.herewallet.app",
            },
            init.headers
          );

          const res = await fetch(`${endpoint}${req}`, { ...init, headers });
          if (!res.ok) throw await res.text();
          return res;
        } catch (e) {
          error = e as Error;
        }
      }

      throw error;
    } catch (finalError) {
      if (init.retry == null || init.retry <= 0) throw finalError;
      await wait(init.retryDelay || 1000);
      return this.request(req, { ...init, retry: init.retry - 1 });
    }
  }

  async requestRpc(req: RequestInfo, init: RequestOptions): Promise<Response> {
    if (!init.endpoint) init.endpoint = this.mpcApi;
    return await this.request(req, init);
  }

  async requestApi(req: RequestInfo, init: RequestOptions): Promise<Response> {
    if (!init.endpoint) init.endpoint = this.api;
    return await this.request(req, init);
  }

  async getTokenAssets(): Promise<TokenAsset[]> {
    const res = await this.requestApi(`/api/v1/exchange/intent_tokens`, { method: "GET" });
    const { tokens } = await res.json();
    return tokens;
  }

  async getTime() {
    const res = await this.requestApi("/api/v1/web/time", { method: "GET" });
    const { ts } = await res.json();
    return ts;
  }

  async getWithdrawFee(options: { chain: Network; token: string; receiver: string; type?: "bridge" | "refuel" }): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    const { chain, token, receiver, type = "bridge" } = options;
    const res = await this.requestApi(`/api/v1/evm/${chain === 1111 ? 1117 : chain}/bridge_gas_price?type=${type}&token_id=${token}&receiver=${receiver}`, { method: "GET" });
    const { gas_price, block_number } = await res.json();
    return { gasPrice: BigInt(gas_price), blockNumber: BigInt(block_number) };
  }

  async getSwapQuoteExectOut(
    tokenIn: string,
    tokenOut: string,
    amount: bigint
  ): Promise<{
    quote_hashes: string[];
    signed_fee_quote: { payload: string; public_key: string; signature: string; standard: string };
    amount_in: string;
  }> {
    const res = await this.requestApi(`/api/v1/exchange/intent_quote_with_exact_amount_out`, {
      body: JSON.stringify({ token_in: tokenIn, token_out: tokenOut, exact_amount_out: amount.toString() }),
      method: "POST",
    });

    return await res.json();
  }

  async getSwapQuoteExectIn(
    senderId: string,
    tokenIn: string,
    tokenOut: string,
    amount: bigint
  ): Promise<{
    quote_hashes: string[];
    signed_fee_quote: { payload: string; public_key: string; signature: string; standard: string };
    quote: { signer_id: string; deadline: string; intents: any[]; nonce: string; verifying_contract: string };
  }> {
    const res = await this.requestApi(`/api/v1/exchange/intent_exact_swap_quote`, {
      body: JSON.stringify({ sender_id: senderId, token_in: tokenIn, token_out: tokenOut, exact_amount_in: amount.toString() }),
      method: "POST",
    });

    return await res.json();
  }

  async registerDeposit(intentAccount: string) {
    await this.requestApi(`/api/v1/transactions/hot_bridges/auto_deposit_register`, {
      body: JSON.stringify({ intent_id: intentAccount }),
      method: "POST",
    });
  }

  async getBridgeTokens(): Promise<{ groups: Record<string, string[]>; liquidityContract: string }> {
    const res = await this.requestApi("/api/v1/exchange/intent_swap/groups", { method: "GET" });
    const { groups, stable_swap_contract } = await res.json();
    return { groups, liquidityContract: stable_swap_contract };
  }

  async estimateSwapStableGroup(
    intentAccount: string,
    group: Record<string, string>,
    intentTo: string,
    amount: number,
    mode?: "swap" | "bridge"
  ): Promise<{
    amountOut: bigint;
    quote_hashes: string[];
    quote: { signer_id: string; deadline: string; intents: any[]; nonce: string; verifying_contract: string };
    signed_fee_quote: { payload: string; public_key: string; signature: string; standard: string };
    fees: string;
  }> {
    const res = await this.requestApi("/api/v1/exchange/intent_swap_quote", {
      body: JSON.stringify({ token_out: intentTo, amount_in: amount, tokens_in: group, sender_id: intentAccount, mode }),
      method: "POST",
    });

    const result = await res.json();
    return {
      amountOut: BigInt(result.amount_out),
      quote_hashes: result.quote_hashes,
      signed_fee_quote: result.signed_fee_quote,
      quote: result.quote,
      fees: result.fees,
    };
  }

  async withdrawSign(nonce: string): Promise<string> {
    const res = await this.requestRpc("/withdraw/sign", { body: JSON.stringify({ nonce }), method: "POST", retryDelay: 3000, retry: 3 });
    const { signature } = await res.json();
    return signature;
  }

  async clearWithdrawSign(chain: number, nonce: string, receiverId: string): Promise<{ signature: string }> {
    const rec = baseDecode(encodeReceiver(chain, receiverId));
    const data = RLP.encode([Buffer.from("clear"), BigInt(nonce), rec]);
    const proof = crypto.createHash("sha256").update(data).digest();
    const res = await this.requestRpc("/clear/sign", {
      body: JSON.stringify({ nonce, ownership_proof: baseEncode(proof) }),
      retryDelay: 3000,
      method: "POST",
      retry: 3,
    });

    return await res.json();
  }

  async executeClearWithdraw(chain: number, nonce: string, receiverId: string): Promise<{ signature: string; hash?: string; sender_id?: string }> {
    try {
      const body = JSON.stringify({ nonce });
      const res = await this.requestApi("/api/v1/transactions/clear_completed_withdrawal", { method: "POST", retryDelay: 3000, retry: 3, body });
      return await res.json();
    } catch {
      return await this.clearWithdrawSign(chain, nonce, receiverId);
    }
  }

  async depositSign(chain: number, nonce: string, sender_id: string, receiver_id: string, token_id: string, amount: string): Promise<{ signature: string }> {
    if (chain === 1111) chain = 1117;
    const body = JSON.stringify({ nonce, chain_from: chain, sender_id, receiver_id, token_id, amount, autopilot: true });
    const res = await this.requestRpc("/deposit/sign", { method: "POST", body, retry: 3, retryDelay: 10_000 });
    return await res.json();
  }

  async executeDeposit(args: {
    chain_id: number;
    nonce: string;
    sender_id: string;
    receiver_id: string;
    token_id: string;
    amount: string;
    msg: string;
  }): Promise<{ signature: string; hash?: string; sender_id?: string; status?: "ok" }> {
    try {
      if (args.chain_id === 1111) args.chain_id = 1117;
      const body = JSON.stringify(args);
      const res = await this.requestApi("/api/v1/transactions/process_bridge_deposit", { retry: 3, retryDelay: 10_000, method: "POST", body });
      return await res.json();
    } catch {
      return this.depositSign(args.chain_id, args.nonce, args.sender_id, args.receiver_id, args.token_id, args.amount);
    }
  }
}

export default OmniApi;
