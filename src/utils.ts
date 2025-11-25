import { getBytes, hexlify } from "ethers";
import { baseDecode, baseEncode } from "@near-js/utils";
import { Address as StellarAddress, xdr } from "@stellar/stellar-sdk";
import { actionCreators } from "@near-js/transactions";
import { base58, bech32 } from "@scure/base";
import { Address } from "@ton/core";
import crypto from "crypto";

import TonOmniService from "./bridge-ton";
import { createAddressRlp, parseAddressRlp } from "./bridge-ton/constants";
import { Settings, INTENT_PREFIX } from "./env";
import { Network } from "./types";

const fromBech32 = (address: string, limit = Infinity) => {
  const decodedAddress = bech32.decode(address as `${string}1${string}`, limit);
  return { prefix: decodedAddress.prefix, data: new Uint8Array(bech32.fromWords(decodedAddress.words)) };
};

const serializeBigIntInObject = (obj: Record<string, any>) => {
  for (const key in obj) {
    if (typeof obj[key] === "bigint") obj[key] = obj[key].toString();
    if (typeof obj[key] === "object") serializeBigIntInObject(obj[key]);
  }
};

export const functionCall = (args: { methodName: string; args: any; gas: string; deposit: string }) => {
  if (typeof args.args === "object") serializeBigIntInObject(args.args);
  return actionCreators.functionCall(args.methodName, args.args, BigInt(args.gas), BigInt(args.deposit));
};

export const isTon = (id: number): id is Network.OmniTon | Network.Ton => {
  return id === Network.OmniTon || id === Network.Ton;
};

export const isCosmos = (id: number) => {
  return Settings.cosmos[id] !== undefined;
};

/**
 * Convert omni id  or intent id to native chain token id, example:
 * 56_11111111111111111111 -> 56:native
 * nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56:native
 * -4:nep245:v2_1.omni.hot.tg:56_11111111111111111111 -> 56:native
 */
export const fromOmni = (id: string) => {
  id = id.split(":").pop() || id;
  if (id === "nep141:wrap.near") return "1010:native";
  if (id.startsWith("nep141:")) return `1010:${id.replace("nep141:", "")}`;
  if (!id.includes("_")) return `1010:${id}`;

  let parsed = id.split("_");
  let chain = +parsed[0];
  let decodedAddress = decodeTokenAddress(chain, parsed[1]);

  // From OMNI_TON to normal ID
  if (+chain === 1117) chain = 1111;
  return `${chain}:${decodedAddress}`;
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

  // From normal TON_ID to OMNI_TON
  if (+chain === 1111) chain = 1117;
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
  let [chain, address] = addr ? [id, addr] : String(id).split(/:(.*)/s);
  if (+chain === Network.Hot) return address;
  if (+chain === 1010 && address === "native") address = "wrap.near";
  if (+chain === 1010) return `nep141:${address}`;

  // From normal TON_ID to OMNI_TON
  if (+chain === 1111) chain = 1117;

  return `${INTENT_PREFIX}${chain}_${encodeTokenAddress(+chain, address)}`;
};

/**
 * Convert token address to unified omni address format (base58 encoded)
 */
export const encodeTokenAddress = (chain: Network, addr: string) => {
  if (isCosmos(chain)) return baseEncode(Buffer.from(addr, "utf8"));

  if (chain === Network.Solana) {
    if (addr === "native") return "11111111111111111111111111111111";
    return addr;
  }

  if (isTon(chain)) {
    if (addr === "native") return baseEncode(createAddressRlp());
    const decoded = TonOmniService.TON_MINTER_TO_JETTON_MAPPER[Address.parse(addr).toString({ bounceable: true })];
    if (!decoded) throw "Unknown token address";
    return baseEncode(createAddressRlp(Address.parse(decoded)));
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
  if (addr === "") return "native";
  if (addr === "1") return "native";
  if (addr === "11111111111111111111") return "native";
  if (addr === "11111111111111111111111111111111") return "native";
  if (addr === "111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz") return "native";
  if (isCosmos(chain)) return Buffer.from(baseDecode(addr)).toString("utf8");

  if (isTon(chain)) {
    try {
      const decoded = TonOmniService.TON_JETTON_TO_MINTER_MAPPER[Address.parse(addr).toString({ bounceable: true })];
      if (decoded) return decoded;
    } catch {}

    const token = parseAddressRlp(addr);
    const decoded = TonOmniService.TON_JETTON_TO_MINTER_MAPPER[Address.parse(token).toString({ bounceable: true })];
    if (decoded) return decoded;

    console.error("Unknown token address, use TonOmniService.registerMinterJetton", addr);
    return "";
  }

  if (chain === Network.Near) return Buffer.from(baseDecode(addr)).toString("utf8");
  if (chain === Network.Stellar) return StellarAddress.fromScVal(xdr.ScVal.fromXDR(Buffer.from(baseDecode(addr)))).toString();
  if (chain === Network.Solana) return addr;
  return hexlify(baseDecode(addr));
};

/** Build ephemeral receiver for OMNI contract, its just a user 'proxy' address to send tokens directly to intents  */
export const omniEphemeralReceiver = (intentAccount: string) => {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ account_id: "intents.near", msg: JSON.stringify({ receiver_id: intentAccount }) }))
    .digest();
};

export const legacyUnsafeOmniEphemeralReceiver = (intentAccount: string) => {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("intents.near", "utf8"))
    .update(Buffer.from(JSON.stringify({ receiver_id: intentAccount }), "utf8"))
    .digest();
};

// Encode receiver address to omni unified format (base58 encoded)
export const encodeReceiver = (chain: Network, address: string) => {
  if (chain === Network.Near) return address;
  if (chain === Network.Solana) return address;

  if (isCosmos(chain)) {
    const { data } = fromBech32(address as `${string}1${string}`);
    const bytes = new Uint8Array(data);
    return base58.encode(bytes);
  }

  if (chain === Network.Stellar) return baseEncode(StellarAddress.fromString(address).toScVal().toXDR());
  if (isTon(chain)) return baseEncode(createAddressRlp(Address.parse(address)));
  return baseEncode(getBytes(address));
};

export const decodeReceiver = (chain: Network, address: string) => {
  if (chain === Network.Near) return address;
  if (chain === Network.Solana) return address;

  if (isCosmos(chain)) {
    const config = Settings.cosmos[chain];
    return bech32.encode(config.prefix, bech32.toWords(base58.decode(address)));
  }

  if (chain === Network.Stellar) return StellarAddress.fromScVal(xdr.ScVal.fromXDR(Buffer.from(baseDecode(address)))).toString();
  if (isTon(chain)) return parseAddressRlp(address);
  return hexlify(baseDecode(address));
};

export class Logger {
  warn(...args: any[]) {
    console.warn(...args);
  }
  log(...args: any[]) {
    console.log(...args);
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
