import "dotenv/config";
import { Command } from "commander";

import OmniBridge from "../src/bridge";
import { Network, Chains } from "../src/chains";

import NearSigner from "./signers/NearSigner";
import TonSigner from "./signers/TonSigner";
import SolanaSigner from "./signers/SolanaSigner";
import EvmSigner from "./signers/EvmSigner";
import StellarSigner from "./signers/StellarSigner";

const env = process.env as any;
const omni = new OmniBridge({
  logger: console,
  tonApiKey: env.TON_API_KEY,
  executeNearTransaction: async (tx) => {
    return { sender: "", hash: "" };
  },
});

const createSignerInstance = (chain: Network, privateKey: string, accountId?: string) => {
  if (chain === Network.Near) return new NearSigner(accountId!, privateKey);
  if (chain === Network.Ton) return new TonSigner(privateKey, "v5r1", env.TON_API_KEY);
  if (chain === Network.Solana) return new SolanaSigner(privateKey, []);
  if (chain === Network.Stellar) return new StellarSigner(privateKey);
  if (Chains.get(chain).isEvm) return new EvmSigner(privateKey);
  throw new Error(`Unsupported chain: ${chain}`);
};

const createSigner = (chain: Network, privateKey: string, accountId?: string) => {
  const instance = createSignerInstance(chain, privateKey, accountId);
  return {
    getIntentAccount: async () => await instance.getIntentAccount(),
    signIntent: async (intent: any) => await instance.signIntent(intent),
    sendTransaction: async (tx: any) => await instance.sendTransaction(tx),
    getAddress: async () => await instance.getAddress(),
  };
};

const program = new Command();
program.name("omni-cli").description("CLI utility for HOT Bridge").version("1.0.0");

program
  .command("deposit")
  .description("Deposit tokens to HOT Bridge")
  .option("--token <token>", "Token to withdraw (usdc, usdt, bnb, sol, ton, eth...)")
  .option("--chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--amount <amount>", "Amount to withdraw")
  .option("--private-key <private-key>", "Private key")
  .option("--near-account-id <near-account-id>", "Near account id")
  .action(async (options) => {
    const chain = +options.chain;
    const signer = createSigner(chain, options.privateKey, options.nearAccountId);

    const balanceBefore = await omni.getTokenBalance(chain, options.token, await signer.getAddress());
    console.log("Balance Before:", balanceBefore);

    if (chain === Network.Near) {
      await omni.near.depositToken({ token: options.token, amount: BigInt(options.amount), ...signer });
    }

    if (chain === Network.Ton) {
      const deposit = await omni.ton.deposit({ token: options.token, amount: BigInt(options.amount), ...signer });
      await omni.finishDeposit(deposit); // Processed by near relayer
      await omni.ton.clearDepositNonceIfNeeded({ deposit: deposit, ...signer }); // Optional
    }

    if (chain === Network.Solana) {
      const deposit = await omni.solana.deposit({ token: options.token, amount: BigInt(options.amount), ...signer });
      await omni.finishDeposit(deposit); // Processed by near relayer
      await omni.solana.clearDepositNonceIfNeeded({ deposit: deposit, ...signer }); // Optional
    }

    if (chain === Network.Stellar) {
      const deposit = await omni.stellar.deposit({ token: options.token, amount: BigInt(options.amount), ...signer });
      await omni.finishDeposit(deposit); // Processed by near relayer
    }

    if (Chains.get(chain).isEvm) {
      const deposit = await omni.evm.deposit({ chain: chain, token: options.token, amount: BigInt(options.amount), ...signer });
      await omni.finishDeposit(deposit); // Processed by near relayer
    }

    console.log("Deposit successful");
    const balanceAfter = await omni.getTokenBalance(chain, options.token, "");
    console.log("Balance After:", balanceAfter);
  });

program
  .command("withdraw")
  .description("Withdraw tokens from HOT Bridge")
  .option("--token <token>", "Token to withdraw (usdc, usdt, bnb, sol, ton, eth...)")
  .option("--chain <chain>", "Chain ID (e.g., number id (1, 56 and etc) or name (near, solana, ton, stellar))")
  .option("--amount <amount>", "Amount to withdraw")
  .option("--receiver <receiver>", "Receiver address")
  .option("--private-key <private-key>", "Private key")
  .option("--near-account-id <near-account-id>", "Near account id")
  .action(async (options) => {
    const chain = +options.chain;
    const signer = createSigner(chain, options.privateKey, options.nearAccountId);
    const receiver = options.receiver || (await signer.getAddress());

    const balanceBefore = await omni.getTokenBalance(chain, options.token, receiver);
    console.log("Balance Before:", balanceBefore);

    // For withdraw on NEAR, it will return null
    const withdraw = await omni.withdrawToken({ chain, token: options.token, amount: BigInt(options.amount), receiver, ...signer });

    if (withdraw) {
      const args = { ...withdraw, ...signer };
      if (chain === Network.Ton) await omni.ton.withdraw(args);
      if (chain === Network.Solana) await omni.solana.withdraw(args);
      if (chain === Network.Stellar) await omni.stellar.withdraw(args);
      if (Chains.get(chain).isEvm) await omni.evm.withdraw(args);
    }

    console.log("Withdrawal successful");
    const balanceAfter = await omni.getTokenBalance(chain, options.token, "");
    console.log("Balance After:", balanceAfter);
  });

program.parse(process.argv);
