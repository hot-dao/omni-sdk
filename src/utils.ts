import { getBytes, hexlify, sha256 } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";
import { Address as StellarAddress, xdr } from "@stellar/stellar-sdk";
import { Address } from "@ton/core";

import { createAddressRlp, parseAddressRlp } from "./bridge-ton/constants";
import { Network, Chains } from "./chains";

export const OMNI_HOT = "v1-1.omni.hot.tg";
export const OMNI_HELPER = "v1-1.omni-helper.hot.tg";

export const OMNI_HOT_V2 = "v2.omni.hot.tg";
export const OMNI_HELPER_V2 = "v2.omni-helper.hot.tg";
export const INTENT_PREFIX = "nep245:v2.omni.hot.tg:";

export const TGAS = 1000000000000n;

/**
 * Convert omni id  or intent id to native chain token id, example:
 * 56_11111111111111111111 -> 56:native
 * nep245:v2.omni.hot.tg:56_11111111111111111111 -> 56:native
 * -4:nep245:v2.omni.hot.tg:56_11111111111111111111 -> 56:native
 */
export const fromOmni = (id: string) => {
  id = id.includes(":") ? id.split(/:(.*)/s)[1] : id;
  const [chain, encodedAddress] = id.replace(INTENT_PREFIX, "").split("_");
  return `${chain}:${base2Address(+chain, encodedAddress)}`;
};

/**
 * Convert token id or intent id to omni address format (base58 encoded), example:
 * 56:native -> 56_11111111111111111111
 * nep245:v2.omni.hot.tg:56_11111111111111111111 -> 56_11111111111111111111
 * -4:nep245:v2.omni.hot.tg:56_11111111111111111111 -> 56_11111111111111111111 (format with chainId, Intens has -4 chain id)
 */
export const toOmni = (id: string | number, addr?: string) => {
  if (id.toString().startsWith(INTENT_PREFIX)) return id.toString().replace(INTENT_PREFIX, "");
  const [chain, address] = addr ? [id, addr] : String(id).split(/:(.*)/s);
  if (+chain === Network.Hot) return address.replace(INTENT_PREFIX, "");
  return `${chain}_${address2base(+chain, address)}`;
};

/**
 * Convert token id to omni intent id, example:
 * 56:0x391E7C679d29bD940d63be94AD22A25d25b5A604 -> nep245:v2.omni.hot.tg:56_base56encoded
 */
export const toOmniIntent = (id: string | number, addr?: string) => {
  const [chain, address] = addr ? [id, addr] : String(id).split(/:(.*)/s);
  if (+chain === Network.Hot) return address;
  return `${INTENT_PREFIX}${chain}_${address2base(+chain, address)}`;
};

/**
 * Convert address to omni address format (base58 encoded)
 */
export const address2base = (chain: Network, addr: string) => {
  if (Chains.get(chain)?.isEvm) {
    if (addr === "native") return "11111111111111111111";
    return baseEncode(getBytes(addr));
  }

  if (chain === Network.Solana) {
    if (addr === "native") return "11111111111111111111111111111111";
    return addr;
  }

  if (chain === Network.Ton) {
    if (addr === "native") return baseEncode(createAddressRlp());
    return baseEncode(createAddressRlp(Address.parse(addr)));
  }

  if (chain === Network.Stellar) {
    if (addr === "native") return "111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz";
    return baseEncode(StellarAddress.fromString(addr).toScVal().toXDR());
  }

  return baseEncode(Buffer.from(addr, "utf8"));
};

/**
 * Convert omni address format (base58 encoded) to native chain address format
 */
export const base2Address = (chain: Network, addr: string) => {
  try {
    if (addr === "1") return "native";
    if (addr === "11111111111111111111") return "native";
    if (addr === "11111111111111111111111111111111") return "native";
    if (addr === baseEncode(createAddressRlp())) return "native";
    if (addr === "111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz") return "native";

    if (chain === Network.Stellar) return StellarAddress.fromScVal(xdr.ScVal.fromXDR(Buffer.from(baseDecode(addr)))).toString();
    if (chain === Network.Ton) return parseAddressRlp(addr);
    if (chain === Network.Solana) return addr;
    if (Chains.get(chain)?.isEvm) return hexlify(baseDecode(addr));
    return Buffer.from(baseDecode(addr)).toString("utf8");
  } catch {
    return "";
  }
};

export const encodeReceiver = (chain: Network, address: string) => {
  if (chain === Network.Near) return address;
  if (chain === Network.Solana) return address;
  if (Chains.get(chain)?.isEvm) return baseEncode(getBytes(address));
  if (chain === Network.Stellar) return baseEncode(StellarAddress.fromString(address).toScVal().toXDR());
  if (chain === Network.Ton) return baseEncode(createAddressRlp(Address.parse(address)));
  throw `Unsupported chain address ${chain}`;
};

/**
 * Convert near address to omni address format (base58 encoded)
 */
export const getOmniAddress = (address: string) => {
  return baseEncode(getBytes(sha256(Buffer.from(address, "utf8"))));
};

/**
 * Convert near address to omni address format (hex encoded)
 */
export const getOmniAddressHex = (address: string) => {
  return sha256(Buffer.from(address, "utf8"));
};

// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

export class Logger {
  log(msg: string) {
    console.log(msg);
  }
}

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
