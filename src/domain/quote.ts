import { roundToPrecision } from "./format";
import { getGlassItemSquareFeet, getGlassItemWeightPounds, getGlassLineSquareFeet } from "./glass";
import type { Elevation } from "./types";

export const INTERIOR_INSTALLED_RATE_PER_SQFT = 50;
export const HIGH_HEAVY_GLASS_RATE_PER_SQFT = 60;
export const HIGH_HEAVY_GLASS_HEIGHT_THRESHOLD_INCHES = 60;
export const HIGH_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS = 50;
export const DEFAULT_SINGLE_DOOR_PRICE = 3000;
export const DEFAULT_PAIR_DOOR_PRICE = 4500;

export interface QuoteSummary {
  openingSquareFeet: number;
  doorOpeningSquareFeet: number;
  quotedStorefrontSquareFeet: number;
  installedRatePerSquareFoot: number;
  highHeavyRatePerSquareFoot: number;
  installedCost: number;
  highHeavyGlassSquareFeet: number;
  highHeavyGlassPremiumRate: number;
  highHeavyGlassPremiumCost: number;
  singleDoorCount: number;
  pairDoorCount: number;
  singleDoorPrice: number;
  pairDoorPrice: number;
  doorCost: number;
  total: number;
}

export function calculateQuoteSummary(elevation: Elevation): QuoteSummary {
  const openingSquareFeet = roundToPrecision((elevation.governingWidth * elevation.governingHeight) / 144, 2);
  const doorOpeningSquareFeet = roundToPrecision(
    elevation.computedGeometry.doorOpenings.reduce((total, door) => total + (door.width * door.height) / 144, 0),
    2
  );
  const quotedStorefrontSquareFeet = roundToPrecision(Math.max(openingSquareFeet - doorOpeningSquareFeet, 0), 2);
  const highHeavyGlassSquareFeet = getHighHeavyGlassSquareFeet(elevation);
  const singleDoorCount = elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 1).length;
  const pairDoorCount = elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 2).length;
  const installedCost = roundCurrency(quotedStorefrontSquareFeet * INTERIOR_INSTALLED_RATE_PER_SQFT);
  const highHeavyGlassPremiumRate = HIGH_HEAVY_GLASS_RATE_PER_SQFT - INTERIOR_INSTALLED_RATE_PER_SQFT;
  const highHeavyGlassPremiumCost = roundCurrency(highHeavyGlassSquareFeet * highHeavyGlassPremiumRate);
  const doorCost = roundCurrency(singleDoorCount * DEFAULT_SINGLE_DOOR_PRICE + pairDoorCount * DEFAULT_PAIR_DOOR_PRICE);

  return {
    openingSquareFeet,
    doorOpeningSquareFeet,
    quotedStorefrontSquareFeet,
    installedRatePerSquareFoot: INTERIOR_INSTALLED_RATE_PER_SQFT,
    highHeavyRatePerSquareFoot: HIGH_HEAVY_GLASS_RATE_PER_SQFT,
    installedCost,
    highHeavyGlassSquareFeet,
    highHeavyGlassPremiumRate,
    highHeavyGlassPremiumCost,
    singleDoorCount,
    pairDoorCount,
    singleDoorPrice: DEFAULT_SINGLE_DOOR_PRICE,
    pairDoorPrice: DEFAULT_PAIR_DOOR_PRICE,
    doorCost,
    total: roundCurrency(installedCost + highHeavyGlassPremiumCost + doorCost)
  };
}

function getHighHeavyGlassSquareFeet(elevation: Elevation): number {
  return roundToPrecision(
    elevation.computedGeometry.lites.reduce((total, lite) => {
      const topOfGlass = lite.dloY + lite.dloHeight;
      const pieceWeight = getGlassItemWeightPounds({ width: lite.glassWidth, height: lite.glassHeight, qty: 1 });
      const isAboveHeightThreshold = topOfGlass > HIGH_HEAVY_GLASS_HEIGHT_THRESHOLD_INCHES;
      const isOverWeightThreshold = pieceWeight > HIGH_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS;

      if (!isAboveHeightThreshold || !isOverWeightThreshold) {
        return total;
      }

      return total + getGlassLineSquareFeet({ width: lite.glassWidth, height: lite.glassHeight, qty: lite.quantity });
    }, 0),
    2
  );
}

function roundCurrency(value: number): number {
  return roundToPrecision(value, 2);
}
