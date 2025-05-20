import React from "react";
import { createRoot } from "react-dom/client";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { WagmiProvider } from "wagmi";

import { config } from "./hooks/evm";
import { connector } from "./hooks/ton";
import App from "./App";

const queryClient = new QueryClient();

const container = document.getElementById("root");
if (!container) throw new Error("Failed to find the root element");
const root = createRoot(container);

root.render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider>
        <TonConnectUIProvider connector={connector} manifestUrl="/tonconnect-manifest.json">
          <App />
        </TonConnectUIProvider>
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
