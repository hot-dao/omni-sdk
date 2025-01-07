import AdvancedConnection from "solana-advanced-connection";
import * as sol from "@solana/web3.js";

export const RPC_EVERSTAKE = "";
export const RPC_QUICKNODE = "";
export const connection = new AdvancedConnection([RPC_EVERSTAKE, RPC_QUICKNODE]);

export default class SolanaSigner {
  address: string;
  publicKey: sol.PublicKey;
}
