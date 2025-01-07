import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Contract } from "ethers";
import { Address } from "@ton/core";
import * as sol from "@solana/web3.js";

import OmniService, { OMNI_HOT } from ".";
import { client } from "../signers/TonSigner";
import { createProvider } from "../signers/EvmSigner";

import { getChain, Network, networks } from "./chains";
import { JettonWallet } from "./ton/wrappers/jetton/JettonWallet";
import { JettonMinter } from "./ton/wrappers/jetton/JettonMinter";
import { ERC20_ABI, OMNI_CONTRACT } from "./evm/constants";
import { PROGRAM_ID } from "./solana/helpers";
import { omniToNative } from "./utils";

class OmniToken {
  constructor(readonly omni: OmniService, readonly id: number) {}

  async liquidity(chain: Network) {
    if (chain === Network.Near) {
      const { address } = await this.metadata(chain);
      if (address.endsWith(".omt.tg")) return 10n ** 255n; // Unlimited liquidity
      return this.balance(chain, OMNI_HOT);
    }

    if (chain == Network.Ton) return this.balance(chain, this.omni.ton.metaWallet.address.toString());
    if (chain === Network.Solana) return this.balance(chain, PROGRAM_ID.toBase58());
    if (getChain(chain).isEvm) return this.balance(chain, OMNI_CONTRACT);
    return 0n;
  }

  async chains() {
    return await this.omni.signers.near.viewFunction({
      args: { chain_ids: networks.map((t) => t.id), token_id: this.id },
      methodName: "get_token_info",
      contractId: OMNI_HOT,
    });
  }

  async balance(chain: Network, account = this.omni.signer(chain)) {
    if (chain === Network.Hot) {
      const balances = await this.omni.getOmniBalances(account);
      return BigInt(balances[this.id] || 0n);
    }

    const metadata = await this.metadata(chain);

    if (chain === Network.Solana) {
      const rpc = this.omni.signers.solana.connection;
      const [stateAccount] = sol.PublicKey.findProgramAddressSync([Buffer.from("state", "utf8")], PROGRAM_ID);
      if (metadata.address === "native") return BigInt(await rpc.getBalance(stateAccount));
      const ATA = getAssociatedTokenAddressSync(new sol.PublicKey(metadata.address), stateAccount, true);
      const meta = await rpc.getTokenAccountBalance(ATA);
      return BigInt(meta.value.amount);
    }

    if (chain === Network.Near) {
      const balance = await this.omni.signers.near.viewFunction({
        args: { account_id: account },
        methodName: "ft_balance_of",
        contractId: metadata.address,
      });

      return BigInt(balance);
    }

    if (chain === Network.Ton) {
      const minter = client.open(JettonMinter.createFromAddress(Address.parse(metadata.address)));
      const metaJettonWalletAddress = await minter.getWalletAddressOf(Address.parse(account));
      const userJetton = client.open(JettonWallet.createFromAddress(metaJettonWalletAddress));
      return await userJetton.getJettonBalance();
    }

    if (getChain(chain).isEvm) {
      const rpc = createProvider(getChain(chain));
      if (metadata.address === "native") return await rpc.getBalance(account);
      const contract = new Contract(metadata.address, ERC20_ABI, rpc);
      const result = await contract.balanceOf(account);
      return BigInt(result);
    }

    return 0n;
  }

  async metadata(chain: Network) {
    if (chain === Network.Hot) return { address: String(this.id), decimals: 24, omniAddress: this.id };
    const data = await this.omni.signers.near.functionCall({
      args: { token_id: this.id, chain_ids: [chain] },
      methodName: "get_token_info",
      contractId: OMNI_HOT,
    });

    if (data[chain] == null) throw `Omni #${this.id} not found for chain #${chain}`;
    const omniAddress = data[chain].contract_id;

    return {
      address: omniToNative(chain, omniAddress),
      decimals: data[chain].decimals,
      omniAddress,
    };
  }
}

export default OmniToken;
