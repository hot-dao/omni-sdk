export interface ChainType {
  id: Network;
  rpc: string[];
  icon: string;
  wrapToken: string;
  name: string;
  key: string;
  short: string;
  symbol: string;
  decimal: number;
  minimum: number;
  isEvm: boolean;
  isOpen: boolean;
  explorer?: string;
  explorerTx?: string;
  exporerToken?: string;
  isBeta?: boolean;
}

export enum Network {
  Hot = -4,
  Tron = 999, // magic id
  Solana = 1001, // magic id
  Near = 1010, // magic id
  Ton = 1111, // magic id
  Stellar = 1100, // magic id

  Eth = 1,
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
}

export const Chains = {
  get(id: number) {
    return networks.find((t) => t.id === id) || ({} as any);
  },
};

export const networks: ChainType[] = [
  {
    id: Network.Tron,
    rpc: ["https://api.trongrid.io"],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png",
    wrapToken: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR",
    name: "TRON",
    key: "tron",
    short: "TRON",
    symbol: "TRX",
    decimal: 6,
    minimum: 5,
    isEvm: false,
    isOpen: true,
    explorer: "https://tronscan.org/#/address",
    explorerTx: "https://tronscan.org/#/transaction",
    exporerToken: "https://tronscan.org/#/token20",
  },

  {
    id: Network.Solana,
    rpc: [],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
    wrapToken: "So11111111111111111111111111111111111111112",
    name: "Solana",
    key: "solana",
    short: "SOL",
    symbol: "SOL",
    decimal: 9,
    minimum: 0.008,
    isEvm: false,
    isOpen: true,
    explorer: "https://solscan.io/account",
    explorerTx: "https://solscan.io/tx",
    exporerToken: "https://solscan.io/token",
  },

  {
    id: Network.Near,
    rpc: [],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/near/info/logo.png",
    wrapToken: "wrap.near",
    name: "NEAR",
    key: "near",
    short: "NEAR",
    symbol: "NEAR",
    decimal: 24,
    minimum: 0.25,
    isEvm: false,
    isOpen: true,
    explorer: "https://nearblocks.io/address",
    explorerTx: "https://nearblocks.io/txns",
    exporerToken: "https://nearblocks.io/token",
  },

  {
    id: Network.Ton,
    rpc: [],
    icon: "https://tgapp.herewallet.app/images/chains/ton.svg",
    wrapToken: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
    name: "TON",
    key: "ton",
    short: "TON",
    symbol: "TON",
    decimal: 9,
    minimum: 0.5,
    isEvm: false,
    isOpen: true,
    explorer: "https://tonviewer.com",
    explorerTx: "https://tonviewer.com/transaction",
    exporerToken: "https://tonviewer.com",
  },

  {
    id: Network.Base,
    rpc: [
      "https://base.blockpi.network/v1/rpc/public",
      "https://rpc.ankr.com/base",
      "https://rpc-base.hotdao.ai", //
      "https://mainnet.base.org",
      "https://g.w.lavanet.xyz:443/gateway/base/rpc-http/d201915962f57367c3c57baa1c72df72",
    ],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
    wrapToken: "0x4200000000000000000000000000000000000006",
    name: "Base",
    key: "base",
    short: "BASE",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    minimum: 0.0001,
    isOpen: true,
    explorer: "https://basescan.org/address",
    explorerTx: "https://basescan.org/tx",
    exporerToken: "https://basescan.org/token",
  },

  {
    id: Network.Bnb,
    rpc: [
      "https://bsc.blockpi.network/v1/rpc/public",
      "https://rpc-bsc.hotdao.ai",
      "https://mbsc3.dexe.io/rpc",
      "https://bsc-dataseed.bnbchain.org",
      "https://g.w.lavanet.xyz:443/gateway/bsc/rpc-http/d201915962f57367c3c57baa1c72df72",
    ],

    icon: "https://tgapp.herewallet.app/images/chains/bnb.png",
    wrapToken: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    name: "BNB",
    key: "bnb",
    short: "BNB",
    symbol: "BNB",
    decimal: 18,
    isEvm: true,
    minimum: 0.001,
    isOpen: true,
    explorer: "https://bscscan.com/address",
    explorerTx: "https://bscscan.com/tx",
    exporerToken: "https://bscscan.com/token",
  },

  {
    id: Network.Polygon,
    rpc: [
      "https://polygon.blockpi.network/v1/rpc/public",
      "https://polygon-rpc.com",
      "https://g.w.lavanet.xyz:443/gateway/polygon1/rpc-http/d201915962f57367c3c57baa1c72df72",
    ],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
    wrapToken: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    name: "Polygon",
    key: "polygon",
    short: "POL",
    symbol: "POL",
    decimal: 18,
    isEvm: true,
    minimum: 0.1,
    isOpen: true,
    explorer: "https://polygonscan.com/address",
    explorerTx: "https://polygonscan.com/tx",
    exporerToken: "https://polygonscan.com/token",
  },

  {
    id: Network.Arbitrum,
    rpc: [
      "https://arbitrum.blockpi.network/v1/rpc/public",
      "https://arb1.arbitrum.io/rpc",
      "https://g.w.lavanet.xyz:443/gateway/arb1/rpc-http/d201915962f57367c3c57baa1c72df72",
    ],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
    wrapToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    name: "Arbitrum",
    key: "arb",
    short: "ARB",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    minimum: 0.0001,
    isOpen: true,
    explorer: "https://arbiscan.io/address",
    explorerTx: "https://arbiscan.io/tx",
    exporerToken: "https://arbiscan.io/token",
  },

  {
    id: Network.Eth,
    rpc: [
      "https://ethereum.blockpi.network/v1/rpc/public",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
      "https://g.w.lavanet.xyz:443/gateway/eth/rpc-http/d201915962f57367c3c57baa1c72df72", //
    ],

    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    wrapToken: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    name: "Ethereum",
    key: "eth",
    short: "ETH",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    minimum: 0.0005,
    isOpen: true,
    explorer: "https://etherscan.io/address",
    explorerTx: "https://etherscan.io/tx",
    exporerToken: "https://etherscan.io/token",
  },

  {
    id: Network.Xlayer,
    rpc: ["https://xlayerrpc.okx.com"],
    icon: "https://s2.coinmarketcap.com/static/img/coins/128x128/30907.png",
    wrapToken: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
    name: "OKB",
    key: "okx",
    short: "OKB",
    symbol: "OKB",
    decimal: 18,
    isEvm: true,
    minimum: 0.0001,
    isOpen: true,
  },

  {
    id: Network.Optimism,
    rpc: [
      "https://optimism-rpc.publicnode.com",
      "https://op-pokt.nodies.app",
      "https://mainnet.optimism.io",
      "https://g.w.lavanet.xyz:443/gateway/optm/rpc-http/d201915962f57367c3c57baa1c72df72",
    ],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
    wrapToken: "0x4200000000000000000000000000000000000006",
    name: "Optimism",
    key: "op",
    short: "OP",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    minimum: 0.0001,
    isOpen: true,
    explorer: "https://optimistic.etherscan.io/address",
    explorerTx: "https://optimistic.etherscan.io/tx",
    exporerToken: "https://optimistic.etherscan.io/token",
  },

  {
    id: Network.Linea,
    rpc: ["https://linea.blockpi.network/v1/rpc/public", "https://rpc.linea.build"],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/linea/info/logo.png",
    wrapToken: "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f",
    name: "Linea",
    key: "linea",
    short: "LINEA",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    minimum: 0.0001,
    isOpen: true,
    exporerToken: "https://lineascan.build/token",
  },

  {
    id: Network.Aurora,
    rpc: ["https://mainnet.aurora.dev"],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/aurora/info/logo.png",
    wrapToken: "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
    name: "Aurora",
    short: "AURORA",
    key: "aurora",
    symbol: "ETH",
    decimal: 18,
    isEvm: true,
    isOpen: true,
    minimum: 0.0001,
    explorer: "https://explorer.mainnet.aurora.dev/address",
    explorerTx: "https://opbnb.bscscan.com/tx",
    exporerToken: "https://explorer.mainnet.aurora.dev/token",
  },

  {
    id: Network.OpBnb,
    rpc: ["https://opbnb-rpc.publicnode.com", "https://opbnb-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3"],
    icon: "https://tgapp.herewallet.app/images/chains/opbnb.png",
    wrapToken: "0x4200000000000000000000000000000000000006",
    name: "opBNB",
    short: "BNB",
    key: "opbnb",
    symbol: "BNB",
    decimal: 18,
    isEvm: true,
    isOpen: true,
    minimum: 0.002,
    explorer: "https://opbnb.bscscan.com/address",
    explorerTx: "https://opbnb.bscscan.com/tx",
    exporerToken: "https://opbnb.bscscan.com/token",
  },

  {
    id: Network.Avalanche,
    rpc: [
      "https://avalanche.blockpi.network/v1/rpc/public",
      "https://avalanche-c-chain-rpc.publicnode.com",
      "https://api.avax.network/ext/bc/C/rpc",
    ],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png",
    wrapToken: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    name: "Avalanche",
    key: "avax",
    short: "AVAX",
    symbol: "AVAX",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://avascan.info/blockchain/c/address",
    explorerTx: "https://avascan.info/blockchain/c/tx",
    exporerToken: "https://avascan.info/blockchain/c/token",
  },

  {
    id: Network.Taiko,
    rpc: ["https://rpc.ankr.com/taiko", "https://rpc.mainnet.taiko.xyz"],
    icon: "https://icons.llamao.fi/icons/chains/rsz_taiko.jpg",
    wrapToken: "0xa51894664a773981c6c112c43ce576f315d5b1b6",
    name: "Taiko",
    key: "taiko",
    short: "Taiko",
    symbol: "ETH",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://taikoscan.io/address",
    explorerTx: "https://taikoscan.io/tx",
    exporerToken: "https://taikoscan.io/token",
  },

  {
    id: Network.Manta,
    rpc: ["https://pacific-rpc.manta.network/http"],
    icon: "https://tgapp.herewallet.app/images/chains/manta.svg",
    wrapToken: "0x0dc808adce2099a9f62aa87d9670745aba741746",
    name: "Manta",
    key: "manta",
    short: "Manta",
    symbol: "ETH",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://manta.socialscan.io/address",
    explorerTx: "https://manta.socialscan.io/tx",
    exporerToken: "https://manta.socialscan.io/token",
  },

  {
    id: Network.Sei,
    rpc: ["https://evm-rpc.sei-apis.com", "https://rpc.ankr.com/sei", "https://sei-rpc.publicnode.com:443"],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sei/info/logo.png",
    wrapToken: "0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7",
    name: "Sei",
    key: "sei",
    short: "SEI",
    symbol: "SEI",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://www.seiscan.app/accounts",
    explorerTx: "https://www.seiscan.app/txs",
    exporerToken: "https://www.seiscan.app/token",
  },

  {
    id: Network.Mantle,
    rpc: ["https://mantle-rpc.publicnode.com", "https://rpc.ankr.com/mantle", "https://rpc.mantle.xyz"],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/mantle/info/logo.png",
    wrapToken: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8",
    name: "Mantle",
    key: "mantle",
    short: "MNT",
    symbol: "MNT",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://explorer.mantle.xyz/address",
    explorerTx: "https://explorer.mantle.xyz/tx",
    exporerToken: "https://explorer.mantle.xyz/token",
  },

  {
    id: Network.Blast,
    rpc: [
      "https://blast.blockpi.network/v1/rpc/public",
      "https://blast-rpc.publicnode.com",
      "https://rpc.ankr.com/blast",
      "https://rpc.blast.io",
    ],
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/blast/info/logo.png",
    wrapToken: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    name: "Blast",
    key: "blast",
    short: "BLAST",
    symbol: "ETH",
    decimal: 18,
    minimum: 0.01,
    isEvm: true,
    isOpen: true,
    explorer: "https://avascan.info/blockchain/c/address",
    explorerTx: "https://avascan.info/blockchain/c/tx",
    exporerToken: "https://avascan.info/blockchain/c/token",
  },
];
