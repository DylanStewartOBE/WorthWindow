import { roundToPrecision, roundToSixteenth } from "./format";
import { buildGlassTakeoff } from "./glass";
import { getDoorLeafVisuals } from "./door";
import { getGoverningDimensions } from "./measurements";
import type {
  AssemblyCallout,
  Bay,
  BayType,
  ComputedGeometry,
  ComputedGlass,
  DoorOpening,
  DoorSetConfig,
  ElevationInput,
  EntranceRulePack,
  Lite,
  LiteType,
  MemberSegment,
  NoteLibrary,
  StorefrontRulePack,
  Transom
} from "./types";

type VerticalBoundaryType = "edge-left" | "edge-right" | "mullion" | "door-jamb";
type HorizontalBoundaryType = "head" | "sill" | "horizontal-mullion" | "door-threshold";

export interface GeometryResult {
  geometry: ComputedGeometry;
  glass: ComputedGlass;
  governingWidth: number;
  governingHeight: number;
}

interface LiteDraft {
  rowIndex: number;
  columnIndex: number;
  bayId: string;
  type: LiteType;
  x: number;
  y: number;
  width: number;
  height: number;
  dloX: number;
  dloY: number;
  dloWidth: number;
  dloHeight: number;
  glassWidth: number;
  glassHeight: number;
  safetyGlazingLikely: boolean;
}

interface BayClearSpan {
  x: number;
  width: number;
}

interface DoorLiteSpec {
  rowIndex: number;
  y: number;
  height: number;
  type: LiteType;
  safetyGlazingLikely: boolean;
  bottomBoundaryType: HorizontalBoundaryType;
  topBoundaryType: HorizontalBoundaryType;
  label: string;
}

interface DoorSetRuntime extends DoorSetConfig {
  index: number;
  columnIndex: number;
  leafCount: number;
  clearWidth: number;
  requiredBayWidth: number;
}

export function calculateGeometry(
  input: ElevationInput,
  storefrontRules: StorefrontRulePack,
  entranceRules: EntranceRulePack,
  noteLibrary: NoteLibrary
): GeometryResult {
  const governing = getGoverningDimensions(input.measurementSet);
  const hasDoor = input.doorConfig.hasDoor && input.doorConfig.doorType !== "none";

  const result = hasDoor
    ? calculateDoorGeometry(input, storefrontRules, entranceRules, noteLibrary, governing)
    : calculateNoDoorGeometry(input, storefrontRules, noteLibrary, governing);
  const glass = buildGlassTakeoff(result.geometry.lites, result.geometry.doorOpenings, input.glassConfig);
  const markedLites = result.geometry.lites.map((lite) => ({
    ...lite,
    mark: glass.storefrontMarks[lite.id] ?? lite.mark
  }));

  return {
    ...result,
    geometry: {
      ...result.geometry,
      lites: markedLites
    },
    glass: glass.computedGlass
  };
}

function calculateNoDoorGeometry(
  input: ElevationInput,
  storefrontRules: StorefrontRulePack,
  noteLibrary: NoteLibrary,
  governing: { openingWidthMeasured: number; openingHeightMeasured: number }
): Omit<GeometryResult, "glass"> {
  const joints = storefrontRules.perimeterJoints;
  const subsill = storefrontRules.subsillOptions[storefrontRules.defaultSubsillId];
  const rows = Math.max(1, input.rows);
  const columns = Math.max(1, input.columns);
  const frameWidth = roundToPrecision(
    governing.openingWidthMeasured - joints.leftJamb - joints.rightJamb
  );
  const frameHeight = roundToPrecision(governing.openingHeightMeasured - joints.head - joints.sill);
  const verticalBoundaryTypes = buildNoDoorVerticalBoundaryTypes(columns);
  const horizontalBoundaryTypes = buildNoDoorHorizontalBoundaryTypes(rows);
  const columnWidths = resolveLiteAxisSizes(
    input.columnSizingMode,
    input.columnWidths,
    columns,
    frameWidth,
    verticalBoundaryTypes,
    "vertical",
    storefrontRules
  );
  const rowHeights = resolveLiteAxisSizes(
    input.rowSizingMode,
    input.rowHeights,
    rows,
    frameHeight,
    horizontalBoundaryTypes,
    "horizontal",
    storefrontRules
  );
  const xPositions = getCumulativePositions(columnWidths);
  const yPositions = getCumulativePositions(rowHeights);

  const bays: Bay[] = [];
  const drafts: LiteDraft[] = [];

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const id = `bay-r${rowIndex + 1}-c${columnIndex + 1}`;
      const bay = {
        id,
        rowIndex,
        columnIndex,
        type: "lite" as BayType,
        x: xPositions[columnIndex],
        y: yPositions[rowIndex],
        width: columnWidths[columnIndex],
        height: rowHeights[rowIndex],
        label: `Lite bay R${rowIndex + 1} C${columnIndex + 1}`
      };

      bays.push(bay);
      drafts.push(
        createLiteDraft({
          bay,
          rowIndex,
          columnIndex,
          type: "fixed",
          safetyGlazingLikely: false,
          leftBoundaryType: verticalBoundaryTypes[columnIndex],
          rightBoundaryType: verticalBoundaryTypes[columnIndex + 1],
          bottomBoundaryType: horizontalBoundaryTypes[rowIndex],
          topBoundaryType: horizontalBoundaryTypes[rowIndex + 1],
          storefrontRules
        })
      );
    }
  }

  const lites = createLites(drafts, storefrontRules);
  const members = buildNoDoorMembers(lites, rowHeights, columnWidths, frameWidth, frameHeight, storefrontRules);

  const geometry: ComputedGeometry = {
    frameWidth,
    frameHeight,
    openingWidthMeasured: governing.openingWidthMeasured,
    openingHeightMeasured: governing.openingHeightMeasured,
    subsillType: storefrontRules.defaultSubsillId,
    subsillHeight: subsill.height,
    subsillWidth: roundToPrecision(frameWidth + 0.25),
    perimeterJoints: joints,
    sightlines: storefrontRules.sightlines,
    rowHeights,
    columnWidths,
    bays,
    members,
    lites,
    transoms: [],
    doorOpenings: [],
    assemblyCallouts: buildAssemblyCallouts({
      frameHeight,
      columnWidths,
      lites,
      transoms: [],
      doorOpenings: []
    }),
    dimensions: [
      dimension("overall-width", "Opening width", governing.openingWidthMeasured, "horizontal", 0, frameWidth, -12),
      dimension("overall-height", "Opening height", governing.openingHeightMeasured, "vertical", 0, frameHeight, -12),
      dimension("frame-width", "Frame width", frameWidth, "horizontal", 0, frameWidth, -6),
      dimension("frame-height", "Frame height", frameHeight, "vertical", 0, frameHeight, -6),
      ...buildAxisDimensions("column", columnWidths, "horizontal"),
      ...buildAxisDimensions("row", rowHeights, "vertical")
    ],
    notes: buildNotes(input, storefrontRules, undefined, noteLibrary),
    memberCalcs: {
      mullionHeight: roundToPrecision(frameHeight - subsill.height),
      typicalHorizontalLength: lites[0]?.dloWidth ?? 0,
      typicalHorizontalGlassStopLength: roundToSixteenth(
        Math.max((lites[0]?.dloWidth ?? 0) - storefrontRules.memberRules.horizontalGlassStopDeduct, 0)
      ),
      leftSideliteSubsillWidth: 0,
      rightSideliteSubsillWidth: 0,
      doorJambHeight: 0
    }
  };

  return { geometry, governingWidth: governing.openingWidthMeasured, governingHeight: governing.openingHeightMeasured };
}

function calculateDoorGeometry(
  input: ElevationInput,
  storefrontRules: StorefrontRulePack,
  entranceRules: EntranceRulePack,
  noteLibrary: NoteLibrary,
  governing: { openingWidthMeasured: number; openingHeightMeasured: number }
): Omit<GeometryResult, "glass"> {
  const joints = storefrontRules.perimeterJoints;
  const subsill = storefrontRules.subsillOptions[storefrontRules.defaultSubsillId];
  const columns = Math.max(2, input.columns);
  const configuredRows = Math.max(1, input.rows);
  const frameWidth = roundToPrecision(
    governing.openingWidthMeasured - joints.leftJamb - joints.rightJamb
  );
  const frameHeight = roundToPrecision(governing.openingHeightMeasured - joints.head);
  const doorSetsBase = getConfiguredDoorSets(input, columns);
  const doorColumnIndices = doorSetsBase.map((doorSet) => doorSet.columnIndex);
  const rows = configuredRows;
  const maxDoorHeight = Math.max(...doorSetsBase.map((doorSet) => doorSet.height));
  const hasDoorTransom = frameHeight > maxDoorHeight;

  const boundaryTypes = buildDoorBoundaryTypes(columns, doorColumnIndices);
  const doorSets = doorSetsBase.map((doorSet) => ({
    ...doorSet,
    requiredBayWidth: getRequiredDoorBayWidth(doorSet, boundaryTypes, storefrontRules)
  }));
  const primaryDoorSet = doorSets[0];
  const bayWidths = resolveMultiDoorBayWidths(
    input.columnSizingMode,
    input.columnWidths,
    columns,
    frameWidth,
    doorSets,
    boundaryTypes,
    storefrontRules
  );
  const xPositions = getCumulativePositions(bayWidths);

  const doorTopBoundaryType: HorizontalBoundaryType = hasDoorTransom ? "horizontal-mullion" : "head";
  const doorZoneHeight = roundToPrecision(
    Math.min(frameHeight, maxDoorHeight + getHorizontalBoundaryInset(doorTopBoundaryType, storefrontRules))
  );
  const rowHeights =
    rows === 1
      ? [frameHeight]
      : resolveDoorRowHeights(
          input.rowSizingMode,
          input.rowHeights,
          rows,
          frameHeight,
          doorZoneHeight,
          input.doorConfig.rowPlacement
        );
  const yPositions = getCumulativePositions(rowHeights);
  const doorBayHeight =
    hasDoorTransom && rows === 1
      ? doorZoneHeight
      : resolveDoorBayHeight(rowHeights, input.doorConfig.rowPlacement);
  const doorTransomSpecs =
    hasDoorTransom && rows === 1
      ? [{ rowIndex: 1, y: doorZoneHeight, height: roundToPrecision(frameHeight - doorZoneHeight) }]
      : hasDoorTransom
        ? buildDoorTransomSpecs(rowHeights, input.doorConfig.rowPlacement)
        : [];

  const doorSetByColumn = new Map(doorSets.map((doorSet) => [doorSet.columnIndex, doorSet]));
  const bays: Bay[] = [];
  const drafts: LiteDraft[] = [];
  const transoms: Transom[] = [];

  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    const doorSet = doorSetByColumn.get(columnIndex);
    if (doorSet) {
      const doorBay: Bay = {
        id: `bay-door-${doorSet.index + 1}`,
        rowIndex: 0,
        columnIndex,
        type: "door",
        x: xPositions[columnIndex],
        y: 0,
        width: bayWidths[columnIndex],
        height: doorBayHeight,
        label: `Door ${doorSet.index + 1} opening zone`
      };
      bays.push(doorBay);

      doorTransomSpecs
        .filter((spec) => spec.height > 0)
        .forEach((spec) => {
          const isTopTransom = roundToPrecision(spec.y + spec.height) >= frameHeight;
          const bay: Bay = {
            id: `bay-door-${doorSet.index + 1}-transom-r${spec.rowIndex + 1}-c${columnIndex + 1}`,
            rowIndex: spec.rowIndex,
            columnIndex,
            type: "transom",
            x: xPositions[columnIndex],
            y: spec.y,
            width: bayWidths[columnIndex],
            height: spec.height,
            label: `Transom above door ${doorSet.index + 1}`
          };
          bays.push(bay);
          drafts.push(
            createLiteDraft({
              bay,
              rowIndex: spec.rowIndex,
              columnIndex,
              type: "transom",
              safetyGlazingLikely: true,
              leftBoundaryType: boundaryTypes[columnIndex],
              rightBoundaryType: boundaryTypes[columnIndex + 1],
              bottomBoundaryType: "horizontal-mullion",
              topBoundaryType: isTopTransom ? "head" : "horizontal-mullion",
              storefrontRules
            })
          );
        });
      continue;
    }

    buildDoorLiteSpecs(rowHeights, input.doorConfig.rowPlacement, columnIndex, doorColumnIndices).forEach((spec) => {
      const bay: Bay = {
        id: `bay-r${spec.rowIndex + 1}-c${columnIndex + 1}`,
        rowIndex: spec.rowIndex,
        columnIndex,
        type: "lite",
        x: xPositions[columnIndex],
        y: spec.y,
        width: bayWidths[columnIndex],
        height: spec.height,
        label: spec.label
      };
      bays.push(bay);
      drafts.push(
        createLiteDraft({
          bay,
          rowIndex: spec.rowIndex,
          columnIndex,
          type: spec.type,
          safetyGlazingLikely: spec.safetyGlazingLikely,
          leftBoundaryType: boundaryTypes[columnIndex],
          rightBoundaryType: boundaryTypes[columnIndex + 1],
          bottomBoundaryType: spec.bottomBoundaryType,
          topBoundaryType: spec.topBoundaryType,
          storefrontRules
        })
      );
    });
  }

  const lites = createLites(drafts, storefrontRules);
  const members = buildDoorMembers(
    bays,
    lites,
    columns,
    frameWidth,
    frameHeight,
    boundaryTypes,
    xPositions,
    bayWidths,
    storefrontRules
  );

  const doorOpenings = doorSets.map((doorSet) => {
    const doorBay = bays.find((bay) => bay.id === `bay-door-${doorSet.index + 1}`);
    if (!doorBay) {
      throw new Error(`Door bay ${doorSet.index + 1} could not be generated.`);
    }

    const doorBayLeftDeduction = getVerticalBoundaryInset(boundaryTypes[doorSet.columnIndex], storefrontRules);
    const actualDoorHeight = roundToPrecision(
      Math.min(
        doorSet.height,
        Math.max(doorBay.height - getHorizontalBoundaryInset(doorTopBoundaryType, storefrontRules), 0)
      )
    );

    return {
      id: `door-${doorSet.doorType}-${doorSet.index + 1}`,
      type: doorSet.doorType,
      columnIndex: doorSet.columnIndex,
      x: roundToPrecision(doorBay.x + doorBayLeftDeduction),
      y: 0,
      width: doorSet.clearWidth,
      height: actualDoorHeight,
      leafCount: doorSet.leafCount,
      widthPerLeaf: doorSet.widthPerLeaf,
      swing: doorSet.swing,
      hingeType: doorSet.hingeType,
      locationMode: doorSet.locationMode,
      clearWidthAdvisory: roundToPrecision(doorSet.widthPerLeaf - entranceRules.assumedClearWidthDeduct)
    };
  });

  lites
    .filter((lite) => lite.type === "transom")
    .forEach((lite) => {
      const doorOpening = doorOpenings.find((door) => door.columnIndex === lite.columnIndex);
      if (!doorOpening) return;
      transoms.push({
        id: `transom-${lite.id}`,
        liteId: lite.id,
        aboveDoorId: doorOpening.id,
        width: lite.width,
        height: lite.height
      });
    });

  const doorBays = bays.filter((bay) => bay.type === "door");
  const firstDoorBay = bays.find((bay) => bay.id === `bay-door-${primaryDoorSet.index + 1}`);
  if (!firstDoorBay) {
    throw new Error("Primary door bay could not be generated.");
  }
  const leftSideWidth = roundToPrecision(Math.min(...doorBays.map((bay) => bay.x)));
  const rightSideWidth = roundToPrecision(
    frameWidth - Math.max(...doorBays.map((bay) => bay.x + bay.width))
  );

  const geometry: ComputedGeometry = {
    frameWidth,
    frameHeight,
    openingWidthMeasured: governing.openingWidthMeasured,
    openingHeightMeasured: governing.openingHeightMeasured,
    subsillType: storefrontRules.defaultSubsillId,
    subsillHeight: subsill.height,
    subsillWidth: roundToPrecision(leftSideWidth + rightSideWidth + storefrontRules.entranceSideliteSubsillAdd * 2),
    perimeterJoints: joints,
    sightlines: storefrontRules.sightlines,
    rowHeights,
    columnWidths: bayWidths,
    bays,
    members,
    lites,
    transoms,
    doorOpenings,
    assemblyCallouts: buildAssemblyCallouts({
      frameHeight,
      columnWidths: bayWidths,
      lites,
      transoms,
      doorOpenings
    }),
    dimensions: [
      dimension("overall-width", "Opening width", governing.openingWidthMeasured, "horizontal", 0, frameWidth, -12),
      dimension("overall-height", "Opening height", governing.openingHeightMeasured, "vertical", 0, frameHeight, -12),
      dimension("frame-width", "Frame width", frameWidth, "horizontal", 0, frameWidth, -6),
      ...doorOpenings.flatMap((door, index) => [
        dimension(`door-${index + 1}-size`, `Door ${index + 1} opening`, door.width, "horizontal", door.x, door.x + door.width, 6 + index * 4),
        dimension(`door-${index + 1}-height`, `Door ${index + 1} height`, door.height, "vertical", 0, door.height, 6 + index * 4)
      ]),
      dimension("left-sidelite", "Left sidelite zone", leftSideWidth, "horizontal", 0, leftSideWidth, 10),
      dimension("right-sidelite", "Right sidelite zone", rightSideWidth, "horizontal", frameWidth - rightSideWidth, frameWidth, 10),
      ...buildAxisDimensions("column", bayWidths, "horizontal"),
      ...(rows > 1 ? buildAxisDimensions("row", rowHeights, "vertical") : []),
      ...(hasDoorTransom
        ? [dimension("transom-zone-height", "Transom zone height", frameHeight - doorBayHeight, "vertical", doorBayHeight, frameHeight, 12)]
        : [])
    ],
    notes: buildNotes(input, storefrontRules, entranceRules, noteLibrary),
    memberCalcs: {
      mullionHeight: roundToPrecision(frameHeight - subsill.height),
      typicalHorizontalLength: lites[0]?.dloWidth ?? 0,
      typicalHorizontalGlassStopLength: roundToSixteenth(
        Math.max((lites[0]?.dloWidth ?? 0) - storefrontRules.memberRules.horizontalGlassStopDeduct, 0)
      ),
      leftSideliteSubsillWidth:
        leftSideWidth > 0 ? roundToPrecision(leftSideWidth + storefrontRules.entranceSideliteSubsillAdd) : 0,
      rightSideliteSubsillWidth:
        rightSideWidth > 0 ? roundToPrecision(rightSideWidth + storefrontRules.entranceSideliteSubsillAdd) : 0,
      doorJambHeight: frameHeight
    }
  };

  return { geometry, governingWidth: governing.openingWidthMeasured, governingHeight: governing.openingHeightMeasured };
}

function createLiteDraft({
  bay,
  rowIndex,
  columnIndex,
  type,
  safetyGlazingLikely,
  leftBoundaryType,
  rightBoundaryType,
  bottomBoundaryType,
  topBoundaryType,
  storefrontRules
}: {
  bay: Bay;
  rowIndex: number;
  columnIndex: number;
  type: LiteType;
  safetyGlazingLikely: boolean;
  leftBoundaryType: VerticalBoundaryType;
  rightBoundaryType: VerticalBoundaryType;
  bottomBoundaryType: HorizontalBoundaryType;
  topBoundaryType: HorizontalBoundaryType;
  storefrontRules: StorefrontRulePack;
}): LiteDraft {
  const leftDeduction = getVerticalBoundaryInset(leftBoundaryType, storefrontRules);
  const rightDeduction = getVerticalBoundaryInset(rightBoundaryType, storefrontRules);
  const bottomDeduction = getHorizontalBoundaryInset(bottomBoundaryType, storefrontRules);
  const topDeduction = getHorizontalBoundaryInset(topBoundaryType, storefrontRules);
  const leftGlassBite = getVerticalGlassBite(leftBoundaryType, storefrontRules);
  const rightGlassBite = getVerticalGlassBite(rightBoundaryType, storefrontRules);
  const bottomGlassBite = getHorizontalGlassBite(bottomBoundaryType, storefrontRules);
  const topGlassBite = getHorizontalGlassBite(topBoundaryType, storefrontRules);
  const dloWidth = roundToSixteenth(Math.max(bay.width - leftDeduction - rightDeduction, 0));
  const dloHeight = roundToSixteenth(Math.max(bay.height - bottomDeduction - topDeduction, 0));

  return {
    rowIndex,
    columnIndex,
    bayId: bay.id,
    type,
    x: bay.x,
    y: bay.y,
    width: bay.width,
    height: bay.height,
    dloX: roundToPrecision(bay.x + leftDeduction),
    dloY: roundToPrecision(bay.y + bottomDeduction),
    dloWidth,
    dloHeight,
    glassWidth: roundToSixteenth(dloWidth + leftGlassBite + rightGlassBite),
    glassHeight: roundToSixteenth(dloHeight + bottomGlassBite + topGlassBite),
    safetyGlazingLikely
  };
}

function createLites(drafts: LiteDraft[], storefrontRules: StorefrontRulePack): Lite[] {
  return drafts.map((draft, index) => ({
    id: `lite-${index + 1}`,
    rowIndex: draft.rowIndex,
    columnIndex: draft.columnIndex,
    type: draft.type,
    bayId: draft.bayId,
    width: roundToPrecision(draft.width),
    height: roundToPrecision(draft.height),
    dloX: draft.dloX,
    dloY: draft.dloY,
    dloWidth: draft.dloWidth,
    dloHeight: draft.dloHeight,
    glassWidth: draft.glassWidth,
    glassHeight: draft.glassHeight,
    safetyGlazingLikely: draft.safetyGlazingLikely,
    quantity: 1,
    mark: `G${index + 1}`
  }));
}

function buildAssemblyCallouts({
  frameHeight,
  columnWidths,
  lites,
  transoms,
  doorOpenings
}: {
  frameHeight: number;
  columnWidths: number[];
  lites: Lite[];
  transoms: Transom[];
  doorOpenings: DoorOpening[];
}): AssemblyCallout[] {
  const callouts: AssemblyCallout[] = [];
  const columnPositions = getCumulativePositions(columnWidths);
  const doorAssemblyMarks = new Map<string, string>();

  columnWidths.forEach((width, index) => {
    callouts.push({
      id: `assembly-column-${index + 1}`,
      mark: `A${index + 1}`,
      level: "assembly",
      type: "column",
      elementId: `column-${index + 1}`,
      x: roundToPrecision(columnPositions[index] + width / 2),
      y: roundToPrecision(frameHeight + 10)
    });
  });

  doorOpenings.forEach((door, index) => {
    const mark = `DA${index + 1}`;
    doorAssemblyMarks.set(door.id, mark);
    callouts.push({
      id: `assembly-door-${door.id}`,
      mark,
      level: "assembly",
      type: "door",
      elementId: door.id,
      parentMark: `A${door.columnIndex + 1}`,
      x: roundToPrecision(door.x + door.width / 2),
      y: roundToPrecision(frameHeight + 4)
    });
  });

  let subassemblyIndex = 1;
  lites.forEach((lite) => {
    const matchingTransom = transoms.find((transom) => transom.liteId === lite.id);
    const parentMark = matchingTransom
      ? doorAssemblyMarks.get(matchingTransom.aboveDoorId) ?? `A${lite.columnIndex + 1}`
      : `A${lite.columnIndex + 1}`;
    callouts.push({
      id: `subassembly-${lite.id}`,
      mark: `SA${subassemblyIndex++}`,
      level: "subassembly",
      type: lite.type === "transom" ? "transom" : "lite",
      elementId: lite.id,
      parentMark,
      x: roundToPrecision(lite.dloX + Math.min(5, Math.max(lite.dloWidth / 2, 0))),
      y: roundToPrecision(lite.dloY + Math.max(lite.dloHeight - Math.min(5, Math.max(lite.dloHeight / 2, 0)), 0))
    });
  });

  doorOpenings.forEach((door) => {
    const parentMark = doorAssemblyMarks.get(door.id);
    getDoorLeafVisuals(door).forEach((leaf) => {
      callouts.push({
        id: `subassembly-${door.id}-leaf-${leaf.leafIndex + 1}`,
        mark: `SA${subassemblyIndex++}`,
        level: "subassembly",
        type: "door-leaf",
        elementId: `${door.id}-leaf-${leaf.leafIndex + 1}`,
        parentMark,
        x: roundToPrecision(door.x + leaf.leafX + leaf.leafWidth / 2),
        y: roundToPrecision(door.y + Math.min(8, Math.max(door.height / 2, 0)))
      });
    });
  });

  return callouts;
}

function buildNoDoorMembers(
  lites: Lite[],
  rowHeights: number[],
  columnWidths: number[],
  frameWidth: number,
  frameHeight: number,
  storefrontRules: StorefrontRulePack
): MemberSegment[] {
  const members: MemberSegment[] = [
    {
      id: "member-left-jamb",
      role: "left-jamb",
      x: 0,
      y: 0,
      width: storefrontRules.sightlines.leftJamb,
      height: frameHeight
    },
    {
      id: "member-right-jamb",
      role: "right-jamb",
      x: roundToPrecision(frameWidth - storefrontRules.sightlines.rightJamb),
      y: 0,
      width: storefrontRules.sightlines.rightJamb,
      height: frameHeight
    }
  ];

  const xPositions = getCumulativePositions(columnWidths);
  for (let columnIndex = 1; columnIndex < columnWidths.length; columnIndex += 1) {
    members.push({
      id: `member-v-${columnIndex}`,
      role: "vertical-mullion",
      x: roundToPrecision(xPositions[columnIndex] - storefrontRules.sightlines.verticalMullion / 2),
      y: 0,
      width: storefrontRules.sightlines.verticalMullion,
      height: frameHeight
    });
  }

  const bottomRowLites = lites.filter((lite) => lite.rowIndex === 0);
  const topRowLites = lites.filter((lite) => lite.rowIndex === rowHeights.length - 1);

  bottomRowLites.forEach((lite) => {
    members.push({
      id: `member-sill-${lite.id}`,
      role: "sill",
      x: lite.dloX,
      y: 0,
      width: lite.dloWidth,
      height: storefrontRules.sightlines.sill
    });
  });

  topRowLites.forEach((lite) => {
    members.push({
      id: `member-head-${lite.id}`,
      role: "head",
      x: lite.dloX,
      y: roundToPrecision(frameHeight - storefrontRules.sightlines.head),
      width: lite.dloWidth,
      height: storefrontRules.sightlines.head
    });
  });

  if (rowHeights.length > 1) {
    const yPositions = getCumulativePositions(rowHeights);
    for (let rowIndex = 1; rowIndex < rowHeights.length; rowIndex += 1) {
      const lowerRowLites = lites.filter((lite) => lite.rowIndex === rowIndex - 1);
      lowerRowLites.forEach((lite) => {
        members.push({
          id: `member-h-${rowIndex}-${lite.columnIndex}`,
          role: "horizontal-mullion",
          x: lite.dloX,
          y: roundToPrecision(yPositions[rowIndex] - storefrontRules.sightlines.horizontalMullion / 2),
          width: lite.dloWidth,
          height: storefrontRules.sightlines.horizontalMullion
        });
      });
    }
  }

  return members;
}

function buildDoorMembers(
  bays: Bay[],
  lites: Lite[],
  columns: number,
  frameWidth: number,
  frameHeight: number,
  boundaryTypes: VerticalBoundaryType[],
  xPositions: number[],
  bayWidths: number[],
  storefrontRules: StorefrontRulePack
): MemberSegment[] {
  const members: MemberSegment[] = [
    {
      id: "member-left-jamb",
      role: "left-jamb",
      x: 0,
      y: 0,
      width: storefrontRules.sightlines.leftJamb,
      height: frameHeight
    },
    {
      id: "member-right-jamb",
      role: "right-jamb",
      x: roundToPrecision(frameWidth - storefrontRules.sightlines.rightJamb),
      y: 0,
      width: storefrontRules.sightlines.rightJamb,
      height: frameHeight
    }
  ];

  for (let boundaryIndex = 1; boundaryIndex < columns; boundaryIndex += 1) {
    const boundaryType = boundaryTypes[boundaryIndex];
    const width =
      boundaryType === "door-jamb"
        ? storefrontRules.sightlines.doorJamb
        : storefrontRules.sightlines.verticalMullion;
    members.push({
      id: `member-v-${boundaryIndex}`,
      role: boundaryType === "door-jamb" ? "door-jamb" : "vertical-mullion",
      x: roundToPrecision(xPositions[boundaryIndex] - width / 2),
      y: 0,
      width,
      height: frameHeight
    });
  }

  const bottomRowLites = lites.filter((lite) => lite.rowIndex === 0);
  bottomRowLites.forEach((lite) => {
    members.push({
      id: `member-sill-${lite.id}`,
      role: "sill",
      x: lite.dloX,
      y: 0,
      width: lite.dloWidth,
      height: storefrontRules.sightlines.sill
    });
  });

  const topRowLites = Array.from(
    lites
      .reduce((byColumn, lite) => {
        const current = byColumn.get(lite.columnIndex);
        if (!current || lite.rowIndex > current.rowIndex) {
          byColumn.set(lite.columnIndex, lite);
        }
        return byColumn;
      }, new Map<number, Lite>())
      .values()
  );
  topRowLites.forEach((lite) => {
    members.push({
      id: `member-head-${lite.id}`,
      role: "head",
      x: lite.dloX,
      y: roundToPrecision(frameHeight - storefrontRules.sightlines.head),
      width: lite.dloWidth,
      height: storefrontRules.sightlines.head
    });
  });

  const baysByColumn = Array.from({ length: columns }, (_, columnIndex) =>
    bays
      .filter((bay) => bay.columnIndex === columnIndex)
      .sort((left, right) => left.y - right.y)
  );

  baysByColumn.forEach((columnBays, columnIndex) => {
    if (columnBays.length < 2) return;
    const span = getBayClearSpan(
      xPositions[columnIndex],
      bayWidths[columnIndex],
      boundaryTypes[columnIndex],
      boundaryTypes[columnIndex + 1],
      storefrontRules
    );

    for (let bandIndex = 0; bandIndex < columnBays.length - 1; bandIndex += 1) {
      const boundaryY = roundToPrecision(columnBays[bandIndex].y + columnBays[bandIndex].height);
      members.push({
        id: `member-h-${columnIndex}-${bandIndex}`,
        role: "horizontal-mullion",
        x: span.x,
        y: roundToPrecision(boundaryY - storefrontRules.sightlines.horizontalMullion / 2),
        width: span.width,
        height: storefrontRules.sightlines.horizontalMullion
      });
    }
  });

  return members;
}

function resolveDoorRowHeights(
  mode: ElevationInput["rowSizingMode"],
  providedSizes: number[],
  rows: number,
  frameHeight: number,
  doorZoneHeight: number,
  rowPlacement: ElevationInput["doorConfig"]["rowPlacement"]
): number[] {
  if (rows <= 1) return [roundToPrecision(frameHeight)];

  if (mode === "equal") {
    if (rowPlacement === "below") {
      const bottomCount = Math.max(rows - 1, 1);
      const bottomHeight = roundToPrecision(doorZoneHeight / bottomCount);
      return normalizeSizesToTotal(
        [...Array.from({ length: bottomCount }, () => bottomHeight), roundToPrecision(frameHeight - doorZoneHeight)],
        frameHeight,
        Math.max(rows - 2, 0)
      );
    }

    const topCount = Math.max(rows - 1, 1);
    const topHeight = roundToPrecision((frameHeight - doorZoneHeight) / topCount);
    return normalizeSizesToTotal(
        [doorZoneHeight, ...Array.from({ length: topCount }, () => topHeight)],
        frameHeight,
        rows - 1
      );
  }

  const exactIndex = rowPlacement === "below" ? rows - 1 : 0;
  const exactValue = rowPlacement === "below" ? roundToPrecision(frameHeight - doorZoneHeight) : doorZoneHeight;
  const fallbackDrivenIndex = rowPlacement === "below" ? Math.max(rows - 2, 0) : rows - 1;
  return (
    resolveCustomDrivenSizes({
      providedSizes,
      count: rows,
      total: frameHeight,
      exactSizes: new Map([[exactIndex, exactValue]]),
      fallbackDrivenIndex
    }) ??
    normalizeSizesToTotal(
      [
        ...Array.from({ length: rows }, (_, index) =>
          index === exactIndex ? exactValue : roundToPrecision((frameHeight - exactValue) / Math.max(rows - 1, 1))
        )
      ],
      frameHeight,
      fallbackDrivenIndex
    )
  );
}

function resolveDoorBayHeight(
  rowHeights: number[],
  rowPlacement: ElevationInput["doorConfig"]["rowPlacement"]
): number {
  if (rowPlacement === "below") {
    return roundToPrecision(rowHeights.slice(0, -1).reduce((sum, height) => sum + height, 0));
  }
  return rowHeights[0] ?? 0;
}

function buildDoorTransomSpecs(
  rowHeights: number[],
  rowPlacement: ElevationInput["doorConfig"]["rowPlacement"]
): Array<{ rowIndex: number; y: number; height: number }> {
  const yPositions = getCumulativePositions(rowHeights);

  if (rowPlacement === "below") {
    const rowIndex = rowHeights.length - 1;
    return rowIndex > 0 ? [{ rowIndex, y: yPositions[rowIndex], height: rowHeights[rowIndex] }] : [];
  }

  return Array.from({ length: rowHeights.length - 1 }, (_, offset) => {
    const rowIndex = offset + 1;
    return {
      rowIndex,
      y: yPositions[rowIndex],
      height: rowHeights[rowIndex]
    };
  });
}

function buildDoorLiteSpecs(
  rowHeights: number[],
  rowPlacement: ElevationInput["doorConfig"]["rowPlacement"],
  columnIndex: number,
  doorColumnIndices: number[]
): DoorLiteSpec[] {
  const yPositions = getCumulativePositions(rowHeights);
  const isDoorAdjacent = doorColumnIndices.some((doorColumnIndex) => Math.abs(columnIndex - doorColumnIndex) === 1);
  const bottomDoorZoneEndIndex = rowPlacement === "below" ? rowHeights.length - 1 : 1;

  return rowHeights.map((height, rowIndex) => {
    const isBottomDoorZoneRow = rowIndex < bottomDoorZoneEndIndex;
    return {
      rowIndex,
      y: yPositions[rowIndex],
      height,
      type: isBottomDoorZoneRow ? (isDoorAdjacent ? "door-adjacent-lite" : "sidelite") : isDoorAdjacent ? "door-adjacent-lite" : "fixed",
      safetyGlazingLikely: isBottomDoorZoneRow || isDoorAdjacent,
      bottomBoundaryType: rowIndex === 0 ? "sill" : "horizontal-mullion",
      topBoundaryType: rowIndex === rowHeights.length - 1 ? "head" : "horizontal-mullion",
      label: isBottomDoorZoneRow ? `Sidelite bay C${columnIndex + 1}` : `Upper lite R${rowIndex + 1} C${columnIndex + 1}`
    };
  });
}

function getBayClearSpan(
  x: number,
  width: number,
  leftBoundaryType: VerticalBoundaryType,
  rightBoundaryType: VerticalBoundaryType,
  storefrontRules: StorefrontRulePack
): BayClearSpan {
  const leftDeduction = getVerticalBoundaryInset(leftBoundaryType, storefrontRules);
  const rightDeduction = getVerticalBoundaryInset(rightBoundaryType, storefrontRules);

  return {
    x: roundToPrecision(x + leftDeduction),
    width: roundToSixteenth(Math.max(width - leftDeduction - rightDeduction, 0))
  };
}

function getVerticalBoundaryInset(type: VerticalBoundaryType, storefrontRules: StorefrontRulePack): number {
  if (type === "edge-left") return storefrontRules.sightlines.leftJamb;
  if (type === "edge-right") return storefrontRules.sightlines.rightJamb;
  if (type === "door-jamb") return storefrontRules.sightlines.doorJamb / 2;
  return storefrontRules.sightlines.verticalMullion / 2;
}

function getHorizontalBoundaryInset(type: HorizontalBoundaryType, storefrontRules: StorefrontRulePack): number {
  if (type === "head") return storefrontRules.sightlines.head;
  if (type === "sill") return storefrontRules.sightlines.sill;
  if (type === "door-threshold") return 0;
  return storefrontRules.sightlines.horizontalMullion / 2;
}

function getVerticalGlassBite(type: VerticalBoundaryType, storefrontRules: StorefrontRulePack): number {
  const fallback = storefrontRules.glassAdd.width / 2;
  if (!storefrontRules.glassBite) return fallback;
  if (type === "edge-left") return storefrontRules.glassBite.leftJamb;
  if (type === "edge-right") return storefrontRules.glassBite.rightJamb;
  if (type === "door-jamb") return storefrontRules.glassBite.doorJamb;
  return storefrontRules.glassBite.verticalMullion;
}

function getHorizontalGlassBite(type: HorizontalBoundaryType, storefrontRules: StorefrontRulePack): number {
  const fallback = storefrontRules.glassAdd.height / 2;
  if (!storefrontRules.glassBite) return fallback;
  if (type === "head") return storefrontRules.glassBite.head;
  if (type === "sill") return storefrontRules.glassBite.sill;
  if (type === "door-threshold") return 0;
  return storefrontRules.glassBite.horizontalMullion;
}

function buildDoorBoundaryTypes(columns: number, doorColumnIndex: number | number[]): VerticalBoundaryType[] {
  const doorColumnIndices = Array.isArray(doorColumnIndex) ? doorColumnIndex : [doorColumnIndex];
  const boundaryTypes: VerticalBoundaryType[] = Array.from({ length: columns + 1 }, (_, index) => {
    if (index === 0) return "edge-left";
    if (index === columns) return "edge-right";
    if (doorColumnIndices.some((columnIndex) => index === columnIndex || index === columnIndex + 1)) return "door-jamb";
    return "mullion";
  });
  return boundaryTypes;
}

function getConfiguredDoorSets(input: ElevationInput, columns: number): DoorSetRuntime[] {
  const configuredCount = Math.max(
    1,
    Math.min(columns, input.doorConfig.doorSetCount ?? input.doorConfig.doorSets?.length ?? 1)
  );
  const rawDoorSets =
    input.doorConfig.doorSets?.length
      ? input.doorConfig.doorSets
      : [
          {
            id: "door-set-1",
            rowIndex: 0,
            doorType: input.doorConfig.doorType === "pair" ? "pair" : "single",
            widthPerLeaf: input.doorConfig.widthPerLeaf,
            height: input.doorConfig.height,
            locationMode: input.doorConfig.locationMode,
            columnIndex: input.doorConfig.columnIndex,
            swing: input.doorConfig.swing,
            hingeType: input.doorConfig.hingeType,
            hardwareNoteIds: input.doorConfig.hardwareNoteIds,
            thresholdNoteId: input.doorConfig.thresholdNoteId
          } satisfies DoorSetConfig
        ];
  const usedColumns = new Set<number>();

  return Array.from({ length: configuredCount }, (_, index) => {
    const rawDoorSet = rawDoorSets[index] ?? rawDoorSets[rawDoorSets.length - 1];
    const locationMode = index === 0 ? input.doorConfig.locationMode : rawDoorSet?.locationMode ?? "center";
    const preferredColumnIndex =
      index === 0 && input.doorConfig.columnIndex !== null && Number.isFinite(input.doorConfig.columnIndex)
        ? clampColumnIndex(Number(input.doorConfig.columnIndex), columns)
        : rawDoorSet?.columnIndex !== null && Number.isFinite(rawDoorSet?.columnIndex)
        ? clampColumnIndex(Number(rawDoorSet?.columnIndex), columns)
        : getDoorColumnIndex(columns, locationMode);
    const columnIndex = usedColumns.has(preferredColumnIndex)
      ? getFirstAvailableColumnIndex(usedColumns, columns) ?? preferredColumnIndex
      : preferredColumnIndex;
    usedColumns.add(columnIndex);

    const doorType =
      index === 0
        ? input.doorConfig.doorType === "pair"
          ? "pair"
          : "single"
        : rawDoorSet?.doorType === "pair"
          ? "pair"
          : rawDoorSet?.doorType === "single"
            ? "single"
            : "single";
    const leafCount = doorType === "pair" ? 2 : 1;
    const rawWidthPerLeaf = index === 0 ? input.doorConfig.widthPerLeaf : rawDoorSet?.widthPerLeaf;
    const rawHeight = index === 0 ? input.doorConfig.height : rawDoorSet?.height;
    const widthPerLeaf = Number.isFinite(rawWidthPerLeaf) && Number(rawWidthPerLeaf) > 0 ? Number(rawWidthPerLeaf) : 36;
    const height = Number.isFinite(rawHeight) && Number(rawHeight) > 0 ? Number(rawHeight) : 84;

    return {
      id: rawDoorSet?.id || `door-set-${index + 1}`,
      index,
      rowIndex: 0,
      doorType,
      widthPerLeaf,
      height,
      locationMode: getLocationModeForColumnIndex(columnIndex, columns),
      columnIndex,
      swing: index === 0 ? input.doorConfig.swing : rawDoorSet?.swing ?? input.doorConfig.swing,
      hingeType: index === 0 ? input.doorConfig.hingeType : rawDoorSet?.hingeType ?? input.doorConfig.hingeType,
      hardwareNoteIds: index === 0 ? input.doorConfig.hardwareNoteIds : rawDoorSet?.hardwareNoteIds ?? [],
      thresholdNoteId: index === 0 ? input.doorConfig.thresholdNoteId : rawDoorSet?.thresholdNoteId ?? input.doorConfig.thresholdNoteId,
      leafCount,
      clearWidth: roundToPrecision(widthPerLeaf * leafCount),
      requiredBayWidth: 0
    };
  });
}

function getRequiredDoorBayWidth(
  doorSet: DoorSetRuntime,
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number {
  return roundToPrecision(
    doorSet.clearWidth +
      getVerticalBoundaryInset(boundaryTypes[doorSet.columnIndex], storefrontRules) +
      getVerticalBoundaryInset(boundaryTypes[doorSet.columnIndex + 1], storefrontRules)
  );
}

function getFirstAvailableColumnIndex(usedColumns: Set<number>, columns: number): number | null {
  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    if (!usedColumns.has(columnIndex)) return columnIndex;
  }
  return null;
}

function getLocationModeForColumnIndex(columnIndex: number, columns: number): "center" | "left" | "right" | "custom" {
  if (columnIndex <= 0) return "left";
  if (columnIndex >= columns - 1) return "right";
  if (columnIndex === getDoorColumnIndex(columns, "center")) return "center";
  return "custom";
}

function resolveDoorColumnIndex(input: ElevationInput, columns: number): number {
  if (input.doorConfig.columnIndex !== null && Number.isFinite(input.doorConfig.columnIndex)) {
    return clampColumnIndex(input.doorConfig.columnIndex, columns);
  }
  return clampColumnIndex(getDoorColumnIndex(columns, input.doorConfig.locationMode), columns);
}

export function getDoorColumnIndex(columns: number, locationMode: "center" | "left" | "right" | "custom"): number {
  if (locationMode === "left") return 0;
  if (locationMode === "right") return Math.max(columns - 1, 0);
  return Math.floor(columns / 2);
}

export function getDoorPackageWidth(input: ElevationInput): number {
  if (!input.doorConfig.hasDoor || input.doorConfig.doorType === "none") return 0;
  if (input.doorConfig.doorSets?.length) {
    return Math.max(
      ...input.doorConfig.doorSets.map((doorSet) =>
        doorSet.widthPerLeaf * (doorSet.doorType === "pair" ? 2 : 1)
      )
    );
  }
  return input.doorConfig.widthPerLeaf * (input.doorConfig.doorType === "pair" ? 2 : 1);
}

function buildNoDoorVerticalBoundaryTypes(columns: number): VerticalBoundaryType[] {
  return Array.from({ length: columns + 1 }, (_, index) => {
    if (index === 0) return "edge-left";
    if (index === columns) return "edge-right";
    return "mullion";
  });
}

function buildNoDoorHorizontalBoundaryTypes(rows: number): HorizontalBoundaryType[] {
  return Array.from({ length: rows + 1 }, (_, index) => {
    if (index === 0) return "sill";
    if (index === rows) return "head";
    return "horizontal-mullion";
  });
}

function getCumulativePositions(widths: number[]): number[] {
  const positions: number[] = [];
  widths.reduce((current, width) => {
    positions.push(roundToPrecision(current));
    return current + width;
  }, 0);
  return positions;
}

function clampColumnIndex(value: number, columns: number): number {
  return Math.max(0, Math.min(columns - 1, Math.round(value)));
}

function resolveLiteAxisSizes(
  mode: ElevationInput["columnSizingMode"],
  providedSizes: number[],
  count: number,
  total: number,
  boundaryTypes: VerticalBoundaryType[] | HorizontalBoundaryType[],
  axis: "vertical" | "horizontal",
  storefrontRules: StorefrontRulePack
): number[] {
  if (mode !== "custom") {
    return fitEqualLiteGlassSizes(count, total, boundaryTypes, axis, storefrontRules);
  }

  return resolveAxisSizes(mode, providedSizes, count, total);
}

function resolveAxisSizes(
  mode: ElevationInput["columnSizingMode"],
  providedSizes: number[],
  count: number,
  total: number,
  minimumIndex?: number,
  minimumValue = 0
): number[] {
  if (count === 1) return [roundToPrecision(total)];

  if (mode !== "custom") {
    return fitSizesToTotal(Array.from({ length: count }, () => 1), total, minimumIndex, minimumValue);
  }

  const drivenSizes = resolveCustomDrivenSizes({
    providedSizes,
    count,
    total,
    fallbackDrivenIndex: 0,
    minimumIndex,
    minimumValue
  });
  if (drivenSizes) return drivenSizes;

  const baseSizes = Array.from({ length: count }, (_, index) => sanitizeSize(providedSizes[index]));
  return fitSizesToTotal(baseSizes, total, minimumIndex, minimumValue);
}

function resolveDoorBayWidths(
  mode: ElevationInput["columnSizingMode"],
  providedSizes: number[],
  count: number,
  total: number,
  doorColumnIndex: number,
  requiredDoorWidth: number,
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number[] {
  const baseSizes =
    mode === "custom"
      ? Array.from({ length: count }, (_, index) => sanitizeSize(providedSizes[index]))
      : Array.from({ length: count }, () => 1);

  if (count === 1) return [roundToPrecision(total)];

  if (mode === "equal") {
    return fitEqualDoorGlassWidths(count, total, doorColumnIndex, requiredDoorWidth, boundaryTypes, storefrontRules);
  }

  const lockedDoorWidth = roundToPrecision(Math.min(Math.max(requiredDoorWidth, 0), total));
  const fallbackDrivenIndex =
    Array.from({ length: count }, (_, index) => index).find((index) => index !== doorColumnIndex) ?? 0;
  const drivenSizes = resolveCustomDrivenSizes({
    providedSizes,
    count,
    total,
    exactSizes: new Map([[doorColumnIndex, lockedDoorWidth]]),
    fallbackDrivenIndex
  });
  if (drivenSizes) {
    return drivenSizes;
  }

  return fitSizesToExactIndex(baseSizes, total, doorColumnIndex, lockedDoorWidth);
}

function resolveMultiDoorBayWidths(
  mode: ElevationInput["columnSizingMode"],
  providedSizes: number[],
  count: number,
  total: number,
  doorSets: DoorSetRuntime[],
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number[] {
  if (doorSets.length === 1) {
    return resolveDoorBayWidths(
      mode,
      providedSizes,
      count,
      total,
      doorSets[0].columnIndex,
      doorSets[0].requiredBayWidth,
      boundaryTypes,
      storefrontRules
    );
  }

  const exactSizes = new Map<number, number>();
  doorSets.forEach((doorSet) => {
    exactSizes.set(
      doorSet.columnIndex,
      Math.max(exactSizes.get(doorSet.columnIndex) ?? 0, doorSet.requiredBayWidth)
    );
  });

  if (mode === "custom") {
    const fallbackDrivenIndex =
      Array.from({ length: count }, (_, index) => index).find((index) => !exactSizes.has(index)) ?? 0;
    const drivenSizes = resolveCustomDrivenSizes({
      providedSizes,
      count,
      total,
      exactSizes,
      fallbackDrivenIndex
    });
    if (drivenSizes) return drivenSizes;
  }

  return fitEqualMultiDoorGlassWidths(count, total, exactSizes, boundaryTypes, storefrontRules);
}

function resolveCustomDrivenSizes({
  providedSizes,
  count,
  total,
  exactSizes = new Map<number, number>(),
  fallbackDrivenIndex,
  minimumIndex,
  minimumValue = 0
}: {
  providedSizes: number[];
  count: number;
  total: number;
  exactSizes?: Map<number, number>;
  fallbackDrivenIndex?: number;
  minimumIndex?: number;
  minimumValue?: number;
}): number[] | null {
  const lockedIndexes = new Set(exactSizes.keys());
  const editableIndexes = Array.from({ length: count }, (_, index) => index).filter((index) => !lockedIndexes.has(index));
  const customSizes = Array.from({ length: count }, (_, index) => sanitizeCustomSize(providedSizes[index]));

  if (editableIndexes.length === 0) {
    const result = Array.from({ length: count }, (_, index) => roundToPrecision(exactSizes.get(index) ?? 0));
    return normalizeSizesToTotal(result, total, Math.max(count - 1, 0));
  }

  let manualIndexes = editableIndexes.filter((index) => customSizes[index] > 0);
  let drivenIndexes = editableIndexes.filter((index) => customSizes[index] <= 0);

  if (drivenIndexes.length === 0) {
    const drivenIndex =
      fallbackDrivenIndex !== undefined && editableIndexes.includes(fallbackDrivenIndex)
        ? fallbackDrivenIndex
        : editableIndexes[0];
    manualIndexes = manualIndexes.filter((index) => index !== drivenIndex);
    drivenIndexes = [drivenIndex];
  }

  const manualSizes = Array.from({ length: count }, () => 0);
  manualIndexes.forEach((index) => {
    manualSizes[index] = customSizes[index];
  });

  const exactTotal = Array.from(exactSizes.values()).reduce((sum, value) => sum + value, 0);
  const minimumIsEditable = minimumIndex !== undefined && editableIndexes.includes(minimumIndex);
  const minimumIsDriven = minimumIsEditable && minimumIndex !== undefined && drivenIndexes.includes(minimumIndex);
  const minimumIsManual = minimumIsEditable && minimumIndex !== undefined && manualIndexes.includes(minimumIndex);

  if (minimumIsManual && minimumIndex !== undefined && manualSizes[minimumIndex] < minimumValue) {
    manualSizes[minimumIndex] = minimumValue;
  }

  const reservedDrivenMinimum = minimumIsDriven ? minimumValue : 0;
  const scalableManualIndexes =
    minimumIsManual && minimumIndex !== undefined
      ? manualIndexes.filter((index) => index !== minimumIndex)
      : manualIndexes.slice();
  const lockedManualTotal = minimumIsManual && minimumIndex !== undefined ? manualSizes[minimumIndex] : 0;
  const scalableManualTotal = scalableManualIndexes.reduce((sum, index) => sum + manualSizes[index], 0);
  const scalableBudget = roundToPrecision(total - exactTotal - reservedDrivenMinimum - lockedManualTotal);

  if (scalableBudget < -0.0001) return null;

  if (scalableManualTotal > scalableBudget + 0.0001) {
    if (scalableManualIndexes.length === 0) return null;
    const scale = scalableBudget <= 0 ? 0 : scalableBudget / scalableManualTotal;
    scalableManualIndexes.forEach((index) => {
      manualSizes[index] = roundToPrecision(manualSizes[index] * scale);
    });
  }

  const result = Array.from({ length: count }, (_, index) =>
    roundToPrecision(exactSizes.get(index) ?? manualSizes[index] ?? 0)
  );
  const fixedTotal = roundToPrecision(result.reduce((sum, value) => sum + value, 0));
  let remaining = roundToPrecision(total - fixedTotal);

  if (remaining < -0.0001) return null;

  if (minimumIsDriven && minimumIndex !== undefined) {
    if (remaining < minimumValue - 0.0001) return null;
    result[minimumIndex] = roundToPrecision(minimumValue);
    remaining = roundToPrecision(remaining - minimumValue);
    const otherDrivenIndexes = drivenIndexes.filter((index) => index !== minimumIndex);

    if (otherDrivenIndexes.length === 0) {
      return normalizeSizesToTotal(result, total, minimumIndex);
    }

    const share = roundToPrecision(remaining / otherDrivenIndexes.length);
    otherDrivenIndexes.forEach((index) => {
      result[index] = share;
    });
    return normalizeSizesToTotal(result, total, otherDrivenIndexes[otherDrivenIndexes.length - 1]);
  }

  if (drivenIndexes.length === 0) {
    return normalizeSizesToTotal(result, total, editableIndexes[editableIndexes.length - 1]);
  }

  const share = roundToPrecision(remaining / drivenIndexes.length);
  drivenIndexes.forEach((index) => {
    result[index] = share;
  });
  return normalizeSizesToTotal(result, total, drivenIndexes[drivenIndexes.length - 1]);
}

function fitEqualDoorGlassWidths(
  count: number,
  total: number,
  doorColumnIndex: number,
  requiredDoorWidth: number,
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number[] {
  const doorWidth = roundToPrecision(Math.min(Math.max(requiredDoorWidth, 0), total));
  const oddIndex = getDoorOddColumnIndex(count, doorColumnIndex);
  const regularIndexes = Array.from({ length: count }, (_, index) => index).filter(
    (index) => index !== doorColumnIndex && index !== oddIndex
  );

  if (regularIndexes.length === 0) {
    return fitSizesToExactIndex(Array.from({ length: count }, () => 1), total, doorColumnIndex, doorWidth);
  }

  const equalWidth = roundToPrecision(total / count);
  const oddWidth = oddIndex === null ? 0 : roundToPrecision(equalWidth + (equalWidth - doorWidth));
  if (oddIndex !== null && oddWidth <= 0) {
    return fitSizesToExactIndex(Array.from({ length: count }, () => 1), total, doorColumnIndex, doorWidth);
  }

  const regularWidthTotal = roundToPrecision(total - doorWidth - oddWidth);
  const totalRegularDeduction = regularIndexes.reduce(
    (sum, index) => sum + getBayVerticalDeduction(index, boundaryTypes, storefrontRules),
    0
  );
  const targetDloWidth = roundToPrecision((regularWidthTotal - totalRegularDeduction) / regularIndexes.length);
  if (targetDloWidth <= 0) {
    return fitSizesToExactIndex(Array.from({ length: count }, () => 1), total, doorColumnIndex, doorWidth);
  }

  const result = Array.from({ length: count }, () => 0);
  result[doorColumnIndex] = doorWidth;
  if (oddIndex !== null) {
    result[oddIndex] = oddWidth;
  }

  regularIndexes.forEach((index) => {
    result[index] = roundToPrecision(targetDloWidth + getBayVerticalDeduction(index, boundaryTypes, storefrontRules));
  });

  return normalizeSizesToTotal(result, total, regularIndexes[regularIndexes.length - 1] ?? oddIndex ?? doorColumnIndex);
}

function fitEqualMultiDoorGlassWidths(
  count: number,
  total: number,
  exactSizes: Map<number, number>,
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number[] {
  const result = Array.from({ length: count }, () => 0);
  const exactTotal = Array.from(exactSizes.entries()).reduce((sum, [index, width]) => {
    const clampedWidth = roundToPrecision(Math.min(Math.max(width, 0), total));
    result[index] = clampedWidth;
    return sum + clampedWidth;
  }, 0);
  const remainingIndexes = Array.from({ length: count }, (_, index) => index).filter((index) => !exactSizes.has(index));

  if (remainingIndexes.length === 0) {
    return normalizeSizesToTotal(result, total, count - 1);
  }

  const remainingTotal = roundToPrecision(total - exactTotal);
  if (remainingTotal <= 0) {
    return normalizeSizesToTotal(result, total, remainingIndexes[remainingIndexes.length - 1]);
  }

  const remainingDeduction = remainingIndexes.reduce(
    (sum, index) => sum + getBayVerticalDeduction(index, boundaryTypes, storefrontRules),
    0
  );
  const targetDloWidth = roundToPrecision((remainingTotal - remainingDeduction) / remainingIndexes.length);

  if (targetDloWidth <= 0) {
    const share = roundToPrecision(remainingTotal / remainingIndexes.length);
    remainingIndexes.forEach((index) => {
      result[index] = share;
    });
    return normalizeSizesToTotal(result, total, remainingIndexes[remainingIndexes.length - 1]);
  }

  remainingIndexes.forEach((index) => {
    result[index] = roundToPrecision(targetDloWidth + getBayVerticalDeduction(index, boundaryTypes, storefrontRules));
  });

  return normalizeSizesToTotal(result, total, remainingIndexes[remainingIndexes.length - 1]);
}

function fitEqualLiteGlassSizes(
  count: number,
  total: number,
  boundaryTypes: VerticalBoundaryType[] | HorizontalBoundaryType[],
  axis: "vertical" | "horizontal",
  storefrontRules: StorefrontRulePack
): number[] {
  if (count === 1) return [roundToPrecision(total)];

  const offsets = Array.from({ length: count }, (_, index) =>
    axis === "vertical"
      ? getVerticalGlassSizeOffset(
          (boundaryTypes as VerticalBoundaryType[])[index],
          (boundaryTypes as VerticalBoundaryType[])[index + 1],
          storefrontRules
        )
      : getHorizontalGlassSizeOffset(
          (boundaryTypes as HorizontalBoundaryType[])[index],
          (boundaryTypes as HorizontalBoundaryType[])[index + 1],
          storefrontRules
        )
  );
  const targetGlassSize = roundToPrecision(
    (total - offsets.reduce((sum, offset) => sum + offset, 0)) / count
  );

  if (targetGlassSize <= 0) {
    return fitSizesToTotal(Array.from({ length: count }, () => 1), total);
  }

  const sizes = offsets.map((offset) => roundToPrecision(targetGlassSize + offset));
  if (sizes.some((size) => size <= 0)) {
    return fitSizesToTotal(Array.from({ length: count }, () => 1), total);
  }

  return normalizeSizesToTotal(sizes, total, count - 1);
}

function fitSizesToTotal(
  baseSizes: number[],
  total: number,
  minimumIndex?: number,
  minimumValue = 0
): number[] {
  const safeBase = baseSizes.map((size) => sanitizeSize(size));
  const scaled = scaleSizes(safeBase, total);
  if (minimumIndex === undefined) return scaled;

  const clampedMinimum = Math.min(Math.max(minimumValue, 0), total);
  if (scaled[minimumIndex] >= clampedMinimum) return scaled;

  const remainingTotal = roundToPrecision(Math.max(total - clampedMinimum, 0));
  const otherIndexes = scaled.map((_, index) => index).filter((index) => index !== minimumIndex);
  if (otherIndexes.length === 0) return [roundToPrecision(total)];

  const otherBaseSum = otherIndexes.reduce((sum, index) => sum + safeBase[index], 0);
  return safeBase.map((size, index) => {
    if (index === minimumIndex) return roundToPrecision(clampedMinimum);
    const share = otherBaseSum > 0 ? size / otherBaseSum : 1 / otherIndexes.length;
    return roundToPrecision(remainingTotal * share);
  });
}

function fitSizesToExactIndex(
  baseSizes: number[],
  total: number,
  exactIndex: number,
  exactValue: number
): number[] {
  const safeBase = baseSizes.map((size) => sanitizeSize(size));
  const clampedExact = roundToPrecision(Math.min(Math.max(exactValue, 0), total));
  const otherIndexes = safeBase.map((_, index) => index).filter((index) => index !== exactIndex);
  if (otherIndexes.length === 0) return [roundToPrecision(total)];

  const otherBaseSum = otherIndexes.reduce((sum, index) => sum + safeBase[index], 0);
  const remainingTotal = roundToPrecision(Math.max(total - clampedExact, 0));
  const result = safeBase.map((size, index) => {
    if (index === exactIndex) return clampedExact;
    const share = otherBaseSum > 0 ? size / otherBaseSum : 1 / otherIndexes.length;
    return roundToPrecision(remainingTotal * share);
  });

  return normalizeSizesToTotal(result, total, otherIndexes[otherIndexes.length - 1]);
}

function scaleSizes(baseSizes: number[], total: number): number[] {
  const sum = baseSizes.reduce((running, size) => running + size, 0);
  if (sum <= 0) return Array.from({ length: baseSizes.length }, () => roundToPrecision(total / baseSizes.length));
  return baseSizes.map((size) => roundToPrecision((size / sum) * total));
}

function getDoorOddColumnIndex(columns: number, doorColumnIndex: number): number | null {
  const leftCount = doorColumnIndex;
  const rightCount = columns - doorColumnIndex - 1;

  if (leftCount === rightCount) return null;
  if (leftCount === 0 || rightCount === 0) return null;
  return leftCount < rightCount ? 0 : columns - 1;
}

function getBayVerticalDeduction(
  columnIndex: number,
  boundaryTypes: VerticalBoundaryType[],
  storefrontRules: StorefrontRulePack
): number {
  return roundToPrecision(
    getVerticalBoundaryInset(boundaryTypes[columnIndex], storefrontRules) +
    getVerticalBoundaryInset(boundaryTypes[columnIndex + 1], storefrontRules)
  );
}

function getVerticalGlassSizeOffset(
  leftBoundaryType: VerticalBoundaryType,
  rightBoundaryType: VerticalBoundaryType,
  storefrontRules: StorefrontRulePack
): number {
  return roundToPrecision(
    getVerticalBoundaryInset(leftBoundaryType, storefrontRules) +
    getVerticalBoundaryInset(rightBoundaryType, storefrontRules) -
    getVerticalGlassBite(leftBoundaryType, storefrontRules) -
    getVerticalGlassBite(rightBoundaryType, storefrontRules)
  );
}

function getHorizontalGlassSizeOffset(
  bottomBoundaryType: HorizontalBoundaryType,
  topBoundaryType: HorizontalBoundaryType,
  storefrontRules: StorefrontRulePack
): number {
  return roundToPrecision(
    getHorizontalBoundaryInset(bottomBoundaryType, storefrontRules) +
    getHorizontalBoundaryInset(topBoundaryType, storefrontRules) -
    getHorizontalGlassBite(bottomBoundaryType, storefrontRules) -
    getHorizontalGlassBite(topBoundaryType, storefrontRules)
  );
}

function normalizeSizesToTotal(widths: number[], total: number, adjustmentIndex: number): number[] {
  const sum = widths.reduce((running, width) => running + width, 0);
  const delta = roundToPrecision(total - sum);
  if (Math.abs(delta) < 0.0001) return widths.map((width) => roundToPrecision(width));

  return widths.map((width, index) =>
    index === adjustmentIndex ? roundToPrecision(width + delta) : roundToPrecision(width)
  );
}

function sanitizeSize(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Number(value) : 1;
}

function sanitizeCustomSize(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Number(value) : 0;
}

function buildAxisDimensions(
  axis: "column" | "row",
  sizes: number[],
  orientation: "horizontal" | "vertical"
) {
  let cursor = 0;
  return sizes.map((size, index) => {
    const dimensionLine = dimension(
      `${axis}-${index + 1}`,
      `${axis === "column" ? "Column" : "Row"} ${index + 1}`,
      size,
      orientation,
      cursor,
      cursor + size,
      14 + index * 4
    );
    cursor = roundToPrecision(cursor + size);
    return dimensionLine;
  });
}

function dimension(
  id: string,
  label: string,
  value: number,
  orientation: "horizontal" | "vertical",
  from: number,
  to: number,
  offset: number
) {
  return {
    id,
    label,
    value: roundToSixteenth(value),
    orientation,
    from: roundToPrecision(from),
    to: roundToPrecision(to),
    offset
  };
}

function buildNotes(
  input: ElevationInput,
  storefrontRules: StorefrontRulePack,
  entranceRules: EntranceRulePack | undefined,
  noteLibrary: NoteLibrary
): string[] {
  const notes = [
    ...storefrontRules.notes,
    ...(entranceRules?.notes ?? []),
    noteLibrary.finish[input.finishConfig.finishId],
    noteLibrary.glass[input.glassConfig.glassTypeId],
    input.cornerConfig.hasCorner
      ? `Corner condition: ${input.cornerConfig.angle} degree ${input.cornerConfig.side} return with corner mullion sightline assumed at ${getCornerMullionSightline(storefrontRules)} in.`
      : undefined,
    input.doorConfig.swing ? noteLibrary.hardware[input.doorConfig.swing] : undefined,
    input.doorConfig.hingeType ? noteLibrary.hardware[input.doorConfig.hingeType] : undefined,
    ...input.doorConfig.hardwareNoteIds.map((id) => noteLibrary.hardware[id]),
    input.doorConfig.thresholdNoteId ? noteLibrary.threshold[input.doorConfig.thresholdNoteId] : undefined
  ];

  return Array.from(new Set(notes.filter((note): note is string => Boolean(note))));
}

function getCornerMullionSightline(storefrontRules: StorefrontRulePack): number {
  return storefrontRules.sightlines.cornerMullion ?? storefrontRules.nominalFaceWidth * 2;
}
