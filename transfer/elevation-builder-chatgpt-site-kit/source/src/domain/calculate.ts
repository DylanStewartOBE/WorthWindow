import { calculateGeometry } from "./geometry";
import { validateElevation } from "./validation";
import type {
  Elevation,
  ElevationInput,
  EntranceRulePack,
  NoteLibrary,
  StorefrontRulePack,
  ValidationLibrary
} from "./types";

export interface CalculationContext {
  storefrontRulePack: StorefrontRulePack;
  entranceRulePack: EntranceRulePack;
  noteLibrary: NoteLibrary;
  validationLibrary: ValidationLibrary;
}

export function calculateElevation(input: ElevationInput, context: CalculationContext): Elevation {
  const result = calculateGeometry(
    input,
    context.storefrontRulePack,
    context.entranceRulePack,
    context.noteLibrary
  );
  const validationFlags = validateElevation(
    input,
    result.geometry,
    context.storefrontRulePack,
    context.entranceRulePack,
    context.validationLibrary
  );

  return {
    ...input,
    governingWidth: result.governingWidth,
    governingHeight: result.governingHeight,
    computedGeometry: result.geometry,
    computedGlass: result.glass,
    validationFlags,
    currentRevisionId: "",
    pdfArtifacts: []
  };
}

