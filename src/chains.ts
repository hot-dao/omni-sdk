export enum Network {
  Hot = -4, // magic id
  Tron = 999, // magic id
  Solana = 1001, // magic id
  Near = 1010, // magic id
  Ton = 1111, // magic id
  Stellar = 1100, // magic id

  Eth = 1,
  Polygon = 137,
  Arbitrum = 42161,
  Aurora = 1313161554,
  Linea = 59144,
  Base = 8453,
  Bnb = 56,
  Optimism = 10,
  Kava = 2222,
}

export const chains = new Map<number, { symbol: string; decimal: number; isEvm: boolean }>([
  [Network.Tron, { symbol: "TRX", decimal: 6, isEvm: false }],
  [Network.Stellar, { symbol: "XLM", decimal: 7, isEvm: false }],
  [Network.Solana, { symbol: "SOL", decimal: 9, isEvm: false }],
  [Network.Near, { symbol: "NEAR", decimal: 24, isEvm: false }],
  [Network.Ton, { symbol: "TON", decimal: 9, isEvm: false }],

  [Network.Kava, { symbol: "KAVA", decimal: 18, isEvm: true }],
  [Network.Base, { symbol: "ETH", decimal: 18, isEvm: true }],
  [Network.Bnb, { symbol: "BNB", decimal: 18, isEvm: true }],
  [Network.Polygon, { symbol: "POL", decimal: 18, isEvm: true }],
  [Network.Arbitrum, { symbol: "ARB", decimal: 18, isEvm: true }],
  [Network.Eth, { symbol: "ETH", decimal: 18, isEvm: true }],
  [Network.Optimism, { symbol: "ETH", decimal: 18, isEvm: true }],
  [Network.Linea, { symbol: "ETH", decimal: 18, isEvm: true }],
  [Network.Aurora, { symbol: "ETH", decimal: 18, isEvm: true }],
]);
