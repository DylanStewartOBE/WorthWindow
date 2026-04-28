import { calculateElevation, type CalculationContext } from "../domain/calculate";
import type { Elevation, ElevationInput, Job } from "../domain/types";

export const seedJob: Job = {
  id: "job-worth-demo",
  name: "Worth Construction Demo Storefront",
  number: "WC-2000",
  customer: "Dylan Stewart",
  createdBy: "Dylan Stewart",
  dateCreated: "2026-04-21",
  logoId: "worth-construction-default",
  activeRevision: "A",
  activeElevationId: "elev-pair-door",
  status: "active",
  elevationIds: ["elev-pair-door", "elev-no-door"]
};

export const pairDoorSeedInput: ElevationInput = {
  id: "elev-pair-door",
  jobId: seedJob.id,
  name: "Pair doors with sidelites",
  measurementSet: {
    widthBottom: 179.75,
    widthCenter: 179.75,
    widthTop: 179.75,
    heightLeft: 107.875,
    heightCenter: 107.875,
    heightRight: 107.875
  },
  projectType: "replacement",
  rows: 2,
  columns: 3,
  rowSizingMode: "equal",
  columnSizingMode: "equal",
  rowHeights: [0, 0],
  columnWidths: [0, 0, 0],
  doorConfig: {
    hasDoor: true,
    doorType: "pair",
    widthPerLeaf: 36,
    height: 84,
    locationMode: "center",
    columnIndex: 1,
    rowPlacement: "above",
    swing: "outswing",
    hingeType: "continuous-gear",
    hardwareNoteIds: ["rim-panic", "closer", "pull-push"],
    thresholdNoteId: "standard-threshold",
    doorSetCount: 1,
    doorSets: [
      {
        id: "door-set-1",
        rowIndex: 0,
        doorType: "pair",
        widthPerLeaf: 36,
        height: 84,
        locationMode: "center",
        columnIndex: 1,
        swing: "outswing",
        hingeType: "continuous-gear",
        hardwareNoteIds: ["rim-panic", "closer", "pull-push"],
        thresholdNoteId: "standard-threshold"
      }
    ]
  },
  cornerConfig: {
    hasCorner: false,
    side: "right",
    angle: 90
  },
  finishConfig: {
    finishId: "bronze-anodized",
    finishLabel: "Bronze anodized"
  },
  glassConfig: {
    glassTypeId: "quarter-tempered",
    glassTypeLabel: "1/4 in clear tempered"
  },
  systemRulePackId: "fg2000-baseline",
  assemblyType: "shear-block"
};

export const noDoorSeedInput: ElevationInput = {
  id: "elev-no-door",
  jobId: seedJob.id,
  name: "Four lite no-door elevation",
  measurementSet: {
    widthBottom: 143.875,
    widthCenter: 143.875,
    widthTop: 143.875,
    heightLeft: 95.875,
    heightCenter: 95.875,
    heightRight: 95.875
  },
  projectType: "new",
  rows: 2,
  columns: 2,
  rowSizingMode: "equal",
  columnSizingMode: "equal",
  rowHeights: [0, 0],
  columnWidths: [0, 0],
  doorConfig: {
    hasDoor: false,
    doorType: "none",
    widthPerLeaf: 36,
    height: 84,
    locationMode: "center",
    columnIndex: null,
    rowPlacement: "above",
    swing: "outswing",
    hingeType: "butt",
    hardwareNoteIds: [],
    thresholdNoteId: "field-verify",
    doorSetCount: 0,
    doorSets: []
  },
  cornerConfig: {
    hasCorner: false,
    side: "right",
    angle: 90
  },
  finishConfig: {
    finishId: "clear-anodized",
    finishLabel: "Clear anodized"
  },
  glassConfig: {
    glassTypeId: "quarter-clear",
    glassTypeLabel: "1/4 in clear glass"
  },
  systemRulePackId: "fg2000-baseline",
  assemblyType: "screw-spline"
};

export function buildSeedElevations(context: CalculationContext): Elevation[] {
  return [pairDoorSeedInput, noDoorSeedInput].map((input) => calculateElevation(input, context));
}

export function createBlankElevationInput(jobId: string, createdBy: string): ElevationInput {
  return {
    id: `elev-${crypto.randomUUID?.() ?? Date.now()}`,
    jobId,
    name: "Field elevation",
    measurementSet: {
      widthBottom: 144,
      widthCenter: 144,
      widthTop: 144,
      heightLeft: 96,
      heightCenter: 96,
      heightRight: 96
    },
    projectType: "replacement",
    rows: 2,
    columns: 3,
    rowSizingMode: "equal",
    columnSizingMode: "equal",
    rowHeights: [0, 0],
    columnWidths: [0, 0, 0],
    doorConfig: {
      hasDoor: true,
      doorType: "single",
      widthPerLeaf: 36,
      height: 84,
      locationMode: "center",
      columnIndex: 1,
      rowPlacement: "above",
      swing: "outswing",
      hingeType: "butt",
      hardwareNoteIds: ["closer", "pull-push"],
      thresholdNoteId: "standard-threshold",
      doorSetCount: 1,
      doorSets: [
        {
          id: "door-set-1",
          rowIndex: 0,
          doorType: "single",
          widthPerLeaf: 36,
          height: 84,
          locationMode: "center",
          columnIndex: 1,
          swing: "outswing",
          hingeType: "butt",
          hardwareNoteIds: ["closer", "pull-push"],
          thresholdNoteId: "standard-threshold"
        }
      ]
    },
    cornerConfig: {
      hasCorner: false,
      side: "right",
      angle: 90
    },
    finishConfig: {
      finishId: "clear-anodized",
      finishLabel: "Clear anodized"
    },
    glassConfig: {
      glassTypeId: "quarter-clear",
      glassTypeLabel: "1/4 in clear glass"
    },
    systemRulePackId: "fg2000-baseline",
    assemblyType: "shear-block"
  };
}

export function createBlankJob(createdBy: string): Job {
  return {
    id: `job-${crypto.randomUUID?.() ?? Date.now()}`,
    name: "New field measure",
    number: "",
    customer: "",
    createdBy,
    dateCreated: new Date().toISOString().slice(0, 10),
    logoId: "worth-construction-default",
    activeRevision: "",
    activeElevationId: undefined,
    status: "active",
    elevationIds: [],
  };
}
