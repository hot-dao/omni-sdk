export class GaslessNotAvailable extends Error {
  constructor(chain: number) {
    super(`Gasless withdraw not available for chain ${chain}`);
  }
}

export class GaslessWithdrawTxNotFound extends Error {
  constructor(readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw tx not found for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class GaslessWithdrawCanceled extends Error {
  constructor(readonly reason: string, readonly nonce: string, readonly chain: number, readonly receiver: string) {
    super(`Gasless withdraw canceled for nonce ${nonce} on chain ${chain} for receiver ${receiver}`);
  }
}

export class ProcessAborted extends Error {
  constructor(readonly process: string) {
    super(`Process ${process} aborted`);
  }
}

export class MismatchReceiverAndIntentAccount extends Error {
  constructor(readonly receiver: string, readonly intentAccount: string) {
    super(`Mismatch receiver and intent account: ${receiver} and ${intentAccount}`);
  }
}

export class IntentBalanceIsLessThanAmount extends Error {
  constructor(readonly token: string, readonly intentAccount: string, readonly amount: bigint) {
    super(`Intent balance is less than amount for token ${token} on intent account ${intentAccount} (amount: ${amount})`);
  }
}

export class IncorrectIntentDiff extends Error {
  constructor(readonly reason: string) {
    super(`Incorrect intent diff: ${reason}`);
  }
}

export class SlippageError extends Error {
  constructor(readonly minAmountOut: bigint, readonly amountOut: bigint) {
    super(`Slippage error: minAmountOut: ${minAmountOut}, amountOut: ${amountOut}`);
  }
}

export class NearTokenNotRegistered extends Error {
  constructor(readonly token: string, readonly intentAccount: string) {
    super(`Near token ${token} not registered on intent account ${intentAccount}`);
  }
}

export class StellarTokenNotTrusted extends Error {
  constructor(readonly token: string, readonly receiver: string) {
    super(`Stellar token ${token} not trusted by receiver ${receiver}`);
  }
}
