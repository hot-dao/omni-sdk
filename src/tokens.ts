import { Network, Chains } from "./chains";
import { formatAmount, parseAmount, toOmniIntent } from "./utils";

export enum OmniGroup {
  ETH = "ETH",
  USDC = "USDC",
  SOL = "SOL",
  BNB = "BNB",
  DD = "DD",
  HAPI = "HAPI",
  USM = "USM",
  AURORA = "AURORA",
  USDT = "USDT",
  NEAR = "NEAR",
  TON = "TON",
  KAVA = "KAVA",
  XLM = "XLM",
}

export class OmniToken {
  constructor(readonly token: OmniGroup) {}

  address(chain: Network) {
    const token = omniTokens[this.token]?.[chain];
    if (token == null) throw `Unsupported token ${chain}:${this.token}`;
    return token.address;
  }

  input(chain: Network, amount: number | bigint): [Network, string, bigint] {
    const token = omniTokens[this.token]?.[chain];
    if (token == null) throw `Unsupported token ${chain}:${this.token}`;
    return [chain, token.address, typeof amount === "bigint" ? amount : BigInt(parseAmount(amount, token.decimal))];
  }

  format(chain: Network, amount: bigint): string {
    const token = omniTokens[this.token]?.[chain];
    if (token == null) throw `Unsupported token ${chain}:${this.token}`;
    return `${formatAmount(amount, token.decimal)} ${this.token} on ${Chains.get(chain).name}`;
  }

  intent(chain: Network) {
    const token = omniTokens[this.token]?.[chain];
    if (token == null) throw `Unsupported token ${chain}:${this.token}`;
    return toOmniIntent(chain, token.address);
  }
}

export const omniTokens: Record<string, Record<number, { address: string; decimal: number }>> = {
  USDT: {
    1: { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimal: 6 },
    10: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimal: 6 },
    56: { address: "0x55d398326f99059ff775485246999027b3197955", decimal: 18 },
    137: { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimal: 6 },
    1001: { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimal: 6 },
    1111: { address: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", decimal: 6 },
    2222: { address: "0x919C1c267BC06a7039e03fcc2eF738525769109c", decimal: 6 },
    42161: { address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimal: 6 },
    1313161554: { address: "0x80da25da4d783e57d2fcda0436873a193a4beccf", decimal: 6 },
    1010: { address: "usdt.tether-token.near", decimal: 6 },
  },
  USDC: {
    10: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimal: 6 },
    56: { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimal: 18 },
    137: { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimal: 6 },
    1001: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimal: 6 },
    1010: { address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimal: 6 },
    1100: { address: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", decimal: 7 },
    8453: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimal: 6 },
    42161: { address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimal: 6 },
    1313161554: { address: "0x368ebb46aca6b8d0787c96b2b20bd3cc3f2c45f7", decimal: 6 },
  },
  ETH: {
    1: { address: "native", decimal: 18 },
    10: { address: "native", decimal: 18 },
    1001: { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", decimal: 8 },
    1010: { address: "aurora", decimal: 18 },
    8453: { address: "native", decimal: 18 },
    42161: { address: "native", decimal: 18 },
    1313161554: { address: "native", decimal: 18 },
  },
  BNB: {
    56: { address: "native", decimal: 18 },
    1010: { address: "wbnb.hot.tg", decimal: 18 },
  },
  SOL: {
    56: { address: "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF", decimal: 18 },
    137: { address: "0xd93f7E271cB87c23AaA73edC008A79646d1F9912", decimal: 9 },
    1010: { address: "22.contract.portalbridge.near", decimal: 8 },
    1001: { address: "native", decimal: 9 },
  },
  NEAR: {
    1: { address: "0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4", decimal: 24 },
    56: { address: "0x1fa4a73a3f0133f0025378af00236f3abdee5d63", decimal: 18 },
    1001: { address: "BYPsjxa3YuZESQz1dKuBw1QSFCSpecsm8nCQhY5xbU1Z", decimal: 9 },
    1313161554: { address: "0xc42c30ac6cc15fac9bd938618bcaa1a1fae8501d", decimal: 24 },
    1010: { address: "native", decimal: 24 },
  },
  AURORA: {
    1: { address: "0xaaaaaa20d9e0e2461697782ef11675f668207961", decimal: 18 },
    1010: { address: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", decimal: 18 },
    1313161554: { address: "0x8bec47865ade3b172a928df8f990bc7f2a3b9f79", decimal: 18 },
  },
  HAPI: {
    56: { address: "0xd9c2d319cd7e6177336b0a9c93c21cb48d84fb54", decimal: 18 },
    1010: { address: "d9c2d319cd7e6177336b0a9c93c21cb48d84fb54.factory.bridge.near", decimal: 18 },
  },
  DD: {
    56: { address: "0xf74594a5606eeca8eb5c09933a361f261296d3b7", decimal: 8 },
    1010: { address: "dd.tg", decimal: 8 },
  },
  USM: {
    1010: { address: "usmeme.tg", decimal: 8 },
    8453: { address: "0xdc22e3c4b841e95a13b14ab26d066ec3737d6f80", decimal: 8 },
  },
  XLM: {
    1100: { address: "native", decimal: 7 },
  },
  KAVA: {
    2222: { address: "native", decimal: 18 },
  },
  TON: {
    56: { address: "0x76A797A59Ba2C17726896976B7B3747BfD1d220f", decimal: 9 },
    1111: { address: "native", decimal: 9 },
  },
};
