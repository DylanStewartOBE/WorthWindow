import type { Elevation, Revision } from "./types";

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
