import * as sol from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { baseDecode, baseEncode } from "@near-js/utils";
import { ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import OmniService from "../bridge";
import { parseAmount, wait } from "../utils";
import { Network, PendingDeposit, WithdrawArgs } from "../types";
import { DepositNotFoundError } from "../errors";
import { ReviewFee } from "../fee";

import AdvancedConnection from "./provider";
import IDL from "./idl.json";

export class SolanaOmniService {
  public connection: sol.Connection;
  public programId: sol.PublicKey;

  constructor(readonly omni: OmniService, options: { rpc?: string[] | sol.Connection; programId?: string }) {
    this.connection = options.rpc instanceof sol.Connection ? options.rpc : new AdvancedConnection(options.rpc || ["https://api.mainnet-beta.solana.com"]);
    this.programId = new sol.PublicKey(options.programId || "8sXzdKW2jFj7V5heRwPMcygzNH3JZnmie5ZRuNoTuKQC");
  }

  findContractStateAddress(): [sol.PublicKey, number] {
    return sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], this.programId);
  }

  findDepositAddress(nonce: bigint, sender: sol.PublicKey, receiver: Buffer, mint: sol.PublicKey, amount: bigint): [sol.PublicKey, number] {
    return sol.PublicKey.findProgramAddressSync(
      [
        Buffer.from("deposit", "utf8"), //
        new BN(nonce.toString()).toBuffer("be", 16),
        sender.toBytes(),
        receiver,
        mint.toBytes(),
        new BN(amount.toString()).toBuffer("be", 8),
      ],
      this.programId
    );
  }

  findUserAddress(receiver: sol.PublicKey): [sol.PublicKey, number] {
    return sol.PublicKey.findProgramAddressSync([Buffer.from("user", "utf8"), receiver.toBytes()], this.programId);
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee(): Promise<ReviewFee> {
    const needNative = BigInt(parseAmount(0.005, 9));
    const realGas = BigInt(parseAmount(0.0002, 9));
    return new ReviewFee({ reserve: needNative, baseFee: realGas, chain: Network.Solana });
  }

  // TODO: Compute gas dinamically
  async getDepositFee(token: string): Promise<ReviewFee> {
    const reserve = BigInt(parseAmount(0.0005, 9));
    return new ReviewFee({ reserve, chain: Network.Solana, baseFee: reserve / 10n });
  }

  async isWithdrawUsed(nonce: string, receiver: string) {
    const env = this.env(receiver);
    const state: any = await env.program.account.user.fetch(env.userAccount);
    return BigInt(nonce) <= BigInt(state.lastWithdrawNonce.toString());
  }

  env(receiver: string) {
    const [userAccount, userBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("user", "utf8"), new sol.PublicKey(receiver).toBytes()], this.programId);

    const [stateAccount, stateBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], this.programId);
    const program = new anchor.Program(IDL as any, this.programId, { connection: this.connection });
    return { program, programId: this.programId, userAccount, userBump, stateAccount, stateBump };
  }

  async getLiquidity(token: string) {
    const [trasary] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], this.programId);
    return await this.getTokenBalance(token, trasary.toString());
  }

  async getTokenBalance(token: string, address: string) {
    const [stateAccount] = [new sol.PublicKey(address)];

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
    if (status == null || logMessages == null) throw new DepositNotFoundError(Network.Solana, hash, "no tx receipt yet");

    const nonce = logMessages.map((t) => t.match(/nonce (\d+)/)?.[1]).find((t) => t != null);
    const amount = logMessages.map((t) => t.match(/amount: (\d+)/)?.[1]).find((t) => t != null);
    const receiverHex = logMessages.map((t) => t.match(/to ([0-9A-Fa-f]+)/)?.[1]).find((t) => t != null);
    const token = logMessages.find((t) => t.includes("NativeDeposit")) ? "native" : logMessages.map((t) => t.match(/mint: (.+),/)?.[1]).find((t) => t != null);
    if (nonce == null || receiverHex == null || amount == null || token == null) throw new DepositNotFoundError(Network.Solana, hash, "no tx receipt yet");

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
    const [depositAddress] = this.findDepositAddress(BigInt(deposit.nonce), new sol.PublicKey(sender), receiver, mint, BigInt(deposit.amount));

    const isExist = await this.connection.getAccountInfo(depositAddress, { commitment: "confirmed" });
    if (isExist == null) throw new DepositNotFoundError(Network.Solana, deposit.tx, "Deposit nonce account not found");

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

  async withdraw(args: WithdrawArgs & { sender: string; sendTransaction: (tx: sol.TransactionInstruction[]) => Promise<string> }) {
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
