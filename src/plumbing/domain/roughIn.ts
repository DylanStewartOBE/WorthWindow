import { round } from "./math";
import type { FixtureType, PlumbingJob, RoughInDimensionSpec, RoughInResult } from "./types";

export function evaluateRoughIn(job: PlumbingJob, fixtures: Map<string, FixtureType>): RoughInResult[] {
  const areaNames = new Map(job.areas.map((area) => [area.id, area.name]));

  return job.fieldChecks.map((check) => {
    const fixture = fixtures.get(check.fixtureTypeId);
    const spec = fixture?.roughIn.find((dimension) => dimension.id === check.dimensionId);
    const base = {
      checkId: check.id,
      areaName: areaNames.get(check.areaId) ?? "Unassigned",
      fixtureLabel: fixture?.label ?? check.fixtureTypeId,
      measured: check.measured
    };

    if (!spec) {
      return {
        ...base,
        dimensionLabel: check.dimensionId,
        reference: "",
        min: 0,
        target: 0,
        max: 0,
        deviation: null,
        status: "unknown-spec" as const
      };
    }

    return {
      ...base,
      dimensionLabel: spec.label,
      reference: spec.reference,
      min: spec.min,
      target: spec.target,
      max: spec.max,
      ...checkMeasurement(check.measured, spec)
    };
  });
}

export function checkMeasurement(
  measured: number | null,
  spec: Pick<RoughInDimensionSpec, "min" | "target" | "max">
): Pick<RoughInResult, "deviation" | "status"> {
  if (measured === null || !Number.isFinite(measured)) return { deviation: null, status: "not-measured" };
  const deviation = round(measured - spec.target, 4);
  const inRange = measured >= spec.min - 1e-9 && measured <= spec.max + 1e-9;
  return { deviation, status: inRange ? "pass" : "out-of-range" };
}

/** Builds one blank check per rough-in dimension for every fixture type entered in an area. */
export function getMissingRoughInChecks(job: PlumbingJob, fixtures: Map<string, FixtureType>) {
  const existing = new Set(job.fieldChecks.map((check) => `${check.areaId}|${check.fixtureTypeId}|${check.dimensionId}`));
  const missing: { areaId: string; fixtureTypeId: string; dimensionId: string }[] = [];

  job.areas.forEach((area) => {
    const typeIds = [...new Set(area.fixtures.filter((line) => line.qty > 0).map((line) => line.fixtureTypeId))];
    typeIds.forEach((fixtureTypeId) => {
      fixtures.get(fixtureTypeId)?.roughIn.forEach((dimension) => {
        const key = `${area.id}|${fixtureTypeId}|${dimension.id}`;
        if (!existing.has(key)) missing.push({ areaId: area.id, fixtureTypeId, dimensionId: dimension.id });
      });
    });
  });

  return missing;
}
