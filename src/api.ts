import RLP from "rlp";
import crypto from "crypto";
import { baseEncode } from "@near-js/utils";
import { Network } from "./types";

class OmniApi {
  constructor(readonly api: string[] = ["https://api0.herewallet.app", "https://api2.herewallet.app"], readonly mpcApi: string[] = ["https://rpc1.hotdao.ai", "https://rpc2.hotdao.ai"]) {}

  async requestRpc(req: RequestInfo, init: any) {
    if (!init.endpoint) init.endpoint = this.mpcApi;
    const endpoints = Array.isArray(init.endpoint) ? init.endpoint : [init.endpoint];
    let error: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        const headers = Object.assign({}, init.headers, { "omni-version": `v2`, "Content-Type": "application/json" });
        const res = await fetch(`${endpoint}${req}`, { ...init, headers });

        if (!res.ok) {
          const result = await res.text();
          throw result;
        }

        return res;
      } catch (e) {
        error = e as Error;
      }
    }

    throw error;
  }

  async getTokenAssets() {
    const res = await this.requestApi(`/api/v1/exchange/intent_tokens`, { method: "GET" });
    const { tokens } = await res.json();
    return tokens;
  }

  async requestApi(req: RequestInfo, init: any) {
    if (!init.endpoint) init.endpoint = this.api;
    const endpoints = Array.isArray(init.endpoint) ? init.endpoint : [init.endpoint];
    init.headers = { ...(init.headers || {}), "Content-Type": "application/json" };

    for (const endpoint of endpoints) {
      const res = await fetch(`${endpoint}${req}`, init);
      if (res.status === 502 || res.status === 522) continue;
      if (res.ok) return res;
      const result = await res.text().catch(() => "Failed to request API");
      throw result;
    }

    throw "Failed to request API";
  }

  async getTime() {
    const res = await this.requestApi("/api/v1/web/time", { method: "GET" });
    const { ts } = await res.json();
    return ts;
  }

  async getWithdrawFee(chain: Network, receiver: string): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    const res = await this.requestApi(`/api/v1/evm/${chain}/bridge_gas_price?receiver=${receiver}`, { method: "GET" });
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

  async clearWithdrawSign(nonce: string, receiverId: Buffer) {
    const data = RLP.encode([Buffer.from("clear"), BigInt(nonce), receiverId]);
    const proof = crypto.createHash("sha256").update(data).digest();
    const res = await this.requestRpc("/clear/sign", { body: JSON.stringify({ nonce, ownership_proof: baseEncode(proof) }), method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async withdrawSign(nonce: string) {
    const res = await this.requestRpc("/withdraw/sign", { body: JSON.stringify({ nonce }), method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async depositSign(chain: number, nonce: string, sender_id: string, receiver_id: string, token_id: string, amount: string) {
    if (chain === 1111) chain = 1117;
    const body = JSON.stringify({ nonce, chain_from: chain, sender_id, receiver_id, token_id, amount });
    const res = await this.requestRpc("/deposit/sign", { method: "POST", body });
    const { signature } = await res.json();
    return signature;
  }
}

export default OmniApi;
