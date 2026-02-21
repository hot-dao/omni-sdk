import { describe, it, expect } from "vitest";

import { encodeTokenAddress, decodeTokenAddress, encodeReceiver, decodeReceiver } from "../src/utils";
import { Network } from "../src/types";

describe("utils - address encoding (@scure/base hex)", () => {
  const evmAddress = "0x391E7C679d29bD940d63be94AD22A25d25b5A604";

  it("EVM token address should roundtrip encode/decode", () => {
    const encoded = encodeTokenAddress(Network.Eth, evmAddress);
    const decoded = decodeTokenAddress(Network.Eth, encoded);
    expect(decoded).toBe(evmAddress.toLowerCase());
  });

  it("EVM receiver should roundtrip encode/decode", () => {
    const encoded = encodeReceiver(Network.Eth, evmAddress);
    const decoded = decodeReceiver(Network.Eth, encoded);
    expect(decoded).toBe(evmAddress.toLowerCase());
  });

  it("EVM native should encode/decode correctly", () => {
    expect(encodeTokenAddress(Network.Eth, "native")).toBe("11111111111111111111");
    expect(decodeTokenAddress(Network.Eth, "11111111111111111111")).toBe("native");
  });
});
