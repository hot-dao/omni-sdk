import { toNano } from "@ton/core";
import { crc32 } from "../constants";

export const TRUE = BigInt(-1);
export const FALSE = BigInt(0);

export const DEFAULT_TIMEOUT = 2000;
export const DEFAULT_GAS = toNano("0.06");

export const MIN_COMMISSION = toNano("0.05");
export const MIN_CONTRACT_STORAGE = toNano("1");
export const MIN_JETTON_STORAGE = toNano("0.01");

export const NONCE_TS_SHIFT = BigInt(1_000_000_000_000);

export const TON = 1_000_000_000;
export const PRECISION = 2;

export function fromNano(value: bigint): number {
  return Number(value) / TON;
}

export const OpCode = {
  storageDeposit: crc32("storage_deposit"),
  userNativeWithdraw: crc32("user_native_withdraw"),
  userTokenWithdraw: crc32("user_token_withdraw"),
  nativeDeposit: crc32("native_deposit"),
  tokenDeposit: 0x7362d09c,
  adminNativeWithdraw: crc32("admin_native_withdraw"),
  adminTokenWithdraw: crc32("admin_token_withdraw"),
  changeContractOwner: crc32("change_contract_owner"),
  changeVerifyingPubkey: crc32("change_verifying_pubkey"),
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
    [OpCode.userNativeWithdraw]: "userNativeWithdraw",
    [OpCode.userTokenWithdraw]: "userTokenWithdraw",
    [OpCode.nativeDeposit]: "nativeDeposit",
    [OpCode.tokenDeposit]: "tokenDeposit",
    [OpCode.adminNativeWithdraw]: "adminNativeWithdraw",
    [OpCode.adminTokenWithdraw]: "adminTokenWithdraw",
    [OpCode.changeContractOwner]: "changeContractOwner",
    [OpCode.changeVerifyingPubkey]: "changeVerifyingPubkey",
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
  invalidUserId: 509,
  invalidFeeBalance: 37,
  invalidWorkchain: 333,
  unknownOP: 65535,
  invalidJettonBalance: 706,
};
