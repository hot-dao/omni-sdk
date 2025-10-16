export class ApiError extends Error {
  constructor(readonly status: number, readonly method: "GET" | "POST", readonly request: string, readonly message: string) {
    super(`${method} ${request} failed with status ${status}: ${message}`);
  }
}

export class CompletePreviousWithdrawalsError extends Error {
  constructor(readonly chain: number, readonly receiver: string, readonly nonce: string) {
    super(`Complete previous withdrawal with nonce "${nonce}" before make new in chain "${chain}" to receiver "${receiver}"`);
  }
}

export class GaslessNotAvailableError extends Error {
  constructor(chain: number) {
    super(`Gasless withdraw not available for chain "${chain}"`);
  }
}

export class GaslessWithdrawTxNotFoundError extends Error {
  constructor(readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw tx not found for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class GaslessWithdrawCanceledError extends Error {
  constructor(readonly reason: string, readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw canceled for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class ProcessAbortedError extends Error {
  constructor(readonly process: string) {
    super(`Process ${process} aborted`);
  }
}

export class MismatchReceiverAndIntentAccountError extends Error {
  constructor(readonly receiver: string, readonly intentAccount: string) {
    super(`Mismatch receiver and intent account: ${receiver} and ${intentAccount}`);
  }
}

export class IntentBalanceIsLessThanAmountError extends Error {
  constructor(readonly token: string, readonly intentAccount: string, readonly amount: bigint) {
    super(`Intent balance is less than amount for token ${token} on intent account ${intentAccount} (amount: ${amount})`);
  }
}

export class IncorrectIntentDiffError extends Error {
  constructor(readonly reason: string) {
    super(`Incorrect intent diff: ${reason}`);
  }
}

export class SlippageError extends Error {
  constructor(readonly minAmountOut: bigint, readonly amountOut: bigint) {
    super(`Slippage error: minAmountOut: ${minAmountOut}, amountOut: ${amountOut}`);
  }
}

export class NearTokenNotRegisteredError extends Error {
  constructor(readonly token: string, readonly intentAccount: string) {
    super(`Near token ${token} not registered on intent account ${intentAccount}`);
  }
}

export class StellarTokenNotTrustedError extends Error {
  constructor(readonly token: string, readonly receiver: string) {
    super(`Stellar token ${token} not trusted by receiver ${receiver}`);
  }
}

export class DepositNotFoundError extends Error {
  constructor(readonly chain: number, readonly hash: string, readonly reason: string) {
    super(`Deposit not found for hash ${hash} on chain ${chain}: ${reason}`);
  }
}

export class DepositAlreadyClaimedError extends Error {
  constructor(readonly chain: number, readonly hash: string) {
    super(`Deposit already claimed for hash ${hash} on chain ${chain}`);
  }
}

export class WithdrawalNotFoundError extends Error {
  constructor(readonly nonce: string) {
    super(`Withdrawal not found for nonce "${nonce}"`);
  }
}

export class FailedToExecuteDepositError extends Error {
  constructor(reason?: string) {
    super(`Failed to execute deposit: ${reason || "Unknown error"}`);
  }
}

export class UnsupportedTokenFormatError extends Error {
  constructor(readonly token: string) {
    super(`Unsupported token format: ${token}`);
  }
}
