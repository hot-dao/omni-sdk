import fetch from "node-fetch";
const OMNI_API = "https://rpc0.hotdao.ai";

class OmniApi {
  static shared = new OmniApi();

  async findDeposits(addresses: string[]) {
    const res = await fetch(`https://api0.herewallet.app/api/v1/transactions/hot_bridges?addresses=${addresses.join(",")}`, {
      headers: { "content-type": "application/json" },
      method: "GET",
    });

    const { transactions } = (await res.json()) as any;
    return transactions;
  }

  async withdrawSign(nonce: string) {
    const res = await fetch(`${OMNI_API}/withdraw/sign`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }),
      method: "POST",
    });

    const { signature } = (await res.json()) as any;
    return signature;
  }

  async depositSign(chain: number, nonce: string, sender_id: string, receiver_id: string, token_id: string, amount: string) {
    const res = await fetch(`${OMNI_API}/deposit/sign`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, chain_from: chain, sender_id, receiver_id, token_id, amount }),
      method: "POST",
    });

    const { signature } = (await res.json()) as any;
    return signature;
  }

  async refundSign(chain: number, nonce: string, receiver_id: string, token_id: string, amount: bigint) {
    const res = await fetch(`${OMNI_API}/refund/sign`, {
      headers: { "Content-type": "application/json" },
      body: JSON.stringify({ receiver_id, token_id, amount, nonce, chain_from: chain }),
      method: "POST",
    });

    const { signature } = (await res.json()) as any;
    return signature;
  }
}

export default OmniApi;
