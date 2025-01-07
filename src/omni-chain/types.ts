import { Network } from "./chains";

export interface TransferType {
  chain_id: number;
  contract_id: string;
  receiver_id: string;
  token_id: number;
  amount: string;
}

export interface PendingWithdraw {
  completed: boolean;
  timestamp: number;
  receiver: string;
  chain: Network;
  amount: string;
  nonce: string;
  token: number;
}

export interface PendingDeposit {
  token: number;
  chain: Network;
  timestamp: number;
  receiver: string;
  amount: string;
  nonce: string;
  tx: string;
}

export interface OmniMetadata {
  id: number;
  isTransferable?: boolean;
  chains: Record<number, string>;
  symbol: string;
  asset: string;
  bridge: number[];
}
