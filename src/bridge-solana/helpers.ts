import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export const PROGRAM_ID = new PublicKey("8sXzdKW2jFj7V5heRwPMcygzNH3JZnmie5ZRuNoTuKQC");

export function findContractStateAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);
}

export function findDepositAddress(nonce: bigint, sender: PublicKey, receiver: Buffer, mint: PublicKey, amount: bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("deposit", "utf8"), //
      new BN(nonce.toString()).toBuffer("be", 16),
      sender.toBytes(),
      receiver,
      mint.toBytes(),
      new BN(amount.toString()).toBuffer("be", 8),
    ],
    PROGRAM_ID
  );
}

export function findUserAddress(receiver: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("user", "utf8"), receiver.toBytes()], PROGRAM_ID);
}
