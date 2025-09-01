import { TronWeb } from "tronweb";

type EstimateFeeInput = {
  contract: string;
  tronWeb: TronWeb;
  from: string;
  to: string;
};

type EstimateFeeResult = {
  energyUsed: number;
  bandwidthBytesEstimated: number;
  energyPriceSun: number;
  bandwidthPriceSun: number;
  availableEnergy: number;
  availableBandwidth: number;
  energyToBurn: number;
  bandwidthToBurn: number;
  energyCostSun: number;
  bandwidthCostSun: number;
  suggestedFeeLimitSun: number;
  totalCostSun: number;
  totalCostTRX: number;
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

export async function estimateTransferFee(input: EstimateFeeInput): Promise<EstimateFeeResult> {
  const { from, tronWeb, to, contract } = input;
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

  const ownerHex = tronWeb.address.toHex(from);
  const txWrap = await tronWeb.transactionBuilder.triggerConstantContract(tronWeb.address.toHex(contract), "transfer(address,uint256)", { feeLimit: 1_000_000_000, callValue: 0 }, params, ownerHex);

  const energyUsed: number = txWrap.energy_used ?? 0;
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
  const suggestedFeeLimitSun = Math.ceil((energyUsed || 0) * energyPriceSun * 1.2);

  return {
    energyUsed,
    bandwidthBytesEstimated,
    energyPriceSun,
    bandwidthPriceSun,
    availableEnergy,
    availableBandwidth,
    energyToBurn,
    bandwidthToBurn,
    energyCostSun,
    bandwidthCostSun,
    totalCostSun,
    totalCostTRX: toTRX(totalCostSun),
    suggestedFeeLimitSun,
  };
}
