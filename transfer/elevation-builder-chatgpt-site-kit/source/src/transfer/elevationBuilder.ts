import {
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultQuoteRulePack,
  defaultStorefrontRulePack,
  defaultValidationLibrary
} from "../config/options";
import { calculateElevation, type CalculationContext } from "../domain/calculate";
import { getTotalGlassSquareFeet, getTotalGlassWeightPounds } from "../domain/glass";
import { buildMetalTakeoff, type MetalTakeoffSummary } from "../domain/metal";
import { calculateQuoteSummary, type QuoteSummary } from "../domain/quote";
import type { Elevation, ElevationInput, QuoteRulePack } from "../domain/types";

export const ELEVATION_BUILDER_SCHEMA_VERSION = "1.0.0";

export interface ElevationBuilderContext extends CalculationContext {
  quoteRulePack: QuoteRulePack;
}

export interface StorefrontElevationBuilderResult {
  schemaVersion: typeof ELEVATION_BUILDER_SCHEMA_VERSION;
  elevation: Elevation;
  takeoff: {
    glassSquareFeet: number;
    glassWeightPounds: number;
    glassItems: Elevation["computedGlass"]["items"];
    metal: MetalTakeoffSummary;
    quote: QuoteSummary;
  };
}

export interface StorefrontTakeoffPayload {
  schemaVersion: typeof ELEVATION_BUILDER_SCHEMA_VERSION;
  source: "worth-elevation-builder";
  generatedAt: string;
  elevation: StorefrontElevationBuilderResult["elevation"];
  takeoff: StorefrontElevationBuilderResult["takeoff"];
}

export type ElevationBuilderContextOverrides = Partial<ElevationBuilderContext>;

/**
 * Creates the same rule-pack context used by the field-measure application.
 * Callers can replace any rule pack before calculation without changing the core engine.
 */
export function createElevationBuilderContext(
  overrides: ElevationBuilderContextOverrides = {}
): ElevationBuilderContext {
  return {
    storefrontRulePack: overrides.storefrontRulePack ?? defaultStorefrontRulePack,
    entranceRulePack: overrides.entranceRulePack ?? defaultEntranceRulePack,
    noteLibrary: overrides.noteLibrary ?? defaultNoteLibrary,
    validationLibrary: overrides.validationLibrary ?? defaultValidationLibrary,
    quoteRulePack: overrides.quoteRulePack ?? defaultQuoteRulePack
  };
}

/**
 * The portable entry point for any take-off, configurator, or API integration.
 * Geometry, validation, glass, metal, and quote outputs all come from one calculation pass.
 */
export function buildStorefrontElevation(
  input: ElevationInput,
  context: ElevationBuilderContext = createElevationBuilderContext()
): StorefrontElevationBuilderResult {
  const elevation = calculateElevation(input, context);
  const metal = buildMetalTakeoff([elevation]);
  const glassItems = elevation.computedGlass.items;

  return {
    schemaVersion: ELEVATION_BUILDER_SCHEMA_VERSION,
    elevation,
    takeoff: {
      glassSquareFeet: getTotalGlassSquareFeet(glassItems),
      glassWeightPounds: getTotalGlassWeightPounds(glassItems),
      glassItems,
      metal,
      quote: calculateQuoteSummary(elevation, context.quoteRulePack)
    }
  };
}

/**
 * Produces a JSON-safe record for the receiving take-off app or an API request.
 * Persist this payload as the calculation snapshot used to price or review a job.
 */
export function toStorefrontTakeoffPayload(
  result: StorefrontElevationBuilderResult,
  generatedAt = new Date().toISOString()
): StorefrontTakeoffPayload {
  return {
    schemaVersion: ELEVATION_BUILDER_SCHEMA_VERSION,
    source: "worth-elevation-builder",
    generatedAt,
    elevation: result.elevation,
    takeoff: result.takeoff
  };
}
