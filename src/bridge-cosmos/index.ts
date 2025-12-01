import { baseDecode, baseEncode } from "@near-js/utils";
import { encodePubkey, makeSignDoc } from "@cosmjs/proto-signing";
import { fromBech32, toBech32, toUtf8 } from "@cosmjs/encoding";
import { StargateClient } from "@cosmjs/stargate";

import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { AuthInfo, Fee, SignerInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { omniEphemeralReceiver } from "../utils";
import { PendingDeposit, WithdrawArgs } from "../types";
import OmniService from "../bridge";
import { ReviewFee } from "../fee";
import { smartQuery } from "./utils";
import { Settings } from "../env";

export class CosmosService {
  constructor(readonly omni: OmniService) {}

  async getWithdrawFee(chain: number): Promise<ReviewFee> {
    return new ReviewFee({ chain, gasLimit: Settings.cosmos[chain].gasLimit });
  }

  async getDepositFee(chain: number, sender: string, token: string, amount: bigint, intentAccount: string): Promise<ReviewFee> {
    return new ReviewFee({ chain, gasLimit: Settings.cosmos[chain].gasLimit });
  }

  async isWithdrawUsed(chain: number, nonce: string): Promise<boolean> {
    const rpcUrl = Settings.cosmos[chain].rpc;
    const contractAddress = Settings.cosmos[chain].contract;
    const result = await smartQuery(rpcUrl, contractAddress, { is_withdrawn: nonce });
    return result !== null;
  }

  convertAddress(chain: number, address: string) {
    const prefix = Settings.cosmos[chain].prefix;
    if (address.startsWith(prefix)) return address;
    const { data } = fromBech32(address);
    return toBech32(prefix, data);
  }

  async deposit(args: {
    chain: number;
    token: string;
    amount: bigint;
    senderPublicKey: Uint8Array;
    intentAccount: string;
    sender: string;
    sendTransaction: (tx: any) => Promise<string>;
  }): Promise<string> {
    this.omni.api.registerDeposit(args.intentAccount);
    const receiver = omniEphemeralReceiver(args.intentAccount);
    const address = this.convertAddress(args.chain, args.sender);
    const { nativeToken, chainId, gasLimit } = Settings.cosmos[args.chain];

    const client = await StargateClient.connect(Settings.cosmos[args.chain].rpc);
    const account = await client.getAccount(address);
    if (account == null) throw new Error("Account not found");

    const denom = args.token === "native" ? nativeToken : args.token;
    const msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.encode({
        contract: Settings.cosmos[args.chain].contract,
        msg: toUtf8(JSON.stringify({ deposit: { receiver_id: Buffer.from(receiver).toString("base64") } })),
        funds: [{ denom, amount: args.amount.toString() }],
        sender: address,
      }).finish(),
    };

    const txBody = TxBody.fromPartial({ messages: [msg], memo: "" });
    const fee = Fee.fromPartial({ gasLimit, amount: [{ denom: nativeToken, amount: String(gasLimit) }] });

    let pubKey = encodePubkey({ type: "tendermint/PubKeySecp256k1", value: Buffer.from(args.senderPublicKey).toString("base64") });
    if (account.pubkey) pubKey = encodePubkey(account.pubkey);

    const signer = SignerInfo.fromPartial({
      modeInfo: { single: { mode: 1 } },
      sequence: BigInt(account.sequence),
      publicKey: pubKey,
    });

    const authInfo = AuthInfo.encode(AuthInfo.fromPartial({ signerInfos: [signer], fee })).finish();
    const signDoc = makeSignDoc(TxBody.encode(txBody).finish(), authInfo, chainId, account.accountNumber);
    const result = await args.sendTransaction(signDoc);
    return result;
  }

  async withdraw(args: WithdrawArgs & { sender: string; senderPublicKey: Uint8Array; sendTransaction: (tx: any) => Promise<string> }) {
    const signature = await this.omni.api.withdrawSign(args.nonce);
    const sign = Buffer.from(baseDecode(signature));

    const { nativeToken, chainId, gasLimit, rpc, contract } = Settings.cosmos[args.chain];
    const address = this.convertAddress(args.chain, args.sender);

    const client = await StargateClient.connect(rpc);
    const account = await client.getAccount(address);
    if (account == null) throw new Error("Account not found");

    const action = JSON.stringify({
      withdraw: {
        nonce: args.nonce,
        receiver_id: Buffer.from(fromBech32(args.receiver).data).toString("base64"),
        signature: sign.toString("base64"),
        amount: args.amount.toString(),
        denom: args.token,
      },
    });

    const msg = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.encode({
        contract: contract,
        msg: toUtf8(action),
        sender: address,
        funds: [],
      }).finish(),
    };

    const txBody = TxBody.fromPartial({ messages: [msg], memo: "" });
    const fee = Fee.fromPartial({ gasLimit, amount: [{ denom: nativeToken, amount: String(gasLimit) }] });

    let pubKey = encodePubkey({ type: "tendermint/PubKeySecp256k1", value: Buffer.from(args.senderPublicKey).toString("base64") });
    if (account.pubkey) pubKey = encodePubkey(account.pubkey);

    const signer = SignerInfo.fromPartial({
      sequence: BigInt(account.sequence),
      modeInfo: { single: { mode: 1 } },
      publicKey: pubKey,
    });

    const authInfo = AuthInfo.encode(AuthInfo.fromPartial({ signerInfos: [signer], fee })).finish();
    const signDoc = makeSignDoc(TxBody.encode(txBody).finish(), authInfo, chainId, account.accountNumber);
    const result = await args.sendTransaction(signDoc);
    return result;
  }

  async clearDepositNonceIfNeeded(_: any) {}

  async parseDeposit(chain: number, hash: string): Promise<PendingDeposit> {
    const client = await StargateClient.connect(Settings.cosmos[chain].rpc);
    const tx = await client.getTx(hash);

    const event = tx?.events.find((t) => t.type === "wasm");
    if (event == null) throw new Error("Event not found");
    const nonce = event.attributes.find((t) => t.key === "nonce")?.value;
    const receiver = event.attributes.find((t) => t.key === "receiver_id")?.value;
    const amount = event.attributes.find((t) => t.key === "amount")?.value;
    const token = event.attributes.find((t) => t.key === "denom")?.value;

    const sender = tx?.events.find((t) => t.type === "message")?.attributes.find((t) => t.key === "sender")?.value;
    if (sender == null) throw new Error("Sender not found");
    if (nonce == null) throw new Error("Nonce not found");
    if (receiver == null) throw new Error("Receiver not found");
    if (amount == null) throw new Error("Amount not found");
    if (token == null) throw new Error("Token not found");

    return {
      tx: hash,
      receiver: baseEncode(Buffer.from(receiver, "hex")),
      nonce: nonce.toString(),
      amount: amount.toString(),
      sender: sender.toString(),
      timestamp: Date.now(),
      chain: chain,
      token: token,
    };
  }
}
