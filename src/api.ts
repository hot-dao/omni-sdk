import RLP from "rlp";
import crypto from "crypto";
import { baseEncode } from "@near-js/utils";

const OMNI_API = ["https://rpc0.hotdao.ai", "https://rpc2.hotdao.ai", "https://api0.herewallet.app/api/v1/evm/rpc0"];

class OmniApi {
  static shared = new OmniApi();

  async request(req: RequestInfo, init: any) {
    let error: Error | null = null;
    for (const endpoint of OMNI_API) {
      try {
        const headers = Object.assign({}, init.headers, { "omni-version": `v2`, "Content-Type": "application/json" });
        return await fetch(`${endpoint}${req}`, { ...init, headers });
      } catch (e) {
        error = e as Error;
      }
    }

    throw error;
  }

  async getTime() {
    const res = await fetch("https://api0.herewallet.app/api/v1/web/time", { method: "GET" });
    const { ts } = await res.json();
    return ts;
  }

  async estimateSwap(nearAddress: string, group: Record<string, string>, intentTo: string, amount: number) {
    const response = await fetch("https://dev.herewallet.app/api/v1/exchange/intent_swap", {
      body: JSON.stringify({ token_out: intentTo, amount_in: amount, tokens_in: group, sender_id: nearAddress }),
      method: "POST",
    });

    const result = await response.json();
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

  async getPublicKey(walletDerive: string) {
    const body = JSON.stringify({ wallet_derive: walletDerive });
    const res = await this.request("/public_key", { body, method: "POST" });
    const { eddsa } = await res.json();
    return Buffer.from(eddsa, "hex");
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
