import { roundToPrecision } from "./format";
import type { Elevation } from "./types";

export const DEFAULT_INSTALLED_RATE_PER_SQFT = 100;
export const DEFAULT_SINGLE_DOOR_PRICE = 3000;
export const DEFAULT_PAIR_DOOR_PRICE = 4500;

export interface QuoteSummary {
  openingSquareFeet: number;
  installedRatePerSquareFoot: number;
  installedCost: number;
  singleDoorCount: number;
  pairDoorCount: number;
  singleDoorPrice: number;
  pairDoorPrice: number;
  doorCost: number;
  total: number;
}

export function calculateQuoteSummary(elevation: Elevation): QuoteSummary {
  const openingSquareFeet = roundToPrecision((elevation.governingWidth * elevation.governingHeight) / 144, 2);
  const singleDoorCount = elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 1).length;
  const pairDoorCount = elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 2).length;
  const installedCost = roundCurrency(openingSquareFeet * DEFAULT_INSTALLED_RATE_PER_SQFT);
  const doorCost = roundCurrency(singleDoorCount * DEFAULT_SINGLE_DOOR_PRICE + pairDoorCount * DEFAULT_PAIR_DOOR_PRICE);

  return {
    openingSquareFeet,
    installedRatePerSquareFoot: DEFAULT_INSTALLED_RATE_PER_SQFT,
    installedCost,
    singleDoorCount,
    pairDoorCount,
    singleDoorPrice: DEFAULT_SINGLE_DOOR_PRICE,
    pairDoorPrice: DEFAULT_PAIR_DOOR_PRICE,
    doorCost,
    total: roundCurrency(installedCost + doorCost)
  };
}

function roundCurrency(value: number): number {
  return roundToPrecision(value, 2);
}
