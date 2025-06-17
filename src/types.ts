export enum Network {
  Omni_v1 = 0,
  Hot = -4,
  Zcash = -5,
  Btc = -6,

  Ton = 1117,
  LegacyTon = 1111,

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

export interface ContractTransferType {
  chain_id: number;
  contract_id: string;
  receiver_id: string;
  token_id: string;
  amount: string;
}

export type TonVersion = Network.Ton | Network.LegacyTon;

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
