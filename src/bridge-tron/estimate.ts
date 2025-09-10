import { TronWeb } from "tronweb";
import { bigIntMin } from "../utils";

type EstimateFeeInput = {
  contract: string;
  tronWeb: TronWeb;
  from: string;
  to: string;
  checkReceiverBalance?: boolean;
};

function toTRX(sun: number | bigint): number {
  const v = typeof sun === "bigint" ? Number(sun) : sun;
  return v / 1_000_000;
}

function parseLatestPriceSun(history: string | undefined, fallbackSun: number): number {
  if (!history) return fallbackSun;
  const last = history.split(",").pop()?.trim();
  const sun = last?.split(":")[1];
  const val = sun ? parseInt(sun, 10) : NaN;
  return Number.isFinite(val) ? val : fallbackSun;
}

async function checkReceiverUSDTBalance(tronWeb: TronWeb, contract: string, receiver: string): Promise<boolean> {
  try {
    const contractInstance = tronWeb.contract(
      [
        {
          constant: true,
          inputs: [{ name: "_owner", type: "address" }],
          name: "balanceOf",
          outputs: [{ name: "balance", type: "uint256" }],
          type: "function",
        },
      ],
      contract
    );

    const balance = await contractInstance.methods.balanceOf(receiver).call();
    return BigInt(balance.toString()) > 0n;
  } catch (error) {
    // If we can't check balance, assume it's a new account (higher fee)
    return false;
  }
}

async function getNetworkCongestionMultiplier(tronWeb: TronWeb): Promise<number> {
  try {
    // Get recent energy prices to determine network congestion
    const energyPrices = await tronWeb.trx.getEnergyPrices?.();
    if (energyPrices) {
      const prices = energyPrices
        .split(",")
        .map((p) => {
          const price = p.split(":")[1];
          return price ? parseFloat(price) : 0;
        })
        .filter((p) => p > 0);

      if (prices.length > 0) {
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const basePrice = 280; // Base energy price
        // If average price is significantly higher than base, network is congested
        return Math.min(avgPrice / basePrice, 3.0); // Cap at 3x
      }
    }
  } catch (error) {
    // If we can't get congestion data, assume normal conditions
  }
  return 1.0;
}

async function getDynamicEnergyMultiplier(tronWeb: TronWeb, contract: string): Promise<number> {
  try {
    // For popular contracts like USDT, check if there's increased energy consumption
    // This is a simplified approach - in reality, TRON's Dynamic Energy Model
    // is more complex and depends on contract usage patterns

    // USDT is a very popular contract, so it might have higher energy consumption
    const popularContracts = [
      "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT
      "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", // WTRX
    ];

    if (popularContracts.includes(contract)) {
      // Popular contracts might have 1.1-1.3x higher energy consumption
      return 1.2;
    }
  } catch (error) {
    // If we can't determine, assume normal consumption
  }
  return 1.0;
}

export async function estimateTransferFee(input: EstimateFeeInput) {
  const { from, tronWeb, to, contract, checkReceiverBalance = true } = input;
  let bandwidthPriceSun = 1000;
  let energyPriceSun = 280;

  try {
    const energyPrices = (await tronWeb.trx.getEnergyPrices?.()) as string | undefined;
    energyPriceSun = parseLatestPriceSun(energyPrices, energyPriceSun);
  } catch (_) {
    /* no-op */
  }

  try {
    const bwPrices = (await tronWeb.trx.getBandwidthPrices?.()) as string | undefined;
    bandwidthPriceSun = parseLatestPriceSun(bwPrices, bandwidthPriceSun);
  } catch (_) {
    /* no-op */
  }

  try {
    const params = await tronWeb.trx.getChainParameters();
    const get = (k: string) => params.find((p: { key: string; value: number }) => p.key === k)?.value;
    const pEnergy = get("getEnergyFee"); // TRX за 1 energy
    const pBandwidth = get("getTransactionFee"); // TRX за 1 байт
    if (typeof pEnergy === "number") energyPriceSun = Math.round(pEnergy * 1_000_000);
    if (typeof pBandwidth === "number") bandwidthPriceSun = Math.round(pBandwidth * 1_000_000);
  } catch (_) {
    /* no-op */
  }

  const amountUint = 1n;
  const params = [
    { type: "address", value: to },
    { type: "uint256", value: amountUint.toString() },
  ];

  // Get all multipliers for comprehensive fee calculation
  const [hasUSDTBalance, networkCongestionMultiplier, dynamicEnergyMultiplier] = await Promise.all([
    checkReceiverBalance ? checkReceiverUSDTBalance(tronWeb, contract, to) : Promise.resolve(true),
    getNetworkCongestionMultiplier(tronWeb),
    getDynamicEnergyMultiplier(tronWeb, contract),
  ]);

  // Calculate combined energy multiplier
  let energyMultiplier = 1.0;

  // Account for receiver state (new vs existing USDT holder)
  if (!hasUSDTBalance) {
    energyMultiplier *= 2.0; // New account requires ~2x energy
  }

  // Account for network congestion
  energyMultiplier *= networkCongestionMultiplier;

  // Account for popular contracts (Dynamic Energy Model)
  energyMultiplier *= dynamicEnergyMultiplier;

  const ownerHex = tronWeb.address.toHex(from);
  const txWrap = await tronWeb.transactionBuilder.triggerConstantContract(tronWeb.address.toHex(contract), "transfer(address,uint256)", { feeLimit: 1_000_000_000, callValue: 0 }, params, ownerHex);

  const energyUsed: number = Math.ceil((txWrap.energy_used ?? 0) * energyMultiplier);
  const rawHex: string = txWrap?.transaction?.raw_data_hex ?? "";
  const rawBytes = Math.ceil(rawHex.length / 2);
  const bandwidthBytesEstimated = rawBytes + 65 + 64;

  const res = await tronWeb.trx.getAccountResources(from);
  const freeNetLeft = Math.max((res.freeNetLimit ?? 0) - (res.freeNetUsed ?? 0), 0);
  const stakedNetLeft = Math.max((res.NetLimit ?? 0) - (res.NetUsed ?? 0), 0);
  const availableBandwidth = freeNetLeft + stakedNetLeft;

  const stakedEnergy = res.EnergyLimit ?? 0;
  const usedEnergy = res.EnergyUsed ?? 0;
  const availableEnergy = Math.max(stakedEnergy - usedEnergy, 0);

  const bandwidthToBurn = Math.max(bandwidthBytesEstimated - availableBandwidth, 0);
  const energyToBurn = Math.max(energyUsed - availableEnergy, 0);

  const bandwidthCostSun = bandwidthToBurn * bandwidthPriceSun;
  const energyCostSun = energyToBurn * energyPriceSun;
  const totalCostSun = bandwidthCostSun + energyCostSun;

  // Calculate safety margin based on network conditions and multipliers
  const baseSafetyMargin = 1.2; // 20% base safety margin
  const congestionSafetyMargin = Math.min(networkCongestionMultiplier * 0.1, 0.3); // Up to 30% additional for congestion
  const safetyMargin = baseSafetyMargin + congestionSafetyMargin;
  const suggestedFeeLimitSun = Math.ceil((energyUsed || 0) * energyPriceSun * safetyMargin);

  const gasLimit = BigInt(Math.ceil(toTRX(totalCostSun)));
  let additionalReserve = BigInt(Math.ceil(toTRX(suggestedFeeLimitSun))) - BigInt(Math.ceil(toTRX(totalCostSun)));
  if (additionalReserve < 0n) additionalReserve = 0n;

  const min = 10n * 10n ** 6n;
  return { gasLimit, additionalReserve: bigIntMin(additionalReserve, min) };
}
