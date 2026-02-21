import { describe, it, expect } from "vitest";

import HotBridge from "../src/bridge";

describe("HotBridge lazy-loading", () => {
  const bridge = new HotBridge({});

  it("evm() should return an EvmOmniService instance", async () => {
    const evm = await bridge.evm();
    expect(evm).toBeDefined();
    expect(typeof evm.getProvider).toBe("function");
    expect(typeof evm.isWithdrawUsed).toBe("function");
  });

  it("evm() should return the same cached instance on second call", async () => {
    const first = await bridge.evm();
    const second = await bridge.evm();
    expect(first).toBe(second);
  });

  it("ton() should return a TonOmniService instance", async () => {
    const ton = await bridge.ton();
    expect(ton).toBeDefined();
    expect(typeof ton.isWithdrawUsed).toBe("function");
    expect(typeof ton.deposit).toBe("function");
  });

  it("ton() should return the same cached instance on second call", async () => {
    const first = await bridge.ton();
    const second = await bridge.ton();
    expect(first).toBe(second);
  });

  it("stellar() should return a StellarService instance", async () => {
    const stellar = await bridge.stellar();
    expect(stellar).toBeDefined();
    expect(typeof stellar.isWithdrawUsed).toBe("function");
  });

  it("stellar() should return the same cached instance on second call", async () => {
    const first = await bridge.stellar();
    const second = await bridge.stellar();
    expect(first).toBe(second);
  });

  it("solana() should return a SolanaOmniService instance", async () => {
    const solana = await bridge.solana();
    expect(solana).toBeDefined();
    expect(typeof solana.isWithdrawUsed).toBe("function");
  });

  it("cosmos() should return a CosmosService instance", async () => {
    const cosmos = await bridge.cosmos();
    expect(cosmos).toBeDefined();
  });

  it("near should be available synchronously", () => {
    expect(bridge.near).toBeDefined();
    expect(typeof bridge.near.viewFunction).toBe("function");
  });
});
