const OMNI_API = "https://rpc0.hotdao.ai";

class OmniApi {
  static shared = new OmniApi();

  async request(req: RequestInfo, init: RequestInit) {
    return await fetch(req, init);
  }

  async withdrawSign(nonce: string) {
    const res = await this.request(`${OMNI_API}/withdraw/sign`, { body: JSON.stringify({ nonce }), method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async depositSign(chain: number, nonce: string, sender_id: string, receiver_id: string, token_id: string, amount: string) {
    const body = JSON.stringify({ nonce, chain_from: chain, sender_id, receiver_id, token_id, amount });
    const res = await this.request(`${OMNI_API}/deposit/sign`, { body, method: "POST" });
    const { signature } = await res.json();
    return signature;
  }

  async refundSign(chain: number, nonce: string, receiver_id: string, token_id: string, amount: bigint) {
    const body = JSON.stringify({ receiver_id, token_id, amount, nonce, chain_from: chain });
    const res = await this.request(`${OMNI_API}/refund/sign`, { body, method: "POST" });
    const { signature } = await res.json();
    return signature;
  }
}

export default OmniApi;
