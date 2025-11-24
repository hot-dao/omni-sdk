import type { TonApiClient } from "@ton-api/client";
import type { JsonRpcProvider } from "@near-js/providers";
import type { Action } from "@near-js/transactions";
import type { Connection } from "@solana/web3.js";
import type { AbstractProvider } from "ethers";

import { Logger } from "./utils";
import { CosmosConfig } from "./env";

export enum Network {
  Omni_v1 = 0,
  Hot = -4,
  Zcash = -5,
  Btc = -6,

  OmniTon = 1117,
  Ton = 1111,

  Juno = 4444118,
  Gonka = 4444119,

  Eth = 1,
  Tron = 333,
  Solana = 1001,
  Stellar = 1100,
  Near = 1010,
  Polygon = 137,
  Arbitrum = 42161,
  Aurora = 1313161554,
  Avalanche = 43114,
  Linea = 59144,
  Xlayer = 196,
  Base = 8453,
  Bnb = 56,
  OpBnb = 204,
  BnbTestnet = 97,
  Optimism = 10,
  Scroll = 534352,
  EbiChain = 98881,
  Sei = 1329,
  Blast = 81457,
  Taiko = 167000,
  Mantle = 5000,
  Manta = 169,
  Kava = 2222,
  ZkSync = 324,
  Monad = 10143,
  Metis = 1088,
  Gnosis = 100,
  Fantom = 250,
  Cronos = 25,
  Chiliz = 88888,
  Moonbeam = 1284,
  Ronin = 2020,
  Lisk = 1135,
  Sonic = 146,
}

export interface PendingWidthdrawData {
  timestamp: number;
  near_trx: string;
  chain_id: number;
  nonce: string;
  sender_id: string;
  withdraw_hash: string | null;
  withdraw_data: {
    amount: string;
    receiver_id: string;
    token_id: string;
    contract_id: string;
    chain_id: number;
  };
}

export interface BridgeOptions {
  logger?: Logger;
  executeNearTransaction?: (tx: { receiverId: string; actions: Action[] }) => Promise<{ sender: string; hash: string }>;

  evmContract?: string;
  evmRpc?: Record<number, string[]> | ((chain: number) => AbstractProvider);
  enableApproveMax?: boolean;

  solanaProgramId?: string;
  solanaRpc?: Connection | string[];

  tonContract?: string;
  tonRpc?: TonApiClient | string;

  nearRpc?: JsonRpcProvider | string[];

  cosmos?: Record<number, CosmosConfig>;

  stellarContract?: string;
  stellarHorizonRpc?: string[];
  stellarBaseFee?: string;
  stellarRpc?: string[];

  solverBusRpc?: string;
  mpcApi?: string[];
  api?: string[];
}

export interface ContractTransferType {
  chain_id: number;
  contract_id: string;
  receiver_id: string;
  token_id: string;
  amount: string;
}

export interface WithdrawArgs {
  chain: number;
  amount: bigint;
  token: string;
  nonce: string;
  receiver: string;
}

export interface WithdrawArgsWithPending extends WithdrawArgs {
  withdraw_hash?: string;
  near_trx?: string;
  timestamp: number;
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

export interface PendingWithdrawWithStatus extends WithdrawArgsWithPending {
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
