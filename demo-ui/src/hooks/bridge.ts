import { HotConnector } from "@hot-labs/kit";
import cosmos from "@hot-labs/kit/cosmos";
import evm from "@hot-labs/kit/evm";
import stellar from "@hot-labs/kit/stellar";
import solana from "@hot-labs/kit/solana";
import ton from "@hot-labs/kit/ton";
import near from "@hot-labs/kit/near";

export const wibe3 = new HotConnector({
  connectors: [
    near(),
    evm(),
    cosmos(),
    stellar(),
    solana(),
    ton({ tonManifestUrl: "https://hot-dao.github.io/omni-sdk/tonconnect-manifest.json" }),
  ],
  apiKey: "",
});
