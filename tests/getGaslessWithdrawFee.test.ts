import { describe, it, expect, vi } from "vitest";
import { JsonRpcProvider } from "ethers";

import { GaslessNotAvailableError } from "../src/errors";
import HotBridge from "../src/bridge";
import { Network } from "../src/types";

describe("HotBridge.getGaslessWithdrawFee", () => {
  const bridge = new HotBridge({
    evmRpc: (chain: number) => new JsonRpcProvider("https://api0.herewallet.app/api/v1/evm/rpc/" + chain),
  });

  describe("Solana chain", () => {
    it("should throw GaslessNotAvailableError for Solana", async () => {
      const options = { chain: Network.Solana, token: "native", receiver: "test-receiver" };
      await expect(bridge.getGaslessWithdrawFee(options)).rejects.toThrow(GaslessNotAvailableError);
      await expect(bridge.getGaslessWithdrawFee(options)).rejects.toThrow(`Gasless withdraw not available for chain "${Network.Solana}"`);
    });
  });

  describe("Stellar chain", () => {
    it("should return 11000000n gasPrice when account does not exist", async () => {
      const options = { chain: Network.Stellar, token: "native", receiver: "GCBFLHIV5NHWRPJDVKYA3CGAFAGHSRGO2TSGKGBSHYZYGT75JDQ7HQEV" };
      const result = await bridge.getGaslessWithdrawFee(options);
      expect(result).toEqual({ gasPrice: 11000000n, blockNumber: 0n });
    }, 60000);

    it("should return 1000000n gasPrice when account exists", async () => {
      const options = { chain: Network.Stellar, token: "native", receiver: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" };
      const result = await bridge.getGaslessWithdrawFee(options);
      expect(result).toEqual({ gasPrice: 1000000n, blockNumber: 0n });
    });
  });

  describe("Zero fee chains", () => {
    const zeroFeeChains = [Network.Juno, Network.Gonka, Network.Near, Network.Hot];
    it.each(zeroFeeChains)("should return 0n gasPrice for chain %s", async (chain: Network) => {
      const options = { chain, token: "native", receiver: "test-receiver" };
      const result = await bridge.getGaslessWithdrawFee(options);
      expect(result).toEqual({ gasPrice: 0n, blockNumber: 0n });
    });
  });

  describe("TON chains", () => {
    it("should return 40000000n gasPrice for Ton", async () => {
      const options = { chain: Network.Ton, token: "native", receiver: "test-receiver" };
      const result = await bridge.getGaslessWithdrawFee(options);
      expect(result).toEqual({ gasPrice: 40000000n, blockNumber: 0n });
    });
  });

  describe("EVM chains", () => {
    it("should calculate fee correctly for EVM chain with custom gasLimit (100_000n)", async () => {
      const MOCK_GAS_PRICE = 1000000000n;
      const MOCK_BLOCK_NUMBER = 99999n;

      bridge.withdrawFees = { [Network.Eth]: 100_000n };
      const evmBridge = await bridge.evm();
      evmBridge.getProvider = vi.fn().mockReturnValue({
        getFeeData: vi.fn().mockResolvedValue({ gasPrice: MOCK_GAS_PRICE }),
        getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK_NUMBER),
      });

      const options = { chain: Network.Eth, token: "0x123", receiver: "0xabc" };
      const result = await bridge.getGaslessWithdrawFee(options);

      const expectedGasLimit = 100_000n;
      const expectedFee = (MOCK_GAS_PRICE * 130n) / 100n;
      const expectedGasPrice = expectedFee * expectedGasLimit;

      expect(result).toEqual({ gasPrice: expectedGasPrice, blockNumber: MOCK_BLOCK_NUMBER });
    }, 60000);

    it("should calculate fee correctly for EVM chain with default gasLimit (1_000_000n)", async () => {
      const MOCK_GAS_PRICE = 1000000000n;
      const MOCK_BLOCK_NUMBER = 99999n;

      bridge.withdrawFees = {};
      const evmBridge = await bridge.evm();
      evmBridge.getProvider = vi.fn().mockReturnValue({
        getFeeData: vi.fn().mockResolvedValue({ gasPrice: MOCK_GAS_PRICE }),
        getBlockNumber: vi.fn().mockResolvedValue(MOCK_BLOCK_NUMBER),
      });

      const options = { chain: Network.Eth, token: "0x123", receiver: "0xabc" };
      const result = await bridge.getGaslessWithdrawFee(options);

      const expectedGasLimit = 1_000_000n;
      const expectedFee = (MOCK_GAS_PRICE * 130n) / 100n;
      const expectedGasPrice = expectedFee * expectedGasLimit;

      expect(result).toEqual({ gasPrice: expectedGasPrice, blockNumber: MOCK_BLOCK_NUMBER });
    }, 60000);
  });
});
