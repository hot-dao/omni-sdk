export enum Network {
  Omni_v1 = 0,
  Hot = -4,
  Zcash = -5,
  Btc = -6,

  Ton = 1117,
  LegacyTon = 1111,

  Eth = 1,
  Tron = 999,
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

export interface ReviewFee {
  chain: number;
  gasPrice: bigint;
  gasLimit: bigint;
  additional?: bigint;
  reserve: bigint;
  token?: string;
}

export interface PendingWithdrawWithStatus extends PendingWithdraw {
  completed: boolean;
}

export interface PendingDepositWithIntent extends PendingDeposit {
  intentAccount: string;
}
