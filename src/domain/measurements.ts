import type { GoverningDimensions, MeasurementSet } from "./types";

type WidthKey = "widthBottom" | "widthCenter" | "widthTop";
type HeightKey = "heightLeft" | "heightCenter" | "heightRight";

const widthKeys: WidthKey[] = ["widthBottom", "widthCenter", "widthTop"];
const heightKeys: HeightKey[] = ["heightLeft", "heightCenter", "heightRight"];

function smallestMeasured<T extends keyof MeasurementSet>(
  measurements: MeasurementSet,
  keys: T[]
): { key: T; value: number } {
  return keys.reduce(
    (smallest, key) => (measurements[key] < smallest.value ? { key, value: measurements[key] } : smallest),
    { key: keys[0], value: measurements[keys[0]] }
  );
}

export function getGoverningDimensions(measurements: MeasurementSet): GoverningDimensions {
  const width = smallestMeasured(measurements, widthKeys);
  const height = smallestMeasured(measurements, heightKeys);

  return {
    openingWidthMeasured: width.value,
    openingHeightMeasured: height.value,
    governingWidthSource: width.key,
    governingHeightSource: height.key
  };
}

export function hasCompleteMeasurements(measurements: MeasurementSet): boolean {
  return Object.values(measurements).every((value) => Number.isFinite(value) && value > 0);
}

export function createSquaredMeasurementSet(width: number, height: number): MeasurementSet {
  return {
    widthBottom: width,
    widthCenter: width,
    widthTop: width,
    heightLeft: height,
    heightCenter: height,
    heightRight: height
  };
}
