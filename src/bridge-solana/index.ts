import * as sol from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { baseDecode, baseEncode } from "@near-js/utils";
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
    if (this.omni.user.solana == null) throw "Connect SOLANA";
    return this.omni.user.solana;
  }

  async isNonceUsed(nonce: string) {
    try {
      const state: any = await this.env.program.account.user.fetch(this.env.userAccount);
      return BigInt(nonce) <= BigInt(state.lastWithdrawNonce.toString());
    } catch (e) {
      console.error("isNonceUsed", e);
      return false;
    }
  }

  get env() {
    const [userAccount, userBump] = sol.PublicKey.findProgramAddressSync(
      [Buffer.from("user", "utf8"), this.solana.publicKey.toBytes()],
      PROGRAM_ID
    );

    const [stateAccount, stateBump] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);
    const provider = new anchor.AnchorProvider(this.solana.connection, this.solana, {});
    const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);
    return { program, PROGRAM_ID, userAccount, userBump, stateAccount, stateBump };
  }

  // TODO: Compute gas dinamically
  async getWithdrawFee() {
    const needNative = BigInt(parseAmount(0.005, 9));
    const realGas = BigInt(parseAmount(0.0002, 9));
    const balance = await this.getTokenLiquidity("native", this.solana.address);

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
    const balance = await this.getTokenLiquidity("native", this.solana.address);
    return {
      maxFee: 4_000_000n,
      need: bigIntMax(0n, 4_000_000n - balance),
      isNotEnough: balance < 4_000_000n,
      gasLimit: 200_000n,
      gasPrice: 1n,
      chain: Network.Solana,
    };
  }

  async getTokenLiquidity(token: string, address: string) {
    const [stateAccount] = address
      ? [new sol.PublicKey(address)]
      : sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);

    if (token === "native") {
      const balance = await this.solana.connection.getBalance(stateAccount);
      return BigInt(balance);
    }

    const ATA = getAssociatedTokenAddressSync(new sol.PublicKey(token), stateAccount, true);
    const meta = await this.solana.connection.getTokenAccountBalance(ATA);
    return BigInt(meta.value.amount);
  }

  async getLastDepositNonce() {
    const state: any = await this.env.program.account.user.fetch(this.env.userAccount).catch(() => ({ lastDepositNonce: null }));
    if (!state.lastDepositNonce) return null;
    const nonce = BigInt(state.lastDepositNonce.toString());
    return nonce;
  }

  async getLastWithdrawNonce() {
    const isExist = await this.solana.connection.getAccountInfo(this.env.userAccount);
    if (!isExist) return 0n;

    const state: any = await this.env.program.account.user.fetch(this.env.userAccount);
    return BigInt(state?.lastWithdrawNonce || 0n);
  }

  async parseDeposit(hash: string) {
    const waitReceipt = async (attemps = 0): Promise<sol.ParsedTransactionWithMeta | null> => {
      const status = await this.solana.connection.getParsedTransaction(hash, { commitment: "confirmed" });
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

    const deposit = { tx: hash, amount, nonce, receiver, chain: Network.Solana, timestamp, token };
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

    const receiver = Buffer.from(getOmniAddressHex(this.omni.near.accountId), "hex");
    const bnAmount = new anchor.BN(deposit.amount.toString());
    const bnNonce = new anchor.BN(deposit.nonce.toString());

    const mint = deposit.token === "native" ? sol.PublicKey.default : new sol.PublicKey(deposit.token);
    const [depositAddress] = findDepositAddress(BigInt(deposit.nonce), this.solana.publicKey, receiver, mint, BigInt(deposit.amount));

    const isExist = await this.solana.connection.getAccountInfo(depositAddress, { commitment: "confirmed" });
    if (isExist == null) return this.omni.removePendingDeposit(deposit);

    try {
      const builder = this.env.program.methods.clearDepositInfo(Array.from(receiver), mint, bnAmount, bnNonce).accounts({
        systemProgram: sol.SystemProgram.programId,
        sender: this.solana.publicKey.toBase58(),
        state: this.env.stateAccount.toBase58(),
        deposit: depositAddress,
      });

      const instruction = await builder.instruction();
      await this.solana.sendInstructions({ instructions: [instruction] });
    } catch (e) {
      console.error(e);
    }

    this.omni.removePendingDeposit(deposit);
  }

  async deposit(address: string, amount: bigint, to?: string) {
    const receiverAddr = to ? getOmniAddressHex(to) : getOmniAddressHex(this.omni.near.accountId);
    const receiver = Buffer.from(receiverAddr, "hex");

    const lastDeposit = await this.getLastDepositNonce();
    const builder = this.env.program.methods.generateDepositNonce(this.env.userBump);
    builder.accountsStrict({
      user: this.env.userAccount.toBase58(),
      state: this.env.stateAccount.toBase58(),
      sender: this.solana.publicKey.toBase58(),
      systemProgram: sol.SystemProgram.programId,
    });

    await this.solana.sendInstructions({ instructions: [await builder.instruction()] });
    const waitNewNonce = async () => {
      const newNonce = await this.getLastDepositNonce().catch(() => lastDeposit);
      if (newNonce === lastDeposit) return await waitNewNonce();
      if (newNonce == null) return await waitNewNonce();
      return newNonce;
    };

    const nonce = await waitNewNonce();
    const amt = new anchor.BN(amount.toString());
    if (address === "native") {
      const [depositAddress, depositBump] = findDepositAddress(nonce, this.solana.publicKey, receiver, sol.PublicKey.default, amount);
      const depositBuilder = this.env.program.methods.nativeDeposit(receiver, amt, depositBump);
      depositBuilder.accountsStrict({
        user: this.env.userAccount.toBase58(),
        state: this.env.stateAccount.toBase58(),
        sender: this.solana.publicKey.toBase58(),
        systemProgram: sol.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        deposit: depositAddress,
      });

      let deposit!: PendingDeposit;
      const instruction = await depositBuilder.instruction();
      await this.solana.sendInstructions({
        instructions: [instruction],
        onHash: (hash) => {
          deposit = this.omni.addPendingDeposit({
            receiver: receiverAddr,
            timestamp: Date.now(),
            chain: Network.Solana,
            amount: String(amount),
            token: address,
            nonce: "",
            tx: hash,
          });
        },
      });

      deposit.nonce = nonce.toString();
      this.omni.addPendingDeposit(deposit);
      return deposit;
    }

    const mint = new sol.PublicKey(address);
    const [depositAddress, depositBump] = findDepositAddress(nonce, this.solana.publicKey, receiver, mint, amount);
    const instructions: sol.TransactionInstruction[] = [];

    const contractATA = getAssociatedTokenAddressSync(mint, this.env.stateAccount, true);
    const isContractATAExist = await getAccount(this.solana.connection, contractATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);

    if (!isContractATAExist) {
      const createATA = createAssociatedTokenAccountInstruction(
        this.solana.publicKey,
        contractATA,
        this.env.stateAccount,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(createATA);
    }

    const depositBuilder = this.env.program.methods.tokenDeposit(receiver, amt, depositBump);
    depositBuilder.accountsStrict({
      user: this.env.userAccount.toBase58(),
      state: this.env.stateAccount.toBase58(),
      sender: this.solana.publicKey.toBase58(),
      systemProgram: sol.SystemProgram.programId,
      smcTokenAccount: getAssociatedTokenAddressSync(mint, this.env.stateAccount, true),
      senderTokenAccount: getAssociatedTokenAddressSync(mint, this.solana.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      deposit: depositAddress,
    });

    const instruction = await depositBuilder.instruction();
    instructions.push(instruction);

    let deposit!: PendingDeposit;
    await this.solana.sendInstructions({
      instructions,
      onHash: (hash) => {
        deposit = this.omni.addPendingDeposit({
          receiver: receiverAddr,
          timestamp: Date.now(),
          chain: Network.Solana,
          nonce: nonce.toString(),
          amount: String(amount),
          token: address,
          tx: hash,
        });
      },
    });

    deposit.nonce = nonce.toString();
    this.omni.addPendingDeposit(deposit);
    return deposit;
  }

  async withdraw(args: { nonce: string; signature: string; amount: bigint; token: string }) {
    const sign = Array.from(baseDecode(args.signature));

    if (args.token === "native") {
      const instructionBuilder = this.env.program.methods.nativeWithdraw(
        sign,
        new anchor.BN(args.nonce),
        new anchor.BN(args.amount.toString()),
        this.env.userBump
      );
      instructionBuilder.accountsStrict({
        user: this.env.userAccount,
        state: this.env.stateAccount,
        sender: this.solana.publicKey,
        receiver: this.solana.publicKey,
        systemProgram: sol.SystemProgram.programId,
      });

      const instruction = await instructionBuilder.instruction();
      const hash = await this.solana.sendInstructions({ instructions: [instruction] });
      return hash;
    }

    const owner = this.solana.publicKey;
    const mint = new sol.PublicKey(args.token);
    const instructions = [];

    const ATA = getAssociatedTokenAddressSync(mint, owner);
    const isExist = await getAccount(this.solana.connection, ATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);
    if (!isExist) {
      const createATA = createAssociatedTokenAccountInstruction(owner, ATA, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      instructions.push(createATA);
    }

    const contractATA = getAssociatedTokenAddressSync(mint, this.env.stateAccount, true);
    const isContractATAExist = await getAccount(this.solana.connection, contractATA, "confirmed", TOKEN_PROGRAM_ID).catch(() => null);
    if (!isContractATAExist) {
      const createATA = createAssociatedTokenAccountInstruction(
        owner,
        contractATA,
        this.env.stateAccount,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      instructions.push(createATA);
    }

    const instructionBuilder = this.env.program.methods.tokenWithdraw(
      sign,
      new anchor.BN(args.nonce),
      new anchor.BN(args.amount.toString()),
      this.solana.publicKey,
      this.env.userBump
    );

    instructionBuilder.accountsStrict({
      user: this.env.userAccount,
      state: this.env.stateAccount,
      sender: this.solana.publicKey,
      receiverTokenAccount: ATA,

      smcTokenAccount: getAssociatedTokenAddressSync(mint, this.env.stateAccount, true),
      systemProgram: sol.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    });

    instructions.push(await instructionBuilder.instruction());
    const hash = await this.solana.sendInstructions({ instructions });
    return hash;
  }
}

export default SolanaOmniService;
