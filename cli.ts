import "dotenv/config";
import { Command } from "commander";
import { uniq, cloneDeep } from "lodash";

import NearSigner from "./src/signers/NearSigner";
import EvmSigner from "./src/signers/EvmSigner";
import SolanaSigner from "./src/signers/SolanaSigner";
import StellarSigner from "./src/signers/StellarSigner";
import TonSigner from "./src/signers/TonSigner";

import OmniService from "./src/bridge";
import { Network, networks, Chains } from "./src/chains";
import { formatAmount, getOmniAddress, toOmniIntent, wait } from "./src/utils";
import { OmniToken, omniTokens } from "./src/tokens";

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

      const canDeposit = await omni.getDepositFee(chain, token.address(chain));
      if (canDeposit.isNotEnough) {
        console.log("Not enough balance to deposit, need:", canDeposit.need);
        process.exit(1);
      }

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

program
  .command("profile")
  .description("Get user profile")
  .option("-c, --chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("-a, --address <address>", "Address")
  .option("-t, --token <token>", "Token")
  .action(async (options) => {
    try {
      await wait(1000);
      const selectedChain = isNaN(Number(options.chain))
        ? networks.find((n) => n.key === options.chain)?.id
        : (Number(options.chain) as Network);

      const allChains = uniq(Object.entries(omniTokens).flatMap(([_, chains]) => Object.keys(chains)));
      const chains = (selectedChain ? [selectedChain] : allChains).sort((a, b) => Chains.get(+a).isEvm - Chains.get(+b).isEvm);

      let tokens = cloneDeep(omniTokens);
      if (options.token) tokens = { [options.token.toUpperCase()]: tokens[options.token.toUpperCase()] };

      const render = async (chain: Network) => {
        if (Object.entries(tokens).some(([_, chains]) => Object.keys(chains || {}).length === 0)) return;
        const address = options.address || omni.getAddress(chain);
        if (!address) return;

        console.log("");
        console.log(`${Chains.get(chain).name}: ${address}`);

        for (const [id, chains] of Object.entries(tokens)) {
          for (const [tokenChain, token] of Object.entries(chains || {})) {
            if (chain !== +tokenChain) continue;
            try {
              const balance = await omni.getTokenBalance(+tokenChain, token.address, address);
              console.log(`> Balance ${id}: ${formatAmount(balance, token.decimal)}`);
            } catch {}
          }
        }
      };

      for (const network of chains) {
        await render(+network);
      }

      console.log("");
      console.log(`HOT Bridge: ${getOmniAddress(omni.near.address)}`);

      for (const [id, chains] of Object.entries(tokens)) {
        for (const [chain, token] of Object.entries(chains || {})) {
          try {
            const liquidity = await omni.getBalance(toOmniIntent(chain, token.address), options.address).catch(() => 0n);
            console.log(`> Intent ${Chains.get(+chain).name}_${id}: ${formatAmount(liquidity, token.decimal)}`);
          } catch {}
        }
        console.log("--------------------------------");
      }
    } catch (error) {
      console.error("Failed to get balances:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);
