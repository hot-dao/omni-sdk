import "dotenv/config";
import { EvmSigner, Network, OmniToken, OmniGroup } from "@hot-wallet/omni";
import { TonSigner, NearSigner, StellarSigner, OmniService, SolanaSigner } from "@hot-wallet/omni";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  stellar: new StellarSigner(env.STELLAR_PRIVATE_KEY, env.HORIZON_RPC, env.SOROBAN_RPC),
  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});

// Simple bridge
const ton = new OmniToken(OmniGroup.TON); // builder
await omni.depositToken(...ton.input(Network.Ton, 1));

console.log("Omni TON", await omni.getBalance(ton.intent(Network.Ton)));
await omni.withdrawToken(...ton.input(Network.Bnb, 1));

// Intent swap
const usdc = new OmniToken(OmniGroup.USDC);
await omni.depositToken(...usdc.input(Network.Base, 1));
await omni.swapToken(usdc.intent(Network.Base), usdc.intent(Network.Arbitrum), 1);

console.log("Omni USDC on Arb", await omni.getBalance(ton.intent(Network.Arbitrum)));
await omni.withdrawToken(...ton.input(Network.Arbitrum, 1));
