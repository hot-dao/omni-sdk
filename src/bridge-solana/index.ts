import * as sol from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { baseDecode, baseEncode } from "@near-js/utils";
import AdvancedConnection from "solana-advanced-connection";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

import { bigIntMax, getOmniAddressHex, parseAmount, wait } from "../utils";
import { Chains, Network } from "../chains";
import { PendingDeposit } from "../types";
import OmniService from "../bridge";

import { findDepositAddress, PROGRAM_ID } from "./helpers";
import IDL from "./idl.json";

class SolanaOmniService {
  constructor(readonly omni: OmniService) {}

  get solana() {
    if (this.omni.signers.solana == null) throw "Connect SOLANA";
    return this.omni.signers.solana;
  }

  get connection() {
    return new AdvancedConnection(this.solana.rpcs);
  }

  async isNonceUsed(nonce: string, receiver: string) {
    try {
      const env = this.env(receiver);
      const state: any = await env.program.account.user.fetch(env.userAccount);
      return BigInt(nonce) <= BigInt(state.lastWithdrawNonce.toString());
    } catch (e) {
      console.error("isNonceUsed", e);
      return false;
    }
  }

  env(receiver: string) {
    const [userAccount, userBump] = sol.PublicKey.findProgramAddressSync(
      [Buffer.from("user", "utf8"), new sol.PublicKey(receiver).toBytes()],
      PROGRAM_ID
    );

    const [stateAccount, stateBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);
    const program = new anchor.Program(IDL as any, PROGRAM_ID, { connection: this.connection });
    return { program, PROGRAM_ID, userAccount, userBump, stateAccount, stateBump };
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee() {
    const address = await this.solana.getAddress();
    const needNative = BigInt(parseAmount(0.005, 9));
    const realGas = BigInt(parseAmount(0.0002, 9));
    const balance = await this.getTokenBalance("native", address);

    if (balance >= needNative)
      return { need: 0n, canPerform: true, amount: realGas, decimal: Chains.get(Network.Solana).decimal, additional: 0n };

    return {
      need: bigIntMax(0n, needNative - balance),
      canPerform: false,
      decimal: Chains.get(Network.Solana).decimal,
      amount: realGas,
      additional: 0n,
    };
  }

  async getDepositFee() {
    const address = await this.solana.getAddress();
    const balance = await this.getTokenBalance("native", address);
    return {
      maxFee: 4_000_000n,
      need: bigIntMax(0n, 4_000_000n - balance),
      isNotEnough: balance < 4_000_000n,
      gasLimit: 200_000n,
      gasPrice: 1n,
      chain: Network.Solana,
    };
  }

  async getTokenBalance(token: string, address?: string) {
    const [stateAccount] = address
      ? [new sol.PublicKey(address)]
      : sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);

    if (token === "native") {
      const balance = await this.connection.getBalance(stateAccount);
      return BigInt(balance);
    }

    const ATA = getAssociatedTokenAddressSync(new sol.PublicKey(token), stateAccount, true);
    const meta = await this.connection.getTokenAccountBalance(ATA);
    return BigInt(meta.value.amount);
  }

  async getLastDepositNonce(receiver: string) {
    const env = this.env(receiver);
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

  async parseDeposit(hash: string) {
    const waitReceipt = async (attemps = 0): Promise<sol.ParsedTransactionWithMeta | null> => {
      const status = await this.connection.getParsedTransaction(hash, { commitment: "confirmed" });
      if (status || attemps > 2) return status || null;
      await wait(3000);
      return await waitReceipt(attemps + 1);
    };

    const status = await waitReceipt();
    const logMessages = status?.meta?.logMessages;
    if (status == null || logMessages == null) throw "no tx receipt yet";

    const nonce = logMessages.map((t) => t.match(/nonce (\d+)/)?.[1]).find((t) => t != null);
    const amount = logMessages.map((t) => t.match(/amount: (\d+)/)?.[1]).find((t) => t != null);
    const receiverHex = logMessages.map((t) => t.match(/to ([0-9A-Fa-f]+)/)?.[1]).find((t) => t != null);
    const token = logMessages.find((t) => t.includes("NativeDeposit"))
      ? "native"
      : logMessages.map((t) => t.match(/mint: (.+),/)?.[1]).find((t) => t != null);
    if (nonce == null || receiverHex == null || amount == null || token == null) throw "no tx receipt yet";

    const timestamp = (status.blockTime || 0) * 1000;
    const receiver = baseEncode(Buffer.from(receiverHex, "hex"));

    const sender = await this.solana.getAddress();
    const deposit = { tx: hash, amount, nonce, receiver, chain: Network.Solana, timestamp, token, sender };
    const isUsed = await this.omni.isDepositUsed(Network.Solana, nonce);

    if (isUsed) {
      await this.clearDepositNonceIfNeeded(deposit);
      throw "Deposit alredy claimed, check your omni balance";
    }

    return this.omni.addPendingDeposit(deposit);
  }

  async clearDepositNonceIfNeeded(deposit: PendingDeposit) {
    const isUsed = await this.omni.isDepositUsed(Network.Solana, deposit.nonce);
    if (!isUsed) throw "You have not completed the previous deposit";

    const receiver = Buffer.from(deposit.receiver, "hex");
    const bnAmount = new anchor.BN(deposit.amount.toString());
    const bnNonce = new anchor.BN(deposit.nonce.toString());

    const sender = await this.solana.getAddress();
    const mint = deposit.token === "native" ? sol.PublicKey.default : new sol.PublicKey(deposit.token);
    const [depositAddress] = findDepositAddress(BigInt(deposit.nonce), new sol.PublicKey(sender), receiver, mint, BigInt(deposit.amount));

    const isExist = await this.connection.getAccountInfo(depositAddress, { commitment: "confirmed" });
    if (isExist == null) return this.omni.removePendingDeposit(deposit);
    const env = this.env(deposit.receiver);

    try {
      const builder = env.program.methods.clearDepositInfo(Array.from(receiver), mint, bnAmount, bnNonce).accounts({
        systemProgram: sol.SystemProgram.programId,
        state: env.stateAccount.toBase58(),
        deposit: depositAddress,
        sender,
      });

      const instruction = await builder.instruction();
      const tx = new sol.Transaction().add(instruction);
      await this.solana.sendTransaction(tx);
    } catch (e) {
      console.error(e);
    }

    this.omni.removePendingDeposit(deposit);
  }

  async deposit(address: string, amount: bigint, to: string) {
    const receiverAddr = getOmniAddressHex(to);
    const receiver = Buffer.from(receiverAddr, "hex");

    const lastDeposit = await this.getLastDepositNonce(to);
    const env = this.env(to);
    const builder = env.program.methods.generateDepositNonce(env.userBump);
    builder.accountsStrict({
      user: env.userAccount.toBase58(),
      state: env.stateAccount.toBase58(),
      sender: await this.solana.getAddress(),
      systemProgram: sol.SystemProgram.programId,
    });

    const tx = new sol.Transaction().add(await builder.instruction());
    await this.solana.sendTransaction(tx);

    const waitNewNonce = async () => {
      const newNonce = await this.getLastDepositNonce(to).catch(() => lastDeposit);
      if (newNonce === lastDeposit) return await waitNewNonce();
      if (newNonce == null) return await waitNewNonce();
      return newNonce;
    };

    const nonce = await waitNewNonce();
    const amt = new anchor.BN(amount.toString());
    if (address === "native") {
      const address = await this.solana.getAddress();
      const [depositAddress, depositBump] = findDepositAddress(nonce, new sol.PublicKey(address), receiver, sol.PublicKey.default, amount);
      const depositBuilder = env.program.methods.nativeDeposit(receiver, amt, depositBump);
      depositBuilder.accountsStrict({
        user: env.userAccount.toBase58(),
        state: env.stateAccount.toBase58(),
        systemProgram: sol.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        deposit: depositAddress,
        sender: address,
      });

      let deposit!: PendingDeposit;
      const instruction = await depositBuilder.instruction();
      const tx = new sol.Transaction().add(instruction);
      const hash = await this.solana.sendTransaction(tx);

      this.omni.addPendingDeposit({
        sender: address,
        receiver: receiverAddr,
        timestamp: Date.now(),
        chain: Network.Solana,
        amount: String(amount),
        token: address,
        nonce: "",
        tx: hash,
      });

      deposit.nonce = nonce.toString();
      this.omni.addPendingDeposit(deposit);
      return deposit;
    }

    const mint = new sol.PublicKey(address); // mint receiver or sender???
    const [depositAddress, depositBump] = findDepositAddress(nonce, mint, receiver, mint, amount);
    const instructions: sol.TransactionInstruction[] = [];

    const contractATA = getAssociatedTokenAddressSync(mint, env.stateAccount, true);
    const isContractATAExist = await getAccount(this.connection, contractATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);

    if (!isContractATAExist) {
      const createATA = createAssociatedTokenAccountInstruction(
        new sol.PublicKey(address),
        contractATA,
        env.stateAccount,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(createATA);
    }

    const depositBuilder = env.program.methods.tokenDeposit(receiver, amt, depositBump);
    depositBuilder.accountsStrict({
      user: env.userAccount.toBase58(),
      state: env.stateAccount.toBase58(),
      systemProgram: sol.SystemProgram.programId,
      smcTokenAccount: getAssociatedTokenAddressSync(mint, env.stateAccount, true),
      senderTokenAccount: getAssociatedTokenAddressSync(mint, new sol.PublicKey(address)),
      tokenProgram: TOKEN_PROGRAM_ID,
      deposit: depositAddress,
      sender: address,
    });

    const instruction = await depositBuilder.instruction();
    instructions.push(instruction);

    let deposit!: PendingDeposit;
    const transaction = new sol.Transaction().add(...instructions);
    const hash = await this.solana.sendTransaction(transaction);

    this.omni.addPendingDeposit({
      sender: address,
      receiver: receiverAddr,
      timestamp: Date.now(),
      chain: Network.Solana,
      nonce: nonce.toString(),
      amount: String(amount),
      token: address,
      tx: hash,
    });

    deposit.nonce = nonce.toString();
    this.omni.addPendingDeposit(deposit);
    return deposit;
  }

  async withdraw(args: { nonce: string; signature: string; amount: bigint; token: string; receiver: string }) {
    const sign = Array.from(baseDecode(args.signature));
    const env = this.env(args.receiver);

    if (args.token === "native") {
      const instructionBuilder = env.program.methods.nativeWithdraw(
        sign,
        new anchor.BN(args.nonce),
        new anchor.BN(args.amount.toString()),
        env.userBump
      );

      instructionBuilder.accountsStrict({
        user: env.userAccount,
        state: env.stateAccount,
        receiver: args.receiver,
        sender: await this.solana.getAddress(),
        systemProgram: sol.SystemProgram.programId,
      });

      const instruction = await instructionBuilder.instruction();
      const tx = new sol.Transaction().add(instruction);
      const hash = await this.solana.sendTransaction(tx);
      return hash;
    }

    const owner = new sol.PublicKey(await this.solana.getAddress());
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
      const createATA = createAssociatedTokenAccountInstruction(
        owner,
        contractATA,
        env.stateAccount,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(createATA);
    }

    const address = await this.solana.getAddress();
    const instructionBuilder = env.program.methods.tokenWithdraw(
      sign,
      new anchor.BN(args.nonce),
      new anchor.BN(args.amount.toString()),
      new sol.PublicKey(address),
      env.userBump
    );

    instructionBuilder.accountsStrict({
      user: env.userAccount,
      state: env.stateAccount,
      receiverTokenAccount: ATA,
      sender: owner,

      smcTokenAccount: getAssociatedTokenAddressSync(mint, env.stateAccount, true),
      systemProgram: sol.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    instructions.push(await instructionBuilder.instruction());
    const transaction = new sol.Transaction().add(...instructions);
    const hash = await this.solana.sendTransaction(transaction);
    return hash;
  }
}

export default SolanaOmniService;
