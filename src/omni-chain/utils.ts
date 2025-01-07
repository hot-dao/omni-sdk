import { baseDecode, baseEncode } from "@near-js/utils";
import { getBytes, hexlify } from "ethers";

import { getChain, Network } from "./chains";
import { createAddressRlp, parseAddressRlp } from "./ton/constants";
import { Address } from "@ton/core";

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export class PendingControl {
  count = 0;
  step(msg: string, step?: number) {
    this.count += 1;
    console.log(this.count, msg);
  }
}

export const nativeToOmni = (chain: Network, addr: string) => {
  if (getChain(chain)?.isEvm) {
    if (addr === "native") return "11111111111111111111";
    return baseEncode(getBytes(addr));
  }

  if (chain === Network.Solana) {
    if (addr === "native") return "11111111111111111111111111111111";
    return addr;
  }

  if (chain === Network.Ton) {
    if (addr === "native") return "1";
    return baseEncode(createAddressRlp(Address.parse(addr)));
  }

  return baseEncode(Buffer.from(addr, "utf8"));
};

export const omniToNative = (chain: Network, addr: string) => {
  if (addr === "1") return "native";
  if (addr === "11111111111111111111") return "native";
  if (addr === "11111111111111111111111111111111") return "native";
  if (getChain(chain)?.isEvm) return hexlify(baseDecode(addr));
  if (chain === Network.Ton) return parseAddressRlp(addr);
  if (chain === Network.Solana) return addr;
  return Buffer.from(baseDecode(addr)).toString("utf8");
};

export const toReadableNumber = (decimals: number | bigint, number: bigint | string = "0"): string => {
  number = number.toString();
  if (!decimals) return number;

  decimals = Number(decimals);
  const wholeStr = number.substring(0, number.length - decimals) || "0";
  const fractionStr = number
    .substring(number.length - decimals)
    .padStart(decimals, "0")
    .substring(0, decimals);

  return `${wholeStr}.${fractionStr}`.replace(/\.?0+$/, "");
};

export const toNonDivisibleNumber = (decimals: number | bigint, number: string): string => {
  if (decimals === null || decimals === undefined) return number;
  decimals = Number(decimals);
  const [wholePart, fracPart = ""] = number.includes("e") ? Number(number).toFixed(24).split(".") : number.split(".");
  return `${wholePart}${fracPart.padEnd(decimals, "0").slice(0, decimals)}`.replace(/^0+/, "").padStart(1, "0");
};

export const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));
export const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => (e < m ? e : m));

export const round = (value: number | string, dec = 2) => {
  const decimal = Math.pow(10, dec);
  return Math.floor(+value * decimal) / decimal;
};

export const formatAmount = (n: number | string | bigint, d: number, r?: number) => {
  const int = toReadableNumber(d, n?.toString() || "0");
  return r ? round(int, r) : +int;
};

export const parseAmount = (n: string | number | bigint, d: number) => {
  return toNonDivisibleNumber(d, (n || 0).toString());
};

export const wait = (timeout: number) => {
  return new Promise<void>((resolve) => setTimeout(resolve, timeout));
};
