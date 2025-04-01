import { baseDecode } from "@near-js/utils";
import { Address, beginCell, BitString, Cell, toNano } from "@ton/core";
import { createHash } from "crypto";
import RLP from "rlp";

const POLYNOMIAL = -306674912;
let crc32_table: Int32Array | undefined = undefined;

export function bigintToBuffer(bigInt: bigint, byteLength: number): Buffer {
  const buffer = Buffer.alloc(byteLength); // Allocate buffer of the given length
  let tempBigInt = bigInt;

  // Fill the buffer with bytes from the BigInt, starting from the least significant byte
  for (let i = byteLength - 1; i >= 0; i--) {
    buffer[i] = Number(tempBigInt & BigInt(0xff)); // Extract the lowest 8 bits
    tempBigInt >>= BigInt(8); // Shift the BigInt by 8 bits to the right
  }

  return buffer;
}

export function crc32(str: string, crc = 0xffffffff) {
  let bytes = Buffer.from(str);
  if (crc32_table === undefined) {
    calcTable();
  }
  for (let i = 0; i < bytes.length; ++i) crc = crc32_table![(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function calcTable() {
  crc32_table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i;
    for (let bit = 8; bit > 0; --bit) r = r & 1 ? (r >>> 1) ^ POLYNOMIAL : r >>> 1;
    crc32_table[i] = r;
  }
}
export function extractBitStringFromCell(cell: Cell): Buffer {
  let bitString = "";
  async function processCell(cell: Cell) {
    bitString += cell.bits.toString();
    for (let i = 0; i < cell.refs.length; i++) {
      processCell(cell.refs[i]);
    }
  }

  processCell(cell);
  return Buffer.from(bitString, "hex");
}

export function bufferToBigInt(buffer: Buffer): bigint {
  if (buffer.length !== 32) {
    throw new Error("Buffer must be exactly 32 bytes long");
  }

  let result: bigint = BigInt(0);
  for (let i = 0; i < buffer.length; i++) {
    result = (result << BigInt(8)) + BigInt(buffer[i]);
  }

  return result;
}

export const TRUE = BigInt(-1);
export const FALSE = BigInt(0);

export const DEFAULT_TIMEOUT = 2000;
export const DEFAULT_GAS = toNano("0.06");

export const MIN_COMMISSION = toNano("0.05");
export const MIN_CONTRACT_STORAGE = toNano("1");
export const MIN_JETTON_STORAGE = toNano("0.5");

export const NONCE_TS_SHIFT = BigInt(1_000_000_000_000);

export const REFUND_DELAY = BigInt(600); // 10 min

export const createAddressRlp = (address?: Address) => {
  const addressCell = beginCell();
  // Address contains 267 bits - adding 5 more for alignment
  if (address) addressCell.storeAddress(address).storeBits(new BitString(Buffer.alloc(5), 0, 5));
  return extractBitStringFromCell(addressCell.endCell());
};

export const parseAddressRlp = (omniAddress: string) => {
  const buffer = Buffer.from(baseDecode(omniAddress));
  const cell = new Cell({ bits: new BitString(buffer, 0, buffer.length * 8) });
  const slice = cell.asSlice();
  const address = slice.loadAddress();
  return address.toString({ bounceable: true });
};

export function createUserMsgHash(user_wallet: Address) {
  const addressCell = createAddressRlp(user_wallet);
  return createHash("sha256").update(RLP.encode(addressCell)).digest();
}

export function generateUserId(address: Address, bump: bigint): bigint {
  let hash = bufferToBigInt(createUserMsgHash(address));
  return (hash % 2n ** 63n) + bump;
}

export const OpCode = {
  storageDeposit: crc32("storage_deposit"),
  createUser: crc32("create_user"),
  userNativeWithdraw: crc32("user_native_withdraw"),
  userTokenWithdraw: crc32("user_token_withdraw"),
  nativeDeposit: crc32("native_deposit"),
  tokenDeposit: 0x7362d09c,
  adminNativeWithdraw: crc32("admin_native_withdraw"),
  adminTokenWithdraw: crc32("admin_token_withdraw"),
  changeContractOwner: crc32("change_contract_owner"),
  changeWithdrawDelegate: crc32("change_withdraw_delegate"),
  changeVerifyingPubkey: crc32("change_verifying_pubkey"),
  addToken: crc32("add_token"),
  removeToken: crc32("remove_token"),
  changeChainId: crc32("change_chain_id"),
  resetMaxNonce: crc32("reset_max_nonce"),
  updateContractCode: crc32("update_contract_code"),
  updateDepositCode: crc32("update_deposit_code"),
  updateUserCode: crc32("update_user_code"),
  selfDestruct: crc32("self_destruct"),
};

export function opToString(op: number): string {
  const opCodeToString = {
    [OpCode.storageDeposit]: "storageDeposit",
    [OpCode.createUser]: "createUser",
    [OpCode.userNativeWithdraw]: "userNativeWithdraw",
    [OpCode.userTokenWithdraw]: "userTokenWithdraw",
    [OpCode.nativeDeposit]: "nativeDeposit",
    [OpCode.tokenDeposit]: "tokenDeposit",
    [OpCode.adminNativeWithdraw]: "adminNativeWithdraw",
    [OpCode.adminTokenWithdraw]: "adminTokenWithdraw",
    [OpCode.changeContractOwner]: "changeContractOwner",
    [OpCode.changeVerifyingPubkey]: "changeVerifyingPubkey",
    [OpCode.addToken]: "addToken",
    [OpCode.removeToken]: "removeToken",
    [OpCode.changeChainId]: "changeChainId",
    [OpCode.resetMaxNonce]: "resetMaxNonce",
    [OpCode.updateContractCode]: "updateContractCode",
    [OpCode.updateDepositCode]: "updateDepositCode",
    [OpCode.updateUserCode]: "updateUserCode",
    [OpCode.selfDestruct]: "selfDestruct",
  };

  return opCodeToString[op] || "unknown";
}

export const ErrorCode = {
  invalidSender: 500,
  invalidSignature: 502,
  lowBalance: 503,
  unknownToken: 504,
  invalidNonce: 505,
  notExpiredNonce: 506,
  expiredNonce: 507,
  unauthorizedUser: 508,
  invalidFeeBalance: 37,
  invalidWorkchain: 333,
  unknownOP: 65535,
  invalidJettonBalance: 706,
};
