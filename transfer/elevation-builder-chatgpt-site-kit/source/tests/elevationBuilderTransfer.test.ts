import { describe, expect, it } from "vitest";
import { noDoorSeedInput, pairDoorSeedInput } from "../src/data/seed";
import {
  ELEVATION_BUILDER_SCHEMA_VERSION,
  buildStorefrontElevation,
  createElevationBuilderContext,
  toStorefrontTakeoffPayload
} from "../src/transfer/elevationBuilder";

describe("portable elevation builder", () => {
  it("returns doors, knee walls, glass, metal, validations, and pricing from one source of truth", () => {
    const input = structuredClone(pairDoorSeedInput);
    input.kneeWalls = [
      { columnIndex: 0, height: 24 },
      { columnIndex: 2, height: 24 }
    ];
    input.liteSplits = [{ rowIndex: 1, columnIndex: 0, orientation: "vertical", count: 2 }];

    const result = buildStorefrontElevation(input, createElevationBuilderContext());

    expect(result.schemaVersion).toBe(ELEVATION_BUILDER_SCHEMA_VERSION);
    expect(result.elevation.computedGeometry.doorOpenings).toHaveLength(1);
    expect(result.elevation.computedGeometry.doorOpenings[0].leafCount).toBe(2);
    expect(result.elevation.computedGeometry.kneeWalls).toHaveLength(2);
    expect(result.elevation.computedGeometry.lites.length).toBeGreaterThan(3);
    expect(result.takeoff.glassItems.length).toBeGreaterThan(0);
    expect(result.takeoff.metal.totalLinearFeet).toBeGreaterThan(0);
    expect(result.takeoff.quote.total).toBeGreaterThan(0);
  });

  it("emits a JSON-safe calculation snapshot for a receiving take-off application", () => {
    const result = buildStorefrontElevation(noDoorSeedInput);
    const payload = toStorefrontTakeoffPayload(result, "2026-07-21T12:00:00.000Z");

    expect(payload).toMatchObject({
      schemaVersion: ELEVATION_BUILDER_SCHEMA_VERSION,
      source: "worth-elevation-builder",
      generatedAt: "2026-07-21T12:00:00.000Z",
      elevation: {
        id: noDoorSeedInput.id,
        computedGeometry: expect.any(Object),
        validationFlags: expect.any(Array)
      },
      takeoff: {
        glassItems: expect.any(Array),
        metal: expect.any(Object),
        quote: expect.any(Object)
      }
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
