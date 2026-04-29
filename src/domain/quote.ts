import { roundToPrecision } from "./format";
import {
  getGlassItemWeightPounds,
  getGlassLineSquareFeet,
  getTotalGlassSquareFeet
} from "./glass";
import { buildMetalTakeoff } from "./metal";
import type { Elevation } from "./types";

export const GLASS_RATE_PER_SQFT = 12.5;
export const ALUMINUM_RATE_PER_LINEAR_FOOT = 7.75;
export const HIGH_HEAVY_GLASS_PREMIUM_RATE_PER_SQFT = 10;
export const LOW_HEAVY_GLASS_PREMIUM_RATE_PER_SQFT = 4;
export const HIGH_HEAVY_GLASS_HEIGHT_THRESHOLD_INCHES = 60;
export const HIGH_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS = 50;
export const LOW_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS = 150;
export const DEFAULT_SINGLE_DOOR_PRICE = 3000;
export const DEFAULT_PAIR_DOOR_PRICE = 4500;

export interface QuoteSummary {
  openingSquareFeet: number;
  doorOpeningSquareFeet: number;
  quotedStorefrontSquareFeet: number;
  glassSquareFeet: number;
  glassRatePerSquareFoot: number;
  glassCost: number;
  aluminumLinearFeet: number;
  aluminumRatePerLinearFoot: number;
  aluminumCost: number;
  highHeavyGlassSquareFeet: number;
  highHeavyGlassPremiumRate: number;
  highHeavyGlassPremiumCost: number;
  lowHeavyGlassSquareFeet: number;
  lowHeavyGlassPremiumRate: number;
  lowHeavyGlassPremiumCost: number;
  singleDoorCount: number;
  pairDoorCount: number;
  singleDoorPrice: number;
  pairDoorPrice: number;
  doorCost: number;
  total: number;
}

export function calculateQuoteSummary(elevation: Elevation): QuoteSummary {
  return calculateJobQuoteSummary([elevation]);
}

export function calculateJobQuoteSummary(elevations: Elevation[]): QuoteSummary {
  const openingSquareFeet = roundToPrecision(
    elevations.reduce((total, elevation) => total + (elevation.governingWidth * elevation.governingHeight) / 144, 0),
    2
  );
  const doorOpeningSquareFeet = roundToPrecision(
    elevations.reduce(
      (total, elevation) =>
        total + elevation.computedGeometry.doorOpenings.reduce((doorTotal, door) => doorTotal + (door.width * door.height) / 144, 0),
      0
    ),
    2
  );
  const quotedStorefrontSquareFeet = roundToPrecision(Math.max(openingSquareFeet - doorOpeningSquareFeet, 0), 2);
  const glassSquareFeet = getTotalGlassSquareFeet(elevations.flatMap((elevation) => elevation.computedGlass.items));
  const aluminumLinearFeet = buildMetalTakeoff(elevations).totalLinearFeet;
  const premiumAreas = getGlassPremiumSquareFeet(elevations);
  const singleDoorCount = elevations.reduce(
    (total, elevation) => total + elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 1).length,
    0
  );
  const pairDoorCount = elevations.reduce(
    (total, elevation) => total + elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 2).length,
    0
  );
  const glassCost = roundCurrency(glassSquareFeet * GLASS_RATE_PER_SQFT);
  const aluminumCost = roundCurrency(aluminumLinearFeet * ALUMINUM_RATE_PER_LINEAR_FOOT);
  const highHeavyGlassPremiumRate = HIGH_HEAVY_GLASS_PREMIUM_RATE_PER_SQFT;
  const lowHeavyGlassPremiumRate = LOW_HEAVY_GLASS_PREMIUM_RATE_PER_SQFT;
  const highHeavyGlassSquareFeet = premiumAreas.highHeavyGlassSquareFeet;
  const lowHeavyGlassSquareFeet = premiumAreas.lowHeavyGlassSquareFeet;
  const highHeavyGlassPremiumCost = roundCurrency(highHeavyGlassSquareFeet * highHeavyGlassPremiumRate);
  const lowHeavyGlassPremiumCost = roundCurrency(lowHeavyGlassSquareFeet * lowHeavyGlassPremiumRate);
  const doorCost = roundCurrency(singleDoorCount * DEFAULT_SINGLE_DOOR_PRICE + pairDoorCount * DEFAULT_PAIR_DOOR_PRICE);

  return {
    openingSquareFeet,
    doorOpeningSquareFeet,
    quotedStorefrontSquareFeet,
    glassSquareFeet,
    glassRatePerSquareFoot: GLASS_RATE_PER_SQFT,
    glassCost,
    aluminumLinearFeet,
    aluminumRatePerLinearFoot: ALUMINUM_RATE_PER_LINEAR_FOOT,
    aluminumCost,
    highHeavyGlassSquareFeet,
    highHeavyGlassPremiumRate,
    highHeavyGlassPremiumCost,
    lowHeavyGlassSquareFeet,
    lowHeavyGlassPremiumRate,
    lowHeavyGlassPremiumCost,
    singleDoorCount,
    pairDoorCount,
    singleDoorPrice: DEFAULT_SINGLE_DOOR_PRICE,
    pairDoorPrice: DEFAULT_PAIR_DOOR_PRICE,
    doorCost,
    total: roundCurrency(glassCost + aluminumCost + highHeavyGlassPremiumCost + lowHeavyGlassPremiumCost + doorCost)
  };
}

function getGlassPremiumSquareFeet(elevations: Elevation[]): {
  highHeavyGlassSquareFeet: number;
  lowHeavyGlassSquareFeet: number;
} {
  const totals = elevations.reduce(
    (current, elevation) => {
      elevation.computedGeometry.lites.forEach((lite) => {
        const topOfGlass = lite.dloY + lite.dloHeight;
        const pieceWeight = getGlassItemWeightPounds({ width: lite.glassWidth, height: lite.glassHeight, qty: 1 });
        const isAboveHeightThreshold = topOfGlass > HIGH_HEAVY_GLASS_HEIGHT_THRESHOLD_INCHES;
        const lineSquareFeet = getGlassLineSquareFeet({ width: lite.glassWidth, height: lite.glassHeight, qty: lite.quantity });

        if (isAboveHeightThreshold && pieceWeight > HIGH_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS) {
          current.highHeavyGlassSquareFeet += lineSquareFeet;
        } else if (!isAboveHeightThreshold && pieceWeight > LOW_HEAVY_GLASS_WEIGHT_THRESHOLD_POUNDS) {
          current.lowHeavyGlassSquareFeet += lineSquareFeet;
        }
      });
      return current;
    },
    { highHeavyGlassSquareFeet: 0, lowHeavyGlassSquareFeet: 0 }
  );

  return {
    highHeavyGlassSquareFeet: roundToPrecision(totals.highHeavyGlassSquareFeet, 2),
    lowHeavyGlassSquareFeet: roundToPrecision(totals.lowHeavyGlassSquareFeet, 2)
  };
}

function roundCurrency(value: number): number {
  return roundToPrecision(value, 2);
}
