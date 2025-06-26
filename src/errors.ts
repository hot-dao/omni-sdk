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
