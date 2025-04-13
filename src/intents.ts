import { randomBytes } from "tweetnacl";

export const buildWithdrawIntentAction = async (intentAccount: string, omniIntent: string, amount: bigint, receiverAddr: string) => {
  const [_, mt_contract, token_id] = omniIntent.split(":");
  const message = JSON.stringify({
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signer_id: intentAccount,
    intents: [
      {
        intent: "mt_withdraw",
        amounts: [amount],
        receiver_id: "v2.omni.hot.tg",
        token_ids: [token_id],
        token: mt_contract,
        memo: receiverAddr,
      },
    ],
  });

  const nonce = Buffer.from(randomBytes(32));
  return { nonce: nonce.toString("base64"), message };
};
