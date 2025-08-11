import type { Action } from "@near-js/transactions";
import type { TransactionInstruction } from "@solana/web3.js";
import type { TransactionRequest } from "ethers";
import type { Transaction } from "@stellar/stellar-sdk";
import type { SenderArguments } from "@ton/core";
import { Network } from "./types";

export interface SendTransactionSolana {
  chain: Network.Solana;
  sendTransaction: (tx: TransactionInstruction[]) => Promise<string>;
}

export interface SendTransactioEvm {
  chain: number; // Exclude<Network.Solana | Network.Near | Network.Stellar | Network.Ton>;
  sendTransaction: (tx: TransactionRequest) => Promise<string>;
}

export interface SendTransactioNear {
  chain: Network.Near;
  sendTransaction: ({ receiverId, actions }: { receiverId: string; actions: Action[] }) => Promise<string>;
}

export interface SendTransactioStellar {
  chain: Network.Stellar;
  sendTransaction: (tx: Transaction) => Promise<string>;
}

export interface SendTransactionTon {
  chain: Network.Ton;
  sendTransaction: (tx: SenderArguments) => Promise<string>;
}

export type SendTransaction = SendTransactionSolana | SendTransactioEvm | SendTransactioNear | SendTransactioStellar | SendTransactionTon;
