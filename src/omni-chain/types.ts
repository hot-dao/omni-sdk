import { Network } from "./chains";

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
  chain: Network;
  amount: string;
  nonce: string;
  token: string;
}

export interface PendingDeposit {
  token: string;
  chain: Network;
  timestamp: number;
  receiver: string;
  amount: string;
  nonce: string;
  tx: string;
}
