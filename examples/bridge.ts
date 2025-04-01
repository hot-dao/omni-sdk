import "dotenv/config";
import { EvmSigner } from "@hot-wallet/omni-sdk";
import { TonSigner, NearSigner, OmniService, StellarSigner, SolanaSigner } from "@hot-wallet/omni-sdk";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY),
  stellar: new StellarSigner(env.STELLAR_PRIVATE_KEY, env.HORIZON_RPC, env.SOROBAN_RPC),
  solana: new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]),
  evm: new EvmSigner(env.EVM_PRIVATE_KEY),
});

const bridgeUsdtFromNearToBnb = async () => {};

bridgeUsdtFromNearToBnb();
