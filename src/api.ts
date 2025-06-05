import RLP from "rlp";
import crypto from "crypto";
import { baseEncode } from "@near-js/utils";
import { Network } from "./chains";

class OmniApi {
  constructor(
    readonly api: string = "https://api0.herewallet.app",
    readonly mpcApi: string[] = ["https://rpc1.hotdao.ai", "https://rpc0.hotdao.ai"]
  ) {}

  async request(req: RequestInfo, init: any) {
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

  async getTime() {
    const res = await this.request("/api/v1/web/time", { method: "GET", endpoint: this.api });
    const { ts } = await res.json();
    return ts;
  }

  async getWithdrawFee(chain: Network, token?: string): Promise<{ gasPrice: bigint; blockNumber: bigint }> {
    const res = await this.request(`/api/v1/evm/${chain}/bridge_gas_price`, { method: "GET", endpoint: this.api });
    const { gas_price, block_number } = await res.json();
    return { gasPrice: BigInt(gas_price), blockNumber: BigInt(block_number) };
  }

  async getSwapQuoteExectIn(
    tokensFrom: Record<string, bigint>,
    tokenTo: string,
    amount: number
  ): Promise<{
    amount_out: string;
    quote_hashes: string[];
    quote: { signer_id: string; deadline: string; intents: any[]; nonce: string; verifying_contract: string };
    signed_fee_quote: { payload: string; public_key: string; signature: string; standard: string };
    fees: string;
  }> {
    const body = JSON.stringify({ token_out: tokenTo, amount_in: amount, tokens_in: tokensFrom });
    const response = await this.request("/api/v1/exchange/intent_swap_quote", {
      endpoint: this.api,
      timeout: 30_000,
      method: "POST",
      retries: 1,
      body,
    });

    const { quote_hashes, signed_fee_quote, fees, amount_out, quote } = await response.json();
    return { quote, quote_hashes, signed_fee_quote, fees, amount_out };
  }

  async getSwapQuoteExectOut(
    tokenIn: string,
    tokenOut: string,
    amount: bigint
  ): Promise<{
    amount_in: string;
    quote_hashes: string[];
    quote: { signer_id: string; deadline: string; intents: any[]; nonce: string; verifying_contract: string };
  }> {
    const res = await this.request(`/api/v1/exchange/intent_quote_with_exact_amount_out`, {
      body: JSON.stringify({ token_in: tokenIn, token_out: tokenOut, exact_amount_out: amount.toString() }),
      endpoint: this.api,
      method: "POST",
    });

    return await res.json();
  }

  async getBridgeTokens(): Promise<{ groups: Record<string, string[]>; liquidityContract: string }> {
    const res = await this.request("/api/v1/exchange/intent_swap/groups", { method: "GET", endpoint: this.api });
    const { groups, stable_swap_contract } = await res.json();
    return { groups, liquidityContract: stable_swap_contract };
  }

  async estimateSwap(nearAddress: string, group: Record<string, string>, intentTo: string, amount: number) {
    const res = await this.request("/api/v1/exchange/intent_swap", {
      body: JSON.stringify({ token_out: intentTo, amount_in: amount, tokens_in: group, sender_id: nearAddress }),
      endpoint: this.api,
      method: "POST",
    });

    const result = await res.json();
    const { quote, signed_quote, amount_out } = result;
    return { quote, signed_quote, amountOut: BigInt(amount_out) };
  }

  async clearWithdrawSign(nonce: string, receiverId: Buffer) {
    const data = RLP.encode([Buffer.from("clear"), BigInt(nonce), receiverId]);
    const proof = crypto.createHash("sha256").update(data).digest();
    const res = await this.request("/clear/sign", { body: JSON.stringify({ nonce, ownership_proof: baseEncode(proof) }), method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async withdrawSign(nonce: string) {
    const res = await this.request("/withdraw/sign", { body: JSON.stringify({ nonce }), method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async depositSign(chain: number, nonce: string, sender_id: string, receiver_id: string, token_id: string, amount: string) {
    const body = JSON.stringify({ nonce, chain_from: chain, sender_id, receiver_id, token_id, amount });
    const res = await this.request("/deposit/sign", { method: "POST", body });
    const { signature } = await res.json();
    return signature;
  }

  async refundSign(chain: number, nonce: string, receiver_id: string, token_id: string, amount: bigint) {
    const body = JSON.stringify({ receiver_id, token_id, amount, nonce, chain_from: chain });
    const res = await this.request("/refund/sign", { method: "POST", body });
    const { signature } = await res.json();
    return signature;
  }
}

export default OmniApi;
