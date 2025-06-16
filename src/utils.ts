import { getBytes, hexlify } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";
import { Address as StellarAddress, xdr } from "@stellar/stellar-sdk";
import { transactions } from "near-api-js";
import { Address } from "@ton/core";
import crypto from "crypto";

import { bigintToBuffer, createAddressRlp, parseAddressRlp } from "./bridge-ton/constants";
import { generateUserId } from "./bridge-ton-v1/constants";
import { Network, TonVersion } from "./types";

export const OMNI_HOT_V2 = "v2_1.omni.hot.tg";
export const INTENT_PREFIX = "nep245:v2_1.omni.hot.tg:";

export const TGAS = 1000000000000n;

export const functionCall = (args: { methodName: string; args: any; gas: string; deposit: string }) => {
  return transactions.functionCall(args.methodName, JSON.parse(JSON.stringify(args.args, (_, v) => (typeof v === "bigint" ? v.toString() : v))), BigInt(args.gas), BigInt(args.deposit));
};

export const isTon = (id: number): id is TonVersion => {
  return id === Network.Ton || id === Network.LegacyTon;
};

/**
 * Convert omni id  or intent id to native chain token id, example:
 * 56_11111111111111111111 -> 56:native
 * nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56:native
 * -4:nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56:native
 */
export const fromOmni = (id: string) => {
  id = id.split(":").pop() || id;

  // TRON PoA bridge supported
  if (id === "tron.omft.near") return `${Network.Tron}:native`;
  if (id === "tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near") return `${Network.Tron}:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;

  // Other PoA tokens only to NEAR
  if (id.startsWith("nep141:")) return `1010:${id.replace("nep141:", "")}`;
  if (!id.includes("_")) return `1010:${id}`;

  let [chain, encodedAddress] = id.split("_");
  return `${chain}:${decodeTokenAddress(+chain, encodedAddress)}`;
};

/**
 * Convert token id or intent id to omni address format (base58 encoded), example:
 * 56:native -> 56_11111111111111111111
 * nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56_11111111111111111111
 * -4:nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56_11111111111111111111 (format with chainId, Intens has -4 chain id)
 * nep141:wrap.near -> nep141:wrap.near
 */
export const toOmni = (id: string | number, addr?: string) => {
  if (id.toString().startsWith("nep141:")) return id.toString();
  if (id.toString().startsWith(INTENT_PREFIX)) return id.toString().replace(INTENT_PREFIX, "");
  let [chain, address] = addr ? [id, addr] : String(id).split(/:(.*)/s);

  // PoA bridge tokens
  if (+chain === Network.Tron && address === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t") return `tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near`;
  if (+chain === Network.Tron && address === "native") return `tron.omft.near`;
  if (+chain === Network.Zcash && address === "native") return `zec.omft.near`;
  if (+chain === Network.Btc && address === "native") return `btc.omft.near`;

  if (+chain === Network.Hot) return address.replace(INTENT_PREFIX, "");
  if (+chain === Network.Near) return address;
  return `${chain}_${encodeTokenAddress(+chain, address)}`;
};

/**
 * Convert token id to omni intent id, example:
 * 56:0x391E7C679d29bD940d63be94AD22A25d25b5A604 -> nep245:v2_1.omni.hot.tg:56_base56encoded
 * 1010:native -> nep141:wrap.near
 */
export const toOmniIntent = (id: string | number, addr?: string): string => {
  // eslint-disable-next-line prefer-const
  let [chain, address] = addr ? [id, addr] : String(id).split(/:(.*)/s);
  if (+chain === Network.Hot) return address;
  if (+chain === 1010 && address === "native") address = "wrap.near";
  if (+chain === 1010) return `nep141:${address}`;

  // PoA bridge tokens
  if (+chain === Network.Tron && address === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t") return `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near`;
  if (+chain === Network.Tron && address === "native") return `nep141:tron.omft.near`;
  if (+chain === Network.Zcash && address === "native") return `nep141:zec.omft.near`;
  if (+chain === Network.Btc && address === "native") return `nep141:btc.omft.near`;
  return `${INTENT_PREFIX}${chain}_${encodeTokenAddress(+chain, address)}`;
};

/**
 * Convert token address to unified omni address format (base58 encoded)
 */
export const encodeTokenAddress = (chain: Network, addr: string) => {
  if (chain === Network.Solana) {
    if (addr === "native") return "11111111111111111111111111111111";
    return addr;
  }

  if (isTon(chain)) {
    if (addr === "native") return baseEncode(createAddressRlp());
    return baseEncode(createAddressRlp(Address.parse(addr)));
  }

  if (chain === Network.Stellar) {
    if (addr === "native") return "111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz";
    return baseEncode(StellarAddress.fromString(addr).toScVal().toXDR());
  }

  if (chain === Network.Near) {
    return baseEncode(Buffer.from(addr, "utf8"));
  }

  // EVM
  if (addr === "native") return "11111111111111111111";
  return baseEncode(getBytes(addr));
};

/**
 * Convert unified omni address format (base58 encoded) to native chain address format
 */
export const decodeTokenAddress = (chain: Network, addr: string) => {
  try {
    if (addr === "1") return "native";
    if (addr === "11111111111111111111") return "native";
    if (addr === "11111111111111111111111111111111") return "native";
    if (addr === baseEncode(createAddressRlp())) return "native";
    if (addr === "111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz") return "native";

    if (isTon(chain)) return parseAddressRlp(addr);
    if (chain === Network.Near) return Buffer.from(baseDecode(addr)).toString("utf8");
    if (chain === Network.Stellar) return StellarAddress.fromScVal(xdr.ScVal.fromXDR(Buffer.from(baseDecode(addr)))).toString();
    if (chain === Network.Solana) return addr;
    return hexlify(baseDecode(addr));
  } catch {
    return "";
  }
};

/** Build ephemeral receiver for OMNI contract, its just a user 'proxy' address to send tokens directly to intents  */
export const omniEphemeralReceiver = (intentAccount: string) => {
  return crypto
    .createHash("sha256") //
    .update(Buffer.from("intents.near", "utf8"))
    .update(Buffer.from(JSON.stringify({ receiver_id: intentAccount }), "utf8"))
    .digest();
};

// Encode receiver address to omni unified format (base58 encoded)
export const encodeReceiver = (chain: Network, address: string) => {
  if (chain === Network.Near) return address;
  if (chain === Network.Solana) return address;
  if (chain === Network.Stellar) return baseEncode(StellarAddress.fromString(address).toScVal().toXDR());

  if (chain === Network.Ton) return baseEncode(createAddressRlp(Address.parse(address)));

  if (chain === Network.LegacyTon) {
    const id = Address.isFriendly(address) ? generateUserId(Address.parse(address), 0n) : BigInt(address);
    return baseEncode(bigintToBuffer(id, 32));
  }

  return baseEncode(getBytes(address));
};

export const decodeReceiver = (chain: Network, address: string) => {
  if (chain === Network.Near) return address;
  if (chain === Network.Solana) return address;
  if (chain === Network.Stellar) return StellarAddress.fromScVal(xdr.ScVal.fromXDR(Buffer.from(baseDecode(address)))).toString();

  if (chain === Network.LegacyTon) return BigInt("0x" + Buffer.from(baseDecode(address)).toString("hex")).toString();
  if (chain === Network.Ton) return parseAddressRlp(address);

  return hexlify(baseDecode(address));
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
