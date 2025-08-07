import * as sol from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";

import OmniService from "../bridge";
import { Network, PendingDeposit } from "../types";
import { omniEphemeralReceiver, parseAmount, wait } from "../utils";

import AdvancedConnection from "./provider";
import { findDepositAddress, PROGRAM_ID } from "./helpers";
import IDL from "./idl.json";
import { ReviewFee } from "../fee";
import { DepositAlreadyClaimed, DepositNotFound } from "../errors";

class SolanaOmniService {
  public connection: sol.Connection;

  constructor(readonly omni: OmniService, rpc?: string[] | sol.Connection) {
    this.connection = rpc instanceof sol.Connection ? rpc : new AdvancedConnection(rpc || ["https://api.mainnet-beta.solana.com"]);
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee(): Promise<ReviewFee> {
    const needNative = BigInt(parseAmount(0.005, 9));
    const realGas = BigInt(parseAmount(0.0002, 9));
    return new ReviewFee({ reserve: needNative, baseFee: realGas, chain: Network.Solana });
  }

  // TODO: Compute gas dinamically
  async getDepositFee(): Promise<ReviewFee> {
    const needNative = BigInt(parseAmount(0.005, 9));
    return new ReviewFee({ reserve: needNative, chain: Network.Solana, baseFee: needNative / 10n });
  }

  async isWithdrawUsed(nonce: string, receiver: string) {
    const env = this.env(receiver);
    const state: any = await env.program.account.user.fetch(env.userAccount);
    return BigInt(nonce) <= BigInt(state.lastWithdrawNonce.toString());
  }

  env(receiver: string) {
    const [userAccount, userBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("user", "utf8"), new sol.PublicKey(receiver).toBytes()], PROGRAM_ID);

    const [stateAccount, stateBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);
    const program = new anchor.Program(IDL as any, PROGRAM_ID, { connection: this.connection });
    return { program, PROGRAM_ID, userAccount, userBump, stateAccount, stateBump };
  }

  async getTokenBalance(token: string, address?: string) {
    const [stateAccount] = address ? [new sol.PublicKey(address)] : sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);

    if (token === "native") {
      const balance = await this.connection.getBalance(stateAccount);
      return BigInt(balance);
    }

    const ATA = getAssociatedTokenAddressSync(new sol.PublicKey(token), stateAccount, true);
    const meta = await this.connection.getTokenAccountBalance(ATA);
    return BigInt(meta.value.amount);
  }

  async getLastDepositNonce(sender: string) {
    const env = this.env(sender);
    const state: any = await env.program.account.user.fetch(env.userAccount).catch(() => ({ lastDepositNonce: null }));
    if (!state.lastDepositNonce) return null;
    const nonce = BigInt(state.lastDepositNonce.toString());
    return nonce;
  }

  async getLastWithdrawNonce(receiver: string) {
    const env = this.env(receiver);
    const isExist = await this.connection.getAccountInfo(env.userAccount);
    if (!isExist) return 0n;

    const state: any = await env.program.account.user.fetch(env.userAccount);
    return BigInt(state?.lastWithdrawNonce || 0n);
  }

  async parseDeposit(hash: string): Promise<PendingDeposit> {
    const waitReceipt = async (attemps = 0): Promise<sol.ParsedTransactionWithMeta | null> => {
      const status = await this.connection.getParsedTransaction(hash, { commitment: "confirmed" });
      if (status || attemps > 2) return status || null;
      await wait(3000);
      return await waitReceipt(attemps + 1);
    };

    const status = await waitReceipt();
    const logMessages = status?.meta?.logMessages;
    if (status == null || logMessages == null) throw new DepositNotFound(Network.Solana, hash, "no tx receipt yet");

    const nonce = logMessages.map((t) => t.match(/nonce (\d+)/)?.[1]).find((t) => t != null);
    const amount = logMessages.map((t) => t.match(/amount: (\d+)/)?.[1]).find((t) => t != null);
    const receiverHex = logMessages.map((t) => t.match(/to ([0-9A-Fa-f]+)/)?.[1]).find((t) => t != null);
    const token = logMessages.find((t) => t.includes("NativeDeposit")) ? "native" : logMessages.map((t) => t.match(/mint: (.+),/)?.[1]).find((t) => t != null);
    if (nonce == null || receiverHex == null || amount == null || token == null) throw new DepositNotFound(Network.Solana, hash, "no tx receipt yet");

    const timestamp = (status.blockTime || 0) * 1000;
    const receiver = baseEncode(Buffer.from(receiverHex, "hex"));
    const sender = status.transaction.message.accountKeys.find((t) => t.signer)!.pubkey.toBase58();

    return { tx: hash, amount, nonce, receiver, chain: Network.Solana, timestamp, token, sender };
  }

  async clearDepositNonceIfNeeded({ deposit, sender, sendTransaction }: { deposit: PendingDeposit; sender: string; sendTransaction: (tx: sol.TransactionInstruction[]) => Promise<string> }) {
    const isUsed = await this.omni.isDepositUsed(Network.Solana, deposit.nonce);
    if (!isUsed) throw "You have not completed the previous deposit";

    const receiver = Buffer.from(deposit.receiver, "hex");
    const bnAmount = new anchor.BN(deposit.amount.toString());
    const bnNonce = new anchor.BN(deposit.nonce.toString());

    const mint = deposit.token === "native" ? sol.PublicKey.default : new sol.PublicKey(deposit.token);
    const [depositAddress] = findDepositAddress(BigInt(deposit.nonce), new sol.PublicKey(sender), receiver, mint, BigInt(deposit.amount));

    const isExist = await this.connection.getAccountInfo(depositAddress, { commitment: "confirmed" });
    if (isExist == null) throw "Deposit nonce account not found";

    const env = this.env(deposit.receiver);
    const builder = env.program.methods.clearDepositInfo(Array.from(receiver), mint, bnAmount, bnNonce).accounts({
      systemProgram: sol.SystemProgram.programId,
      state: env.stateAccount.toBase58(),
      deposit: depositAddress,
      sender,
    });

    const instruction = await builder.instruction();
    await sendTransaction([instruction]);
  }

  async deposit(args: { token: string; amount: bigint; sender: string; intentAccount: string; sendTransaction: (tx: sol.TransactionInstruction[]) => Promise<string> }): Promise<string> {
    this.omni.api.registerDeposit(args.intentAccount);
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const lastDeposit = await this.getLastDepositNonce(args.sender);
    const env = this.env(args.sender);

    const builder = env.program.methods.generateDepositNonce(env.userBump);
    builder.accountsStrict({
      user: env.userAccount.toBase58(),
      state: env.stateAccount.toBase58(),
      systemProgram: sol.SystemProgram.programId,
      sender: args.sender,
    });

    await args.sendTransaction([await builder.instruction()]);

    const waitNewNonce = async () => {
      const newNonce = await this.getLastDepositNonce(args.sender).catch(() => lastDeposit);
      if (newNonce === lastDeposit) return await waitNewNonce();
      if (newNonce == null) return await waitNewNonce();
      return newNonce;
    };

    const nonce = await waitNewNonce();
    const amt = new anchor.BN(args.amount.toString());

    if (args.token === "native") {
      const [depositAddress, depositBump] = findDepositAddress(nonce, new sol.PublicKey(args.sender), receiver, sol.PublicKey.default, args.amount);
      const depositBuilder = env.program.methods.nativeDeposit(receiver, amt, depositBump);
      depositBuilder.accountsStrict({
        user: env.userAccount.toBase58(),
        state: env.stateAccount.toBase58(),
        systemProgram: sol.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        deposit: depositAddress,
        sender: args.sender,
      });

      const instruction = await depositBuilder.instruction();
      return await args.sendTransaction([instruction]);
    }

    const mint = new sol.PublicKey(args.token);
    const [depositAddress, depositBump] = findDepositAddress(nonce, new sol.PublicKey(args.sender), receiver, mint, args.amount);
    const instructions: sol.TransactionInstruction[] = [];

    const contractATA = getAssociatedTokenAddressSync(mint, env.stateAccount, true);
    const isContractATAExist = await getAccount(this.connection, contractATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);

    if (!isContractATAExist) {
      const createATA = createAssociatedTokenAccountInstruction(new sol.PublicKey(args.sender), contractATA, env.stateAccount, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      instructions.push(createATA);
    }

    const depositBuilder = env.program.methods.tokenDeposit(receiver, amt, depositBump);
    depositBuilder.accountsStrict({
      user: env.userAccount.toBase58(),
      state: env.stateAccount.toBase58(),
      systemProgram: sol.SystemProgram.programId,
      smcTokenAccount: getAssociatedTokenAddressSync(mint, env.stateAccount, true),
      senderTokenAccount: getAssociatedTokenAddressSync(mint, new sol.PublicKey(args.sender)),
      tokenProgram: TOKEN_PROGRAM_ID,
      deposit: depositAddress,
      sender: args.sender,
    });

    const instruction = await depositBuilder.instruction();
    instructions.push(instruction);
    return await args.sendTransaction(instructions);
  }

  async withdraw(args: { nonce: string; amount: bigint; token: string; receiver: string; sender: string; sendTransaction: (tx: sol.TransactionInstruction[]) => Promise<string> }) {
    const signature = await this.omni.api.withdrawSign(args.nonce);
    const sign = Array.from(baseDecode(signature));
    const env = this.env(args.receiver);

    if (args.token === "native") {
      const instructionBuilder = env.program.methods.nativeWithdraw(sign, new anchor.BN(args.nonce), new anchor.BN(args.amount.toString()), env.userBump);

      instructionBuilder.accountsStrict({
        user: env.userAccount,
        state: env.stateAccount,
        receiver: args.receiver,
        systemProgram: sol.SystemProgram.programId,
        sender: args.sender,
      });

      const instruction = await instructionBuilder.instruction();
      const hash = await args.sendTransaction([instruction]);
      return hash;
    }

    const owner = new sol.PublicKey(args.sender);
    const mint = new sol.PublicKey(args.token);
    const instructions = [];

    const ATA = getAssociatedTokenAddressSync(mint, owner);
    const isExist = await getAccount(this.connection, ATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);
    if (!isExist) {
      const createATA = createAssociatedTokenAccountInstruction(owner, ATA, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      instructions.push(createATA);
    }

    const contractATA = getAssociatedTokenAddressSync(mint, env.stateAccount, true);
    const isContractATAExist = await getAccount(this.connection, contractATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);
    if (!isContractATAExist) {
      const createATA = createAssociatedTokenAccountInstruction(owner, contractATA, env.stateAccount, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      instructions.push(createATA);
    }

    const instructionBuilder = env.program.methods.tokenWithdraw(sign, new anchor.BN(args.nonce), new anchor.BN(args.amount.toString()), new sol.PublicKey(args.sender), env.userBump);

    instructionBuilder.accountsStrict({
      smcTokenAccount: getAssociatedTokenAddressSync(mint, env.stateAccount, true),
      systemProgram: sol.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      user: env.userAccount,
      state: env.stateAccount,
      receiverTokenAccount: ATA,
      sender: owner,
    });

    instructions.push(await instructionBuilder.instruction());
    const hash = await args.sendTransaction(instructions);
    return hash;
  }
}

export default SolanaOmniService;
