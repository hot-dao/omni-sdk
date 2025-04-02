import { baseEncode } from "@near-js/utils";
import { randomBytes } from "tweetnacl";

import NearSigner from "./signers/NearSigner";
import { fromOmni, Logger, TGAS } from "./utils";
import { Network } from "./chains";
import OmniService from "./bridge";

export const withdrawIntentAction = async (near: NearSigner, omniIntent: string, amount: bigint, receiverAddr: string) => {
  const [_, mt_contract, token_id] = omniIntent.split(":");
  const message = JSON.stringify({
    deadline: new Date(Date.now() + 60_000).toISOString(),
    signer_id: near.accountId,
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
  const { signature, publicKey } = await near.signMessage({ message: message, nonce, recipient: "intents.near" });
  return {
    standard: "nep413",
    payload: { nonce: nonce.toString("base64"), recipient: "intents.near", message },
    signature: "ed25519:" + baseEncode(Buffer.from(signature, "base64")),
    public_key: publicKey,
  };
};

export const signIntentAction = async (near: NearSigner, qoute: { nonce: string; [k: string]: any }) => {
  const message = JSON.stringify(qoute);
  const { signature, publicKey } = await near.signMessage({
    nonce: Buffer.from(qoute.nonce, "base64"),
    recipient: "intents.near",
    message: message,
  });

  return {
    standard: "nep413",
    payload: { nonce: qoute.nonce, recipient: "intents.near", message },
    signature: "ed25519:" + baseEncode(Buffer.from(signature, "base64")),
    public_key: publicKey,
  };
};

export class IntentsService {
  constructor(readonly omni: OmniService) {}

  async getBalances(tokens: string[], address: string) {
    const balances = await this.omni.near.viewFunction({
      args: { token_ids: tokens, account_id: address },
      methodName: "mt_batch_balance_of",
      contractId: "intents.near",
    });

    return tokens.reduce((acc, id, index) => {
      acc[id] = BigInt(balances[index] || 0n);
      return acc;
    }, {} as Record<string, bigint>);
  }

  async registerIntents() {
    const publicKey = this.omni.near.signer.publicKey.toString();
    const keys = await this.omni.near.viewFunction({
      args: { account_id: this.omni.near.accountId },
      methodName: "public_keys_of",
      contractId: "intents.near",
    });

    if (!keys.includes(publicKey)) {
      await this.omni.near?.functionCall({
        args: { public_key: publicKey },
        contractId: "intents.near",
        methodName: "add_public_key",
        attachedDeposit: 1n,
        gas: 80n * TGAS,
      });
    }
  }

  async withdrawIntent(token: string, amount: bigint, receiverAddr: string, logger: Logger): Promise<string> {
    logger.log(`Call withdrawIntent ${token} ${amount} ${receiverAddr}`);

    const [chain, address] = fromOmni(token).split(":");
    if (+chain === Network.Near) {
      logger.log(`Checking if token ${token} is not registered`);
      const call = await this.omni.near.getRegisterTokenTrx(address);
      if (call) {
        logger.log(`Registering token ${token}`);
        await this.omni.near.callTransaction(call);
      }
    }

    logger.log(`Registering intents`);
    await this.registerIntents();

    logger.log(`Building intent`);
    const intent = await withdrawIntentAction(this.omni.near, token, amount, receiverAddr);

    logger.log(`Executing intent`);
    return await this.omni.near.callTransaction({
      receiverId: "intents.near",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "execute_intents",
            args: { signed: [intent] },
            gas: String(300n * TGAS),
            deposit: "0",
          },
        },
      ],
    });
  }
}
