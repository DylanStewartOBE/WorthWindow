import { roundToPrecision } from "./format";
import {
  getGlassItemWeightPounds,
  getGlassLineSquareFeet,
  getTotalGlassSquareFeet
} from "./glass";
import { buildMetalTakeoff } from "./metal";
import type { Elevation, QuoteRulePack } from "./types";

export interface QuoteSummary {
  pricingProfileId: string;
  pricingProfileName: string;
  pricingProfileVersion: string;
  pricingEffectiveDate: string;
  pricingOwner: string;
  pricingAssumptions: string[];
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
  subtotal: number;
  marginPercent: number;
  marginAmount: number;
  total: number;
}

export function calculateQuoteSummary(elevation: Elevation, quoteRulePack: QuoteRulePack): QuoteSummary {
  return calculateJobQuoteSummary([elevation], quoteRulePack);
}

export function calculateJobQuoteSummary(elevations: Elevation[], quoteRulePack: QuoteRulePack): QuoteSummary {
  const rates = quoteRulePack.rates;
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
  const premiumAreas = getGlassPremiumSquareFeet(elevations, quoteRulePack);
  const singleDoorCount = elevations.reduce(
    (total, elevation) => total + elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 1).length,
    0
  );
  const pairDoorCount = elevations.reduce(
    (total, elevation) => total + elevation.computedGeometry.doorOpenings.filter((door) => door.leafCount === 2).length,
    0
  );
  const glassCost = roundCurrency(glassSquareFeet * rates.glassPerSquareFoot);
  const aluminumCost = roundCurrency(aluminumLinearFeet * rates.aluminumPerLinearFoot);
  const highHeavyGlassPremiumRate = rates.highHeavyGlassPremiumPerSquareFoot;
  const lowHeavyGlassPremiumRate = rates.lowHeavyGlassPremiumPerSquareFoot;
  const highHeavyGlassSquareFeet = premiumAreas.highHeavyGlassSquareFeet;
  const lowHeavyGlassSquareFeet = premiumAreas.lowHeavyGlassSquareFeet;
  const highHeavyGlassPremiumCost = roundCurrency(highHeavyGlassSquareFeet * highHeavyGlassPremiumRate);
  const lowHeavyGlassPremiumCost = roundCurrency(lowHeavyGlassSquareFeet * lowHeavyGlassPremiumRate);
  const doorCost = roundCurrency(singleDoorCount * rates.singleDoorAdder + pairDoorCount * rates.pairDoorAdder);
  const subtotal = roundCurrency(glassCost + aluminumCost + highHeavyGlassPremiumCost + lowHeavyGlassPremiumCost + doorCost);
  const marginPercent = quoteRulePack.margin.percent;
  const marginAmount = roundCurrency(subtotal * (marginPercent / 100));

  return {
    pricingProfileId: quoteRulePack.id,
    pricingProfileName: quoteRulePack.name,
    pricingProfileVersion: quoteRulePack.version,
    pricingEffectiveDate: quoteRulePack.effectiveDate,
    pricingOwner: quoteRulePack.owner,
    pricingAssumptions: quoteRulePack.assumptions,
    openingSquareFeet,
    doorOpeningSquareFeet,
    quotedStorefrontSquareFeet,
    glassSquareFeet,
    glassRatePerSquareFoot: rates.glassPerSquareFoot,
    glassCost,
    aluminumLinearFeet,
    aluminumRatePerLinearFoot: rates.aluminumPerLinearFoot,
    aluminumCost,
    highHeavyGlassSquareFeet,
    highHeavyGlassPremiumRate,
    highHeavyGlassPremiumCost,
    lowHeavyGlassSquareFeet,
    lowHeavyGlassPremiumRate,
    lowHeavyGlassPremiumCost,
    singleDoorCount,
    pairDoorCount,
    singleDoorPrice: rates.singleDoorAdder,
    pairDoorPrice: rates.pairDoorAdder,
    doorCost,
    subtotal,
    marginPercent,
    marginAmount,
    total: roundCurrency(subtotal + marginAmount)
  };
}

function getGlassPremiumSquareFeet(elevations: Elevation[], quoteRulePack: QuoteRulePack): {
  highHeavyGlassSquareFeet: number;
  lowHeavyGlassSquareFeet: number;
} {
  const thresholds = quoteRulePack.heavyGlassThresholds;
  const totals = elevations.reduce(
    (current, elevation) => {
      elevation.computedGeometry.lites.forEach((lite) => {
        const topOfGlass = lite.dloY + lite.dloHeight;
        const pieceWeight = getGlassItemWeightPounds({ width: lite.glassWidth, height: lite.glassHeight, qty: 1 });
        const isAboveHeightThreshold = topOfGlass > thresholds.highHeightInches;
        const lineSquareFeet = getGlassLineSquareFeet({ width: lite.glassWidth, height: lite.glassHeight, qty: lite.quantity });

        if (isAboveHeightThreshold && pieceWeight > thresholds.highWeightPounds) {
          current.highHeavyGlassSquareFeet += lineSquareFeet;
        } else if (!isAboveHeightThreshold && pieceWeight > thresholds.lowWeightPounds) {
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
