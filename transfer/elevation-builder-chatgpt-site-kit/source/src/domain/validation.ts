import { hasCompleteMeasurements } from "./measurements";
import { getDoorPackageWidth } from "./geometry";
import type {
  ComputedGeometry,
  ElevationInput,
  EntranceRulePack,
  StorefrontRulePack,
  ValidationFlag,
  ValidationLibrary
} from "./types";

export function validateElevation(
  input: ElevationInput,
  geometry: ComputedGeometry,
  storefrontRules: StorefrontRulePack,
  entranceRules: EntranceRulePack,
  validationLibrary: ValidationLibrary
): ValidationFlag[] {
  if (!validationLibrary.enabled) return [];

  const flags: ValidationFlag[] = [];
  const add = (code: string, affectedElementId?: string, overrides?: Partial<ValidationFlag>) => {
    const template = validationLibrary.messages[code];
    if (!template?.enabled) return;
    flags.push({
      id: `${code}-${flags.length + 1}`,
      code,
      severity: template.severity,
      message: template.message,
      recommendation: template.recommendation,
      affectedElementId,
      ...overrides
    });
  };

  if (!hasCompleteMeasurements(input.measurementSet)) {
    add("missing-measurements", input.id);
  }

  if (input.rows < 1 || input.columns < 1) {
    add("missing-layout", input.id);
  }

  const doorPackageWidth = getDoorPackageWidth(input);
  if (input.doorConfig.hasDoor && input.doorConfig.doorType !== "none") {
    const doors = geometry.doorOpenings;
    if (doors.length === 0) {
      add("impossible-geometry", input.id);
    } else {
      doors.forEach((door) => {
        if (door.width >= geometry.frameWidth) {
          add("door-too-wide", door.id, {
            message: `Selected door package is ${door.width}" wide, which does not leave room inside the ${geometry.frameWidth}" frame width.`
          });
        }

        if (door.height > geometry.frameHeight) {
          add("door-too-tall", door.id, {
            message: `Selected ${door.height}" door height exceeds the ${geometry.frameHeight}" available entrance height.`
          });
        }

        if (door.clearWidthAdvisory < 32) {
          add("ada-clear-width", door.id, {
            message: `Estimated clear width is ${door.clearWidthAdvisory}", below the common 32" accessible clear width advisory.`
          });
        }

        if (door.swing === "inswing") {
          add("egress-swing", door.id);
        }

        if (!entranceRules.supportedHingeTypes.includes(door.hingeType)) {
          add("unsupported-hinge", door.id);
        }

        if (geometry.transoms.every((transom) => transom.aboveDoorId !== door.id) && geometry.frameHeight > door.height) {
          add("short-transom", door.id);
        }
      });

      const unsupportedHardware = input.doorConfig.hardwareNoteIds.filter((id) => {
        const allowed = entranceRules.hardwareCompatibility[id];
        return allowed && !allowed.includes(input.doorConfig.doorType);
      });
      unsupportedHardware.forEach((id) => add("hardware-compatibility", doors[0].id, { message: `Hardware note "${id}" may not match a ${input.doorConfig.doorType} door package.` }));
    }

    if (input.columns < 2 && geometry.frameWidth > doorPackageWidth) {
      add("unsupported-layout", input.id);
    }
  }

  if (geometry.frameWidth > storefrontRules.advisoryThresholds.simpleRulePackMaxWidth) {
    add("opening-too-wide", input.id);
  }

  if (geometry.frameHeight > storefrontRules.advisoryThresholds.simpleRulePackMaxHeight) {
    add("opening-too-tall", input.id);
  }

  if (geometry.frameWidth > storefrontRules.advisoryThresholds.expansionVerticalWidth) {
    add("expansion-vertical-advisory", input.id);
  }

  if (input.assemblyType === "stack") {
    add("stack-expansion-advisory", input.id);
  }

  if (input.projectType !== "new") {
    add("existing-building-context", input.id);
  }

  if (geometry.lites.some((lite) => lite.safetyGlazingLikely)) {
    add("safety-glazing", geometry.lites.find((lite) => lite.safetyGlazingLikely)?.id);
  }

  return flags;
}
