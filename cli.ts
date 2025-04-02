import "dotenv/config";
import { Command } from "commander";

import NearSigner from "./src/signers/NearSigner";
import EvmSigner from "./src/signers/EvmSigner";
import SolanaSigner from "./src/signers/SolanaSigner";
import StellarSigner from "./src/signers/StellarSigner";
import TonSigner from "./src/signers/TonSigner";

import OmniService from "./src/bridge";
import { Network, networks } from "./src/chains";
import { OmniToken } from "./src/tokens";

const env = process.env as any;
const omni = new OmniService({
  near: new NearSigner(env.NEAR_ACCONT_ID, env.NEAR_PRIVATE_KEY),
  ton: env.TON_PRIVATE_KEY ? new TonSigner(env.TON_PRIVATE_KEY, env.TON_WALLET_TYPE, env.TON_API_KEY) : undefined,
  stellar: env.STELLAR_PRIVATE_KEY ? new StellarSigner(env.STELLAR_PRIVATE_KEY, env.HORIZON_RPC, env.SOROBAN_RPC) : undefined,
  solana: env.SOLANA_PRIVATE_KEY ? new SolanaSigner(env.SOLANA_PRIVATE_KEY, [env.SOLANA_RPC]) : undefined,
  evm: env.EVM_PRIVATE_KEY ? new EvmSigner(env.EVM_PRIVATE_KEY) : undefined,
});

const program = new Command();
program.name("omni-cli").description("CLI utility for HOT Bridge").version("1.0.0");

program
  .command("deposit")
  .description("Deposit tokens to HOT Bridge")
  .option("--token <token>", "Token to withdraw (usdc, usdt, bnb, sol, ton, eth...)")
  .option("--chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--amount <amount>", "Amount to withdraw")
  .action(async (options) => {
    try {
      const token = new OmniToken(options.token.toUpperCase());
      const chain = isNaN(Number(options.chain)) ? networks.find((n) => n.key === options.chain)?.id : (Number(options.chain) as Network);
      if (!chain) throw new Error(`Chain ${options.chain} not found`);

      const balanceBefore = await omni.getBalance(token.intent(chain));
      console.log("Balance Before:", token.format(chain, balanceBefore));

      await omni.depositToken(...token.input(chain, Number(options.amount)));

      console.log("Deposit successful");
      const balanceAfter = await omni.getBalance(token.intent(chain));
      console.log("Balance After:", token.format(chain, balanceAfter));
    } catch (error) {
      console.error("Deposit failed:", error);
      process.exit(1);
    }
  });

program
  .command("withdraw")
  .description("Withdraw tokens from HOT Bridge")
  .option("--token <token>", "Token to withdraw (usdc, usdt, bnb, sol, ton, eth...)")
  .option("--chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--amount <amount>", "Amount to withdraw")
  .action(async (options) => {
    try {
      const token = new OmniToken(options.token.toUpperCase());
      const chain = isNaN(Number(options.chain)) ? networks.find((n) => n.key === options.chain)?.id : (Number(options.chain) as Network);
      if (!chain) throw new Error(`Chain ${options.chain} not found`);

      const balanceBefore = await omni.getBalance(token.intent(chain));
      console.log("Balance Before:", token.format(chain, balanceBefore));

      await omni.withdrawToken(...token.input(chain, Number(options.amount)));

      console.log("Withdrawal successful");
      const balanceAfter = await omni.getBalance(token.intent(chain));
      console.log("Balance After:", token.format(chain, balanceAfter));
    } catch (error) {
      console.error("Withdrawal failed:", error);
      process.exit(1);
    }
  });

program
  .command("swap")
  .description("Swap tokens on HOT Bridge")
  .option("--token <token>", "Token to swap (usdc, usdt, bnb, sol, ton, eth...)")
  .option("--from <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--to <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--amount <amount>", "Amount to swap")
  .action(async (options) => {
    try {
      const token = new OmniToken(options.token.toUpperCase());

      const chainFrom = isNaN(Number(options.from)) ? networks.find((n) => n.key === options.from)?.id : (Number(options.from) as Network);
      if (!chainFrom) throw new Error(`Chain ${options.from} not found`);

      const chainTo = isNaN(Number(options.to)) ? networks.find((n) => n.key === options.to)?.id : (Number(options.to) as Network);
      if (!chainTo) throw new Error(`Chain ${options.to} not found`);

      await omni.swapToken(token.intent(chainFrom), token.intent(chainTo), Number(options.amount));

      console.log("================================================");
      console.log("Swap successful");

      const balanceFrom = await omni.getBalance(token.intent(chainFrom));
      const balanceTo = await omni.getBalance(token.intent(chainTo));
      console.log("Balance From:", token.format(chainFrom, balanceFrom));
      console.log("Balance To:", token.format(chainTo, balanceTo));
    } catch (error) {
      console.error("Swap failed:", error);
      process.exit(1);
    }
  });

program
  .command("balance")
  .description("Get HOT Bridge balance")
  .option("-t, --token <token>", "Token to withdraw (usdc, usdt, bnb, sol, ton, eth...)")
  .option("-c, --chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .action(async (options) => {
    try {
      const token = new OmniToken(options.token.toUpperCase());
      const chain = isNaN(Number(options.chain)) ? networks.find((n) => n.key === options.chain)?.id : (Number(options.chain) as Network);
      if (!chain) throw new Error(`Chain ${options.chain} not found`);

      const balance = await omni.getBalance(token.intent(chain));
      console.log("Balance:", token.format(chain, balance));
    } catch (error) {
      console.error("Failed to get balances:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);
