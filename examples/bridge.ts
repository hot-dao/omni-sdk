import "dotenv/config";
import { EvmSigner, Network, TokenId } from "@hot-wallet/omni-sdk";
import { TonSigner, NearSigner, OmniService, SolanaSigner } from "@hot-wallet/omni-sdk";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});

const finishWithdrawals = async () => {
  const pendings = await omni.getActiveWithdrawals();
  for (let pending of pendings) {
    await omni.finishWithdrawal(pending.nonce);
  }
};

const bridgeUsdtFromNearToBnb = async () => {
  const USDT = omni.token(TokenId.USDT);
  console.log("Bnb USDT:", await USDT.balance(Network.Bnb)); // Bnb USDT balance
  console.log("NEAR USDT:", await USDT.balance(Network.Near)); // OMNI USDT balance
  console.log("NEAR native:", (await omni.signers.near.getAccountBalance()).available); // Bnb USDT balance

  const input = await USDT.input(Network.Near, 1);
  await omni.depositToken(input); // USDT from TON to OMNI

  console.log("NEAR USDT", await USDT.balance(Network.Near)); // NEAR USDT balance -1
  console.log("OMNI USDT", await USDT.balance(Network.Hot)); // OMNI USDT balance +1

  const output = await USDT.output(Network.Bnb, 1);
  await omni.withdrawToken(output); // USDT from OMNI to Base

  console.log("OMNI USDT", await USDT.balance(Network.Hot)); // HOT USDT balance -1
  console.log("Bnb USDT", await USDT.balance(Network.Bnb)); // Bnb USDT balance +1

  await finishWithdrawals();
};

bridgeUsdtFromNearToBnb();
