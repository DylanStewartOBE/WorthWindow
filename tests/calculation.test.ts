import { describe, expect, it } from "vitest";
import {
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultStorefrontRulePack,
  defaultValidationLibrary
} from "../src/config/options";
import { calculateElevation, type CalculationContext } from "../src/domain/calculate";
import { getDoorLeafVisuals } from "../src/domain/door";
import {
  getDoorGlassCalloutMap,
  getGlassItemSquareFeet,
  getGlassItemWeightPounds,
  getGlassLineSquareFeet,
  getGlassLineWeightPounds,
  getTotalGlassSquareFeet,
  getTotalGlassWeightPounds
} from "../src/domain/glass";
import { getDoorColumnIndex } from "../src/domain/geometry";
import { createSquaredMeasurementSet, getGoverningDimensions } from "../src/domain/measurements";
import { calculateQuoteSummary } from "../src/domain/quote";
import { createRevisionSnapshot } from "../src/domain/revision";
import type { ElevationInput } from "../src/domain/types";
import { noDoorSeedInput, pairDoorSeedInput } from "../src/data/seed";

const context: CalculationContext = {
  storefrontRulePack: defaultStorefrontRulePack,
  entranceRulePack: defaultEntranceRulePack,
  noteLibrary: defaultNoteLibrary,
  validationLibrary: defaultValidationLibrary
};

describe("FG-2000 calculation engine", () => {
  it("stores squared estimating dimensions across the legacy measurement slots", () => {
    const measurements = createSquaredMeasurementSet(93, 114);
    const governing = getGoverningDimensions(measurements);

    expect(measurements).toEqual({
      widthBottom: 93,
      widthCenter: 93,
      widthTop: 93,
      heightLeft: 114,
      heightCenter: 114,
      heightRight: 114
    });
    expect(governing.openingWidthMeasured).toBe(93);
    expect(governing.openingHeightMeasured).toBe(114);
  });

  it("still accepts legacy three-point measurements and selects the smallest values", () => {
    const governing = getGoverningDimensions({
      widthBottom: 180,
      widthCenter: 179.75,
      widthTop: 180.125,
      heightLeft: 108,
      heightCenter: 107.875,
      heightRight: 108.125
    });

    expect(governing.openingWidthMeasured).toBe(179.75);
    expect(governing.governingWidthSource).toBe("widthCenter");
    expect(governing.openingHeightMeasured).toBe(107.875);
    expect(governing.governingHeightSource).toBe("heightCenter");
  });

  it("deducts perimeter joints for no-door frame width and height", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);

    expect(elevation.computedGeometry.frameWidth).toBeCloseTo(143.375);
    expect(elevation.computedGeometry.frameHeight).toBeCloseTo(95.375);
    expect(elevation.computedGeometry.subsillWidth).toBeCloseTo(143.625);
  });

  it("calculates entrance sidelite subsill widths from door jamb to perimeter", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);

    expect(elevation.computedGeometry.memberCalcs.leftSideliteSubsillWidth).toBeCloseTo(52.875);
    expect(elevation.computedGeometry.memberCalcs.rightSideliteSubsillWidth).toBeCloseTo(52.875);
  });

  it("calculates mullion height from frame height less subsill height", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);

    expect(elevation.computedGeometry.memberCalcs.mullionHeight).toBeCloseTo(94.875);
  });

  it("sets horizontal length from DLO and glass stop length from DLO less 1/16 inch", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);
    const firstLite = elevation.computedGeometry.lites[0];

    expect(elevation.computedGeometry.memberCalcs.typicalHorizontalLength).toBe(firstLite.dloWidth);
    expect(elevation.computedGeometry.memberCalcs.typicalHorizontalGlassStopLength).toBeCloseTo(
      firstLite.dloWidth - 0.0625
    );
  });

  it("converts DLO to final glass size with the configured 5/8 inch add", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);
    const firstLite = elevation.computedGeometry.lites[0];

    expect(firstLite.glassWidth).toBeCloseTo(firstLite.dloWidth + 0.625);
    expect(firstLite.glassHeight).toBeCloseTo(firstLite.dloHeight + 0.625);
  });

  it("derives storefront glass size from configured bite per side", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };
    storefrontRulePack.glassBite = {
      leftJamb: 0.25,
      rightJamb: 0.375,
      verticalMullion: 0.3125,
      doorJamb: 0.5,
      head: 0.25,
      sill: 0.375,
      horizontalMullion: 0.3125
    };

    const elevation = calculateElevation(
      {
        ...noDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        rows: 2,
        columns: 2
      },
      { ...context, storefrontRulePack }
    );
    const firstLite = elevation.computedGeometry.lites[0];

    expect(firstLite.glassWidth).toBeCloseTo(firstLite.dloWidth + storefrontRulePack.glassBite.leftJamb + storefrontRulePack.glassBite.verticalMullion);
    expect(firstLite.glassHeight).toBeCloseTo(firstLite.dloHeight + storefrontRulePack.glassBite.sill + storefrontRulePack.glassBite.horizontalMullion);
    expect(new Set(elevation.computedGeometry.lites.map((lite) => lite.glassWidth))).toEqual(new Set([57.625]));
    expect(new Set(elevation.computedGeometry.lites.map((lite) => lite.glassHeight))).toEqual(new Set([57.625]));
  });

  it("calculates line and total square footage for the glass takeoff", () => {
    expect(getGlassItemSquareFeet({ width: 24, height: 36, qty: 2 })).toBe(6);
    expect(getGlassLineSquareFeet({ width: 24, height: 36, qty: 2 })).toBe(12);
    expect(
      getTotalGlassSquareFeet([
        { width: 24, height: 36, qty: 2 },
        { width: 12, height: 24, qty: 1 }
      ])
    ).toBe(14);
  });

  it("calculates piece and total glass weights from square footage", () => {
    const item = { width: 24, height: 36, qty: 2 };

    expect(getGlassItemWeightPounds(item)).toBe(19.62);
    expect(getGlassLineWeightPounds(item)).toBe(39.24);
    expect(getTotalGlassWeightPounds([item])).toBe(39.24);
  });

  it("calculates customer quote from opening square footage and door adders", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);
    const quote = calculateQuoteSummary(elevation);

    expect(quote.openingSquareFeet).toBe(134.66);
    expect(quote.installedCost).toBe(13466);
    expect(quote.singleDoorCount).toBe(0);
    expect(quote.pairDoorCount).toBe(1);
    expect(quote.doorCost).toBe(4500);
    expect(quote.total).toBe(17966);
  });

  it("uses the selected second row as the transom row above an 84 inch door", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);

    expect(elevation.computedGeometry.transoms).toHaveLength(1);
    expect(elevation.computedGeometry.transoms[0].height).toBeCloseTo(22.75);
  });

  it("keeps one-row sidelites full height while still generating a door transom", () => {
    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        rows: 1,
        rowSizingMode: "equal",
        rowHeights: [0]
      },
      context
    );

    expect(elevation.computedGeometry.rowHeights).toHaveLength(1);
    expect(elevation.computedGeometry.transoms).toHaveLength(1);
    expect(elevation.computedGeometry.transoms[0].height).toBeCloseTo(22.75);
    expect(elevation.computedGeometry.doorOpenings[0].height).toBe(84);
    expect(elevation.computedGeometry.lites).toHaveLength(3);
    expect(elevation.computedGeometry.lites.filter((lite) => lite.type !== "transom").every((lite) => lite.rowIndex === 0)).toBe(true);
    expect(elevation.computedGeometry.members.filter((member) => member.role === "horizontal-mullion")).toHaveLength(1);
  });

  it("distributes no-door equal mode by final glass size", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);
    const glassWidths = new Set(elevation.computedGeometry.lites.map((lite) => lite.glassWidth));
    const glassHeights = new Set(elevation.computedGeometry.lites.map((lite) => lite.glassHeight));

    expect(glassWidths.size).toBe(1);
    expect(glassHeights.size).toBe(1);
    expect(elevation.computedGeometry.bays[0].width).toBeCloseTo(71.688);
  });

  it("keeps one-row three-column no-door glass equal across jamb and mullion conditions", () => {
    const elevation = calculateElevation(
      {
        ...noDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(180, 108),
        rows: 1,
        columns: 3
      },
      context
    );
    const glassWidths = new Set(elevation.computedGeometry.lites.map((lite) => lite.glassWidth));
    const glassHeights = new Set(elevation.computedGeometry.lites.map((lite) => lite.glassHeight));

    expect(elevation.computedGeometry.columnWidths[0]).toBeCloseTo(elevation.computedGeometry.columnWidths[2]);
    expect(elevation.computedGeometry.columnWidths[0]).toBeGreaterThan(elevation.computedGeometry.columnWidths[1]);
    expect(glassWidths).toEqual(new Set([58.125]));
    expect(glassHeights.size).toBe(1);
    expect(elevation.computedGlass.items).toHaveLength(1);
    expect(elevation.computedGlass.items[0]).toMatchObject({
      mark: "G1",
      qty: 3,
      location: "R1C1, R1C2, R1C3"
    });
  });

  it("centers intermediate members on the layout line and derives DLO from member faces", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const input: ElevationInput = {
      ...noDoorSeedInput,
      measurementSet: createSquaredMeasurementSet(120, 120),
      rows: 2,
      columns: 2
    };
    const elevation = calculateElevation(input, { ...context, storefrontRulePack });
    const verticalMullion = elevation.computedGeometry.members.find((member) => member.role === "vertical-mullion");
    const horizontalMullion = elevation.computedGeometry.members.find((member) => member.role === "horizontal-mullion");
    const firstLite = elevation.computedGeometry.lites[0];

    expect(verticalMullion?.x).toBeCloseTo(59);
    expect(verticalMullion?.width).toBe(2);
    expect(horizontalMullion?.y).toBeCloseTo(59);
    expect(horizontalMullion?.height).toBe(2);
    expect(firstLite.dloWidth).toBeCloseTo(57);
    expect(firstLite.dloHeight).toBeCloseTo(57);
  });

  it("distributes custom remainder into any unset rows and columns", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const elevation = calculateElevation(
      {
        ...noDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        columns: 3,
        rows: 2,
        columnSizingMode: "custom",
        rowSizingMode: "custom",
        columnWidths: [30, 50, 0],
        rowHeights: [40, 0]
      },
      { ...context, storefrontRulePack }
    );

    expect(elevation.computedGeometry.columnWidths).toEqual([30, 50, 40]);
    expect(elevation.computedGeometry.rowHeights).toEqual([40, 80]);
    expect(elevation.computedGeometry.lites[0].dloWidth).toBeCloseTo(27);
    expect(elevation.computedGeometry.lites[0].dloHeight).toBeCloseTo(37);
  });

  it("keeps the door column driven and distributes the remaining custom storefront columns", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        columns: 4,
        columnSizingMode: "custom",
        columnWidths: [30, 999, 0, 0],
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          doorType: "single",
          widthPerLeaf: 36,
          locationMode: "custom",
          columnIndex: 1
        }
      },
      { ...context, storefrontRulePack }
    );

    expect(elevation.computedGeometry.columnWidths).toEqual([30, 38, 26, 26]);
    expect(elevation.computedGeometry.doorOpenings[0].width).toBe(36);
  });

  it("locks the transom line to the door height and moves only the rows above it", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        rows: 3,
        rowSizingMode: "custom",
        rowHeights: [999, 10, 0],
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          rowPlacement: "above"
        }
      },
      { ...context, storefrontRulePack }
    );

    expect(elevation.computedGeometry.rowHeights).toEqual([85, 10, 25]);
    expect(elevation.computedGeometry.doorOpenings[0].height).toBe(84);
  });

  it("can place extra rows below the door line while keeping the transom row driven", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        rows: 3,
        rowSizingMode: "equal",
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          rowPlacement: "below"
        }
      },
      { ...context, storefrontRulePack }
    );
    const doorColumn = elevation.computedGeometry.doorOpenings[0].columnIndex;
    const doorColumnBays = elevation.computedGeometry.bays.filter((bay) => bay.columnIndex === doorColumn);
    const leftColumnBays = elevation.computedGeometry.bays.filter((bay) => bay.columnIndex === 0);

    expect(elevation.computedGeometry.rowHeights).toEqual([42.5, 42.5, 35]);
    expect(doorColumnBays.map((bay) => bay.rowIndex)).toEqual([0, 2]);
    expect(leftColumnBays.map((bay) => bay.rowIndex)).toEqual([0, 1, 2]);
    expect(elevation.computedGeometry.doorOpenings[0].height).toBe(84);
  });

  it("places single and pair doors deterministically", () => {
    const singleInput: ElevationInput = {
      ...pairDoorSeedInput,
      doorConfig: { ...pairDoorSeedInput.doorConfig, doorType: "single", widthPerLeaf: 36, locationMode: "center" }
    };
    const pair = calculateElevation(pairDoorSeedInput, context).computedGeometry.doorOpenings[0];
    const singleGeometry = calculateElevation(singleInput, context).computedGeometry;
    const single = singleGeometry.doorOpenings[0];
    const shiftedRightGeometry = calculateElevation(
      { ...singleInput, doorConfig: { ...singleInput.doorConfig, locationMode: "right", columnIndex: 2 } },
      context
    ).computedGeometry;
    const shiftedRight = shiftedRightGeometry.doorOpenings[0];

    expect(getDoorColumnIndex(3, "center")).toBe(1);
    expect(pair.width).toBe(72);
    expect(pair.x).toBeCloseTo(53.625);
    expect(single.width).toBe(36);
    expect(single.columnIndex).toBe(1);
    expect(single.x).toBeCloseTo(71.625);
    expect(singleGeometry.columnWidths).toEqual([70.75, 37.75, 70.75]);
    expect(shiftedRight.columnIndex).toBe(2);
    expect(shiftedRight.x).toBeCloseTo(141.5);
    expect(shiftedRightGeometry.columnWidths).toEqual([70.75, 69.875, 38.625]);
    const shiftedRightBottomLites = shiftedRightGeometry.lites.filter((lite) => lite.rowIndex === 0);
    expect(shiftedRightBottomLites[0].glassWidth).toBeCloseTo(shiftedRightBottomLites[1].glassWidth);
    expect(shiftedRightBottomLites[0].mark).toBe(shiftedRightBottomLites[1].mark);
  });

  it("locks an off-center single door bay to the door package and pushes the remainder into one outer bay", () => {
    const storefrontRulePack = structuredClone(defaultStorefrontRulePack);
    storefrontRulePack.perimeterJoints = { head: 0, sill: 0, leftJamb: 0, rightJamb: 0 };
    storefrontRulePack.sightlines = {
      leftJamb: 2,
      rightJamb: 2,
      verticalMullion: 2,
      doorJamb: 2,
      head: 2,
      sill: 2,
      horizontalMullion: 2
    };
    storefrontRulePack.defaultSubsillId = "test-flat";
    storefrontRulePack.subsillOptions["test-flat"] = { label: "Flat test sill", height: 0 };

    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        measurementSet: createSquaredMeasurementSet(120, 120),
        rows: 2,
        columns: 4,
        columnSizingMode: "equal",
        columnWidths: [1, 1, 1, 1],
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          doorType: "single",
          widthPerLeaf: 36,
          locationMode: "custom",
          columnIndex: 1
        }
      },
      { ...context, storefrontRulePack }
    );
    const [bay1, bay2, bay3, bay4] = elevation.computedGeometry.columnWidths;
    const door = elevation.computedGeometry.doorOpenings[0];
    const rightBottomLites = elevation.computedGeometry.lites.filter((lite) => lite.rowIndex === 0 && lite.columnIndex >= 2);

    expect(bay1).toBeCloseTo(22);
    expect(bay2).toBeCloseTo(38);
    expect(bay4).toBeGreaterThan(bay3);
    expect(door.x).toBeCloseTo(23);
    expect(door.width).toBe(36);
    expect(rightBottomLites).toHaveLength(2);
    expect(rightBottomLites[0].glassWidth).toBeCloseTo(rightBottomLites[1].glassWidth);
    expect(rightBottomLites[0].mark).toBe(rightBottomLites[1].mark);
  });

  it("groups equal off-center single-door glass under one tag on the long side", () => {
    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        columns: 5,
        columnSizingMode: "equal",
        columnWidths: [1, 1, 1, 1, 1],
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          doorType: "single",
          widthPerLeaf: 36,
          locationMode: "custom",
          columnIndex: 1
        }
      },
      context
    );
    const rightBottomLites = elevation.computedGeometry.lites.filter((lite) => lite.rowIndex === 0 && lite.columnIndex >= 2);
    const rightTopLites = elevation.computedGeometry.lites.filter(
      (lite) => lite.rowIndex === 1 && lite.columnIndex >= 2 && lite.type !== "transom"
    );

    expect(new Set(rightBottomLites.map((lite) => lite.mark)).size).toBe(1);
    expect(new Set(rightTopLites.map((lite) => lite.mark)).size).toBe(1);
    expect(new Set(rightBottomLites.map((lite) => lite.glassWidth))).toEqual(new Set([34.4375]));
    expect(new Set(rightTopLites.map((lite) => lite.glassWidth))).toEqual(new Set([34.4375]));
  });

  it("draws door guide lines from the latch-side corners to the hinge-side midpoint", () => {
    const singleLeaf = getDoorLeafVisuals({ width: 36, height: 84, leafCount: 1 })[0];
    const pairLeaves = getDoorLeafVisuals({ width: 72, height: 84, leafCount: 2 });

    expect(singleLeaf.members).toEqual([
      { role: "left-stile", x: 0, y: 0, width: 4, height: 84 },
      { role: "right-stile", x: 32, y: 0, width: 4, height: 84 },
      { role: "top-rail", x: 4, y: 0, width: 28, height: 4 },
      { role: "bottom-rail", x: 4, y: 74, width: 28, height: 10 }
    ]);
    expect(singleLeaf.guideStartTop).toEqual({ x: 36, y: 0 });
    expect(singleLeaf.guideStartBottom).toEqual({ x: 36, y: 84 });
    expect(singleLeaf.guideEnd).toEqual({ x: 0, y: 42 });

    expect(pairLeaves[0].guideStartTop).toEqual({ x: 36, y: 0 });
    expect(pairLeaves[0].guideEnd).toEqual({ x: 0, y: 42 });
    expect(pairLeaves[1].guideStartTop).toEqual({ x: 36, y: 0 });
    expect(pairLeaves[1].guideEnd).toEqual({ x: 72, y: 42 });
  });

  it("includes door leaf glass on the glass takeoff", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);
    const doorGlass = elevation.computedGlass.items.find((item) => item.sourceType === "door-lite");
    const doorCallouts = getDoorGlassCalloutMap(elevation.computedGlass.items);

    expect(doorGlass).toMatchObject({
      mark: "DG1",
      qty: 2,
      width: 28,
      height: 70,
      safetyGlazingLikely: true,
      sourceType: "door-lite"
    });
    expect(doorGlass?.location).toBe("D1L1, D1L2");
    expect(doorCallouts).toEqual({
      D1L1: { mark: "DG1", width: 28, height: 70 },
      D1L2: { mark: "DG1", width: 28, height: 70 }
    });
  });

  it("numbers column, door, and sub-assemblies deterministically", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);
    const callouts = elevation.computedGeometry.assemblyCallouts;

    expect(callouts.filter((callout) => callout.type === "column").map((callout) => callout.mark)).toEqual([
      "A1",
      "A2",
      "A3"
    ]);
    expect(callouts.filter((callout) => callout.type === "door").map((callout) => callout.mark)).toEqual(["DA1"]);
    expect(callouts.filter((callout) => callout.level === "subassembly").map((callout) => callout.mark)).toEqual([
      "SA1",
      "SA2",
      "SA3",
      "SA4",
      "SA5",
      "SA6",
      "SA7"
    ]);
    expect(callouts.find((callout) => callout.type === "transom")?.parentMark).toBe("DA1");
  });

  it("reuses the same storefront tag for equal-size lites", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);

    expect(new Set(elevation.computedGeometry.lites.map((lite) => lite.mark))).toEqual(new Set(["G1"]));
    expect(elevation.computedGlass.items).toHaveLength(1);
    expect(elevation.computedGlass.items[0]).toMatchObject({
      mark: "G1",
      qty: 4,
      location: "R1C1, R1C2, R2C1, R2C2",
      sourceType: "storefront-lite"
    });
  });

  it("generates advisory warnings without blocking ordinary PDF output", () => {
    const elevation = calculateElevation(pairDoorSeedInput, context);
    const codes = elevation.validationFlags.map((flag) => flag.code);

    expect(codes).toContain("safety-glazing");
    expect(codes).toContain("expansion-vertical-advisory");
    expect(codes).toContain("existing-building-context");
    expect(elevation.validationFlags.some((flag) => flag.severity === "error")).toBe(false);
  });

  it("renders multiple door sets in separate left-to-right bays", () => {
    const elevation = calculateElevation(
      {
        ...pairDoorSeedInput,
        columns: 4,
        doorConfig: {
          ...pairDoorSeedInput.doorConfig,
          doorSetCount: 2,
          doorSets: [
            {
              ...pairDoorSeedInput.doorConfig.doorSets[0],
              columnIndex: 1
            },
            {
              ...pairDoorSeedInput.doorConfig.doorSets[0],
              id: "door-set-2",
              columnIndex: 2,
              doorType: "single",
              hardwareNoteIds: ["closer", "pull-push"]
            }
          ]
        }
      },
      context
    );
    const doorGlass = elevation.computedGlass.items.filter((item) => item.sourceType === "door-lite");

    expect(elevation.computedGeometry.doorOpenings).toHaveLength(2);
    expect(elevation.computedGeometry.doorOpenings.map((door) => door.columnIndex)).toEqual([1, 2]);
    expect(elevation.computedGeometry.doorOpenings.map((door) => door.leafCount)).toEqual([2, 1]);
    expect(elevation.computedGeometry.assemblyCallouts.filter((callout) => callout.type === "door").map((callout) => callout.mark)).toEqual(["DA1", "DA2"]);
    expect(elevation.computedGeometry.bays.filter((bay) => bay.type === "door")).toHaveLength(2);
    expect(doorGlass.reduce((qty, item) => qty + item.qty, 0)).toBe(3);
    expect(elevation.validationFlags.some((flag) => flag.message.includes("only places Door Set 1"))).toBe(false);
  });

  it("creates immutable revision snapshots", () => {
    const elevation = calculateElevation(noDoorSeedInput, context);
    const revision = createRevisionSnapshot(elevation, "A");

    elevation.computedGeometry.lites[0].glassWidth = 999;

    expect(revision.number).toBe("A");
    expect(revision.snapshot.computedGeometry.lites[0].glassWidth).not.toBe(999);
    expect(revision.snapshot.input.name).toBe(noDoorSeedInput.name);
  });
});
