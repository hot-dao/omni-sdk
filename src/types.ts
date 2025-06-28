import { Connection } from "@solana/web3.js";
import { rpc } from "@stellar/stellar-sdk";
import { TonApiClient } from "@ton-api/client";
import { JsonRpcProvider } from "near-api-js/lib/providers";
import { Action } from "near-api-js/lib/transaction";
import * as ethers from "ethers";

import { Logger } from "./utils";

export enum Network {
  Omni_v1 = 0,
  Hot = -4,
  Zcash = -5,
  Btc = -6,

  Ton = 1117,

  Tron = 999,
  Solana = 1001,
  Stellar = 1100,
  Near = 1010,

  Eth = 1,
  Polygon = 137,
  Arbitrum = 42161,
  Avalanche = 43114,
  Base = 8453,
  Bnb = 56,
  Optimism = 10,
}

export interface BridgeOptions {
  logger?: Logger;

  evmRpc?: Record<number, string[]> | ((chain: number) => ethers.AbstractProvider);
  solanaRpc?: Connection | string[];
  tonRpc?: TonApiClient | string;

  stellarRpc?: string | rpc.Server;
  stellarBaseFee?: string;

  nearRpc?: JsonRpcProvider | string[];

  enableApproveMax?: boolean;

  solverBusRpc?: string;
  mpcApi?: string[];
  api?: string;

  executeNearTransaction: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;
}

export interface ContractTransferType {
  chain_id: number;
  contract_id: string;
  receiver_id: string;
  token_id: string;
  amount: string;
}

export type TonVersion = Network.Ton;

export interface BuildedWithdraw {
  chain: number;
  amount: bigint;
  receiver: string;
  signature: string;
  token: string;
  nonce: string;
}

export interface PendingWithdraw {
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

export interface PendingWithdrawWithStatus extends PendingWithdraw {
  completed: boolean;
}

export interface PendingDepositWithIntent extends PendingDeposit {
  intentAccount: string;
}

export interface TokenAsset {
  intents_id: string;
  chain_id: number;
  contract_id: string;
  usd_rate: number;
  decimal: number;
  icon: string;
  symbol: string;
  name: string;
}
