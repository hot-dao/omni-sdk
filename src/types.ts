import { Transaction } from "@solana/web3.js";
import { FeeBumpTransaction, Transaction as StellarTransaction } from "@stellar/stellar-sdk";
import { SenderArguments } from "@ton/core";
import { HereCall } from "@here-wallet/core";
import { ethers } from "ethers";

export interface HotBridgeConfig {
  signIntent: (intent: any) => Promise<any>;

  near?: {
    getAddress: () => Promise<string>;
    sendTransaction: (tx: HereCall) => Promise<string>;
    rpcs: string[];
  };

  solana?: {
    getAddress: () => Promise<string>;
    sendTransaction: (tx: Transaction) => Promise<string>;
    rpcs: string[];
  };

  evm?: {
    getAddress: () => Promise<string>;
    sendTransaction: (tx: ethers.TransactionRequest) => Promise<string>;
    rpcs: Record<number, string[]>;
  };

  stellar?: {
    getAddress: () => Promise<string>;
    sendTransaction: (tx: FeeBumpTransaction | StellarTransaction) => Promise<string>;
    horizonApi: string[];
    rpcs: string[];
  };

  ton?: {
    getAddress: () => Promise<string>;
    sendTransaction: (tx: SenderArguments) => Promise<string>;
    tonApiKey: string;
  };
}

export interface TransferType {
  chain_id: number;
  contract_id: string;
  receiver_id: string;
  token_id: string;
  amount: string;
}

export interface PendingWithdraw {
  completed: boolean;
  timestamp: number;
  receiver: string;
  chain: number;
  amount: string;
  nonce: string;
  token: string;
}

export interface PendingDeposit {
  token: string;
  chain: number;
  timestamp: number;
  receiver: string;
  sender: string;
  amount: string;
  nonce: string;
  tx: string;
}
