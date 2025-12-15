import { HotConnector } from "@hot-labs/kit";
import { defaultConnectors } from "@hot-labs/kit/defaults";
import cosmos from "@hot-labs/kit/cosmos";

export const wibe3 = new HotConnector({
  connectors: [...defaultConnectors, cosmos()],
  apiKey: "",
});
