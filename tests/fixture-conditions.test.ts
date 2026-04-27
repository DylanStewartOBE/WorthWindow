import { describe, expect, it } from "vitest";
import {
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultStorefrontRulePack,
  defaultValidationLibrary
} from "../src/config/options";
import { calculateElevation } from "../src/domain/calculate";
import { formatInches } from "../src/domain/format";
import { noDoorSeedInput, pairDoorSeedInput } from "../src/data/seed";

const context = {
  storefrontRulePack: defaultStorefrontRulePack,
  entranceRulePack: defaultEntranceRulePack,
  noteLibrary: defaultNoteLibrary,
  validationLibrary: defaultValidationLibrary
};

describe("FG-2000 style fixture conditions", () => {
  it("produces expected takeoff lines for the pair-door sample", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);
    const storefrontMarks = new Set(elevation.computedGeometry.lites.map((lite) => lite.mark));
    const doorGlass = elevation.computedGlass.items.find((item) => item.sourceType === "door-lite");

    expect(elevation.computedGeometry.doorOpenings[0].leafCount).toBe(2);
    expect(elevation.computedGeometry.lites).toHaveLength(5);
    expect(elevation.computedGlass.items.some((item) => item.safetyGlazingLikely)).toBe(true);
    expect(formatInches(elevation.computedGeometry.transoms[0].height)).toBe("22 3/4\"");
    expect(storefrontMarks).toEqual(new Set(["G1", "G2", "G3"]));
    expect(elevation.computedGeometry.lites.filter((lite) => lite.mark === "G1")).toHaveLength(2);
    expect(elevation.computedGeometry.lites.filter((lite) => lite.mark === "G2")).toHaveLength(2);
    expect(elevation.computedGeometry.lites.filter((lite) => lite.mark === "G3")).toHaveLength(1);
    expect(doorGlass?.mark).toBe("DG1");
  });

  it("produces four fixed lites for the no-door sample", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);

    expect(elevation.computedGeometry.doorOpenings).toHaveLength(0);
    expect(elevation.computedGeometry.lites).toHaveLength(4);
    expect(elevation.computedGlass.items[0].qty).toBe(4);
  });
});
