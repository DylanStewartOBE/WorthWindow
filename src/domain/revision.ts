import type { Elevation, Revision } from "./types";

export function getNextRevisionNumber(revisions: Pick<Revision, "number">[]): string {
  const latestIndex = revisions.reduce((max, revision) => {
    const index = revisionNumberToIndex(revision.number);
    return index === null ? max : Math.max(max, index);
  }, -1);

  return revisionIndexToNumber(latestIndex + 1);
}

export function revisionIndexToNumber(index: number): string {
  let value = Math.max(0, Math.floor(index)) + 1;
  let label = "";

  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }

  return label;
}

export function revisionNumberToIndex(number: string): number | null {
  const label = number.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(label)) return null;

  let value = 0;
  for (const character of label) {
    value = value * 26 + (character.charCodeAt(0) - 64);
  }

  return value - 1;
}

export function createRevisionSnapshot(elevation: Elevation, number: string): Revision {
  const timestamp = new Date().toISOString();

  return {
    id: `rev-${elevation.id}-${number}-${Date.now()}`,
    elevationId: elevation.id,
    number,
    timestamp,
    snapshot: {
      input: {
        id: elevation.id,
        jobId: elevation.jobId,
        name: elevation.name,
        measurementSet: structuredClone(elevation.measurementSet),
        projectType: elevation.projectType,
        rows: elevation.rows,
        columns: elevation.columns,
        rowSizingMode: elevation.rowSizingMode,
        columnSizingMode: elevation.columnSizingMode,
        rowHeights: structuredClone(elevation.rowHeights),
        columnWidths: structuredClone(elevation.columnWidths),
        doorConfig: structuredClone(elevation.doorConfig),
        cornerConfig: structuredClone(elevation.cornerConfig),
        finishConfig: structuredClone(elevation.finishConfig),
        glassConfig: structuredClone(elevation.glassConfig),
        systemRulePackId: elevation.systemRulePackId,
        assemblyType: elevation.assemblyType
      },
      governingWidth: elevation.governingWidth,
      governingHeight: elevation.governingHeight,
      computedGeometry: structuredClone(elevation.computedGeometry),
      computedGlass: structuredClone(elevation.computedGlass),
      validationFlags: structuredClone(elevation.validationFlags)
    },
    pdfArtifactIds: elevation.pdfArtifacts.map((artifact) => artifact.id)
  };
}
