import { Network } from "./chains";
import { OmniMetadata } from "./types";

export enum TokenId {
  ETH = 0,
  USDC = 1,
  SOL = 2,
  BNB = 3,
  DD = 4,
  HAPI = 5,
  USM = 6,
  AURORA = 8,
  USDT = 9,
  NEAR = 17,
  TON = 39,
}

export const TokenIds: Record<number, OmniMetadata> = {
  [TokenId.SOL]: {
    isTransferable: true,
    id: TokenId.SOL,
    symbol: "SOL",
    asset: "SOL",
    bridge: [Network.Near, Network.Solana, Network.Bnb, Network.Hot], // , Network.Polygon],
    chains: {
      [Network.Polygon]: "0xd93f7E271cB87c23AaA73edC008A79646d1F9912",
      [Network.Bnb]: "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF",
      [Network.Near]: "22.contract.portalbridge.near",
      [Network.Solana]: "native",
      [Network.Hot]: String(TokenId.SOL),
    },
  },

  [TokenId.TON]: {
    isTransferable: true,
    id: TokenId.TON,
    symbol: "TON",
    asset: "TON",
    bridge: [Network.Near, Network.Bnb, Network.Hot],
    chains: {
      [Network.Bnb]: "0x76A797A59Ba2C17726896976B7B3747BfD1d220f",
      [Network.Near]: "39.omt.tg",
      // [Network.Ton]: "native",
      [Network.Hot]: String(TokenId.TON),
    },
  },

  [TokenId.ETH]: {
    isTransferable: true,
    id: TokenId.ETH,
    symbol: "ETH",
    asset: "ETH",

    bridge: [Network.Near, Network.Solana, Network.Base, Network.Hot, Network.Aurora, Network.Optimism, Network.Arbitrum, Network.Eth],

    chains: {
      [Network.Near]: "aurora",
      [Network.Base]: "native",
      [Network.Solana]: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",

      [Network.Aurora]: "native",
      [Network.Arbitrum]: "native",
      [Network.Optimism]: "native",
      [Network.Eth]: "native",

      [Network.Hot]: String(TokenId.ETH),
    },
  },

  [TokenId.USDC]: {
    isTransferable: true,
    id: TokenId.USDC,
    symbol: "USDC",
    asset: "USDC",
    bridge: [
      Network.Near,
      Network.Hot,
      Network.Bnb,
      Network.Solana,
      Network.Base,
      Network.Aurora,
      Network.Polygon,
      Network.Arbitrum,
      Network.Optimism,
    ],

    chains: {
      [Network.Near]: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      [Network.Base]: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      [Network.Bnb]: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      [Network.Polygon]: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      [Network.Arbitrum]: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      [Network.Optimism]: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      [Network.Solana]: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      [Network.Aurora]: "0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7",
      [Network.Hot]: String(TokenId.USDC),
    },
  },

  [TokenId.NEAR]: {
    isTransferable: true,
    id: TokenId.NEAR,
    symbol: "NEAR",
    asset: "NEAR",
    bridge: [Network.Near, Network.Hot, Network.Bnb, Network.Solana], // Network.Eth, Network.Aurora
    chains: {
      [Network.Eth]: "0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4",
      [Network.Aurora]: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d",
      [Network.Bnb]: "0x1fa4a73a3f0133f0025378af00236f3abdee5d63",
      [Network.Solana]: "BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z",
      [Network.Near]: "wrap.near",
      [Network.Hot]: String(TokenId.NEAR),
    },
  },

  [TokenId.USDT]: {
    isTransferable: true,
    id: TokenId.USDT,
    symbol: "USDT",
    asset: "USDT",
    bridge: [
      Network.Near,
      Network.Ton,
      Network.Hot,
      Network.Solana,
      Network.Bnb,
      Network.Aurora,
      Network.Polygon,
      Network.Optimism,
      Network.Arbitrum,
    ],
    chains: {
      [Network.Near]: "usdt.tether-token.near",
      [Network.Solana]: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      [Network.Bnb]: "0x55d398326f99059ff775485246999027b3197955",
      [Network.Polygon]: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
      [Network.Optimism]: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      [Network.Arbitrum]: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
      [Network.Eth]: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      [Network.Aurora]: "0x80da25da4d783e57d2fcda0436873a193a4beccf",
      [Network.Ton]: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
      [Network.Hot]: String(TokenId.USDT),
    },
  },

  [TokenId.USM]: {
    id: TokenId.USM,
    symbol: "USMEME",
    asset: "USMEME",
    bridge: [Network.Near, Network.Hot, Network.Base],
    chains: {
      [Network.Near]: "usmeme.tg",
      [Network.Base]: "0xdc22e3c4b841e95a13b14ab26d066ec3737d6f80",
      [Network.Hot]: String(TokenId.USM),
    },
  },

  [TokenId.AURORA]: {
    isTransferable: true,
    id: TokenId.AURORA,
    symbol: "AURORA",
    asset: "AURORA",
    bridge: [Network.Near, Network.Hot, Network.Aurora, Network.Eth],
    chains: {
      [Network.Near]: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
      [Network.Aurora]: "0x8bec47865ade3b172a928df8f990bc7f2a3b9f79",
      [Network.Eth]: "0xaaaaaa20d9e0e2461697782ef11675f668207961",
      [Network.Hot]: String(TokenId.AURORA),
    },
  },

  [TokenId.BNB]: {
    isTransferable: true,
    id: TokenId.BNB,
    symbol: "BNB",
    asset: "BNB",
    bridge: [Network.Bnb, Network.Hot, Network.Near],
    chains: {
      [Network.Bnb]: "native",
      [Network.Near]: "wbnb.hot.tg",
      [Network.Hot]: String(TokenId.BNB),
    },
  },

  [TokenId.DD]: {
    id: TokenId.DD,
    symbol: "DD",
    asset: "DD",
    bridge: [Network.Near, Network.Hot, Network.Bnb],
    chains: {
      [Network.Near]: "dd.tg",
      [Network.Bnb]: "0xf74594a5606eeca8eb5c09933a361f261296d3b7",
      [Network.Hot]: String(TokenId.DD),
    },
  },

  [TokenId.HAPI]: {
    isTransferable: true,
    id: TokenId.HAPI,
    symbol: "HAPI",
    asset: "HAPI",
    bridge: [Network.Near, Network.Hot, Network.Bnb],
    chains: {
      [Network.Near]: "d9c2d319cd7e6177336b0a9c93c21cb48d84fb54.factory.bridge.near",
      [Network.Bnb]: "0xd9c2d319cd7e6177336b0a9c93c21cb48d84fb54",
      [Network.Hot]: String(TokenId.HAPI),
    },
  },
};
