import RLP from "rlp";
import crypto from "crypto";
import { baseEncode } from "@near-js/utils";

const OMNI_API = ["https://rpc1.hotdao.ai"];

class OmniApi {
  static shared = new OmniApi();

  async request(req: RequestInfo, init: any) {
    if (!init.endpoint) init.endpoint = OMNI_API;
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
    const res = await this.request("/api/v1/web/time", { method: "GET", endpoint: "https://api0.herewallet.app" });
    const { ts } = await res.json();
    return ts;
  }

  async getBridgeTokens(): Promise<{ groups: Record<string, string[]>; liquidityContract: string }> {
    const res = await this.request("/api/v1/exchange/intent_swap/groups", { method: "GET", endpoint: "https://api0.herewallet.app" });
    const { groups, stable_swap_contract } = await res.json();
    return { groups, liquidityContract: stable_swap_contract };
  }

  async estimateSwap(nearAddress: string, group: Record<string, string>, intentTo: string, amount: number) {
    const res = await this.request("/api/v1/exchange/intent_swap", {
      body: JSON.stringify({ token_out: intentTo, amount_in: amount, tokens_in: group, sender_id: nearAddress }),
      endpoint: "https://api0.herewallet.app",
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
