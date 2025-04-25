import { randomBytes } from "ethers";
import { OMNI_HOT_V2 } from "./utils";

export const buildWithdrawIntentAction = async (intentAccount: string, omniIntent: string, amount: bigint, receiverAddr: string) => {
  const [format, address] = omniIntent.split(/:(.*)/s);
  let message = "";

  if (format === "nep245") {
    const [mt_contract, token_id] = address.split(":");
    message = JSON.stringify({
      deadline: new Date(Date.now() + 60_000).toISOString(),
      signer_id: intentAccount,
      intents: [
        {
          intent: "mt_withdraw",
          amounts: [amount.toString()],
          receiver_id: OMNI_HOT_V2,
          token_ids: [token_id],
          token: mt_contract,
          memo: receiverAddr,
        },
      ],
    });
  }

  if (format === "nep141") {
    message = JSON.stringify({
      deadline: new Date(Date.now() + 60_000).toISOString(),
      signer_id: intentAccount,
      intents: [
        {
          intent: address === "native" ? "native_withdraw" : "ft_withdraw",
          token: address === "native" ? undefined : address,
          receiver_id: receiverAddr,
          amount: amount.toString(),
        },
      ],
    });
  }

  if (message === "") throw `Unsupported intent format ${format}`;

  const nonce = Buffer.from(randomBytes(32));
  return { nonce: nonce.toString("base64"), message };
};
