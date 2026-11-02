import { formatPipeSize, round, roundCurrency } from "./math";
import { evaluateRoughIn } from "./roughIn";
import { calculateSizing } from "./sizing";
import { validatePlumbingJob } from "./validation";
import type {
  FixtureScheduleLine,
  FixtureType,
  MaterialItem,
  MaterialTakeoffLine,
  PipeMaterial,
  PipeRun,
  PipeRunTotal,
  PipeSizeSpec,
  PlumbingConfig,
  PlumbingJob,
  PlumbingPhase,
  PlumbingTakeoff,
  TakeoffLineKind
} from "./types";

const PHASE_ORDER: PlumbingPhase[] = ["underground", "rough", "trim"];
const KIND_ORDER: TakeoffLineKind[] = ["fixture", "labor", "kit", "pipe", "fitting", "hanger", "insulation"];

/** Pure entry point: job input + rule packs -> complete takeoff. */
export function buildPlumbingTakeoff(job: PlumbingJob, config: PlumbingConfig): PlumbingTakeoff {
  const fixtures = new Map(config.fixtureLibrary.fixtures.map((fixture) => [fixture.id, fixture]));
  const materials = new Map(config.materialCatalog.materials.map((material) => [material.id, material]));
  const areaMultiplier = new Map(job.areas.map((area) => [area.id, normalizeMultiplier(area.multiplier)]));

  const fixtureSchedule = buildFixtureSchedule(job, fixtures);
  const lines = new LineAccumulator();

  addFixtureLines(lines, fixtureSchedule, fixtures, materials);
  const pipeTotals = addPipeLines(lines, job.runs, areaMultiplier, config, materials);

  const sizing = calculateSizing(fixtureSchedule, fixtures, job.runs, config.pipingRulePack);
  const roughIn = evaluateRoughIn(job, fixtures);
  const fixtureCount = fixtureSchedule.reduce((total, line) => total + line.totalQty, 0);
  const takeoffWithoutFlags = {
    fixtureSchedule,
    fixtureCount,
    materials: lines.toSortedLines(),
    pipeTotals,
    sizing,
    roughIn
  };

  return {
    ...takeoffWithoutFlags,
    flags: validatePlumbingJob(job, takeoffWithoutFlags, fixtures, config)
  };
}

export function buildFixtureSchedule(job: PlumbingJob, fixtures: Map<string, FixtureType>): FixtureScheduleLine[] {
  const isPublic = job.buildingType === "commercial";
  const schedule: FixtureScheduleLine[] = [];

  job.areas.forEach((area) => {
    const multiplier = normalizeMultiplier(area.multiplier);
    area.fixtures.forEach((line) => {
      const fixture = fixtures.get(line.fixtureTypeId);
      const qty = Math.max(0, Math.round(line.qty));
      if (!fixture || qty === 0) return;
      const dfuEach = isPublic ? fixture.publicUse?.dfu ?? fixture.dfu : fixture.dfu;
      const wsfuEach = isPublic ? fixture.publicUse?.wsfu ?? fixture.wsfu : fixture.wsfu;
      const totalQty = qty * multiplier;
      schedule.push({
        areaId: area.id,
        areaName: area.name,
        multiplier,
        fixtureTypeId: fixture.id,
        label: fixture.label,
        qtyPerArea: qty,
        totalQty,
        furnishedBy: line.furnishedBy,
        dfuEach,
        wsfuEach,
        totalDfu: round(dfuEach * totalQty, 2),
        totalWsfu: {
          cold: round(wsfuEach.cold * totalQty, 2),
          hot: round(wsfuEach.hot * totalQty, 2),
          total: round(wsfuEach.total * totalQty, 2)
        }
      });
    });
  });

  return schedule;
}

function addFixtureLines(
  lines: LineAccumulator,
  schedule: FixtureScheduleLine[],
  fixtures: Map<string, FixtureType>,
  materials: Map<string, MaterialItem>
) {
  schedule.forEach((line) => {
    const fixture = fixtures.get(line.fixtureTypeId);
    if (!fixture) return;
    const qty = line.totalQty;
    const byWorth = line.furnishedBy === "worth";

    lines.add({
      key: `trim|fixture|${fixture.id}|${line.furnishedBy}`,
      kind: "fixture",
      phase: "trim",
      group: "Fixtures & equipment",
      description: `${fixture.label}${byWorth ? "" : " (furnished by others)"}`,
      unit: "ea",
      qty,
      unitCost: byWorth ? fixture.fixtureAllowance : 0,
      laborHours: 0,
      orderNote: byWorth ? "" : "Install only"
    });

    lines.add({
      key: `rough|labor|${fixture.id}`,
      kind: "labor",
      phase: "rough",
      group: "Rough-in labor",
      description: `${fixture.label} - rough-in`,
      unit: "ea",
      qty,
      unitCost: 0,
      laborHours: fixture.roughLaborHours
    });

    lines.add({
      key: `trim|labor|${fixture.id}`,
      kind: "labor",
      phase: "trim",
      group: "Set & trim labor",
      description: `${fixture.label} - set & trim`,
      unit: "ea",
      qty,
      unitCost: 0,
      laborHours: fixture.trimLaborHours
    });

    (
      [
        ["rough", fixture.roughKit],
        ["trim", fixture.trimKit]
      ] as const
    ).forEach(([phase, kit]) => {
      kit.forEach((item) => {
        const material = materials.get(item.materialId);
        lines.add({
          key: `${phase}|kit|${item.materialId}`,
          kind: "kit",
          phase,
          group: phase === "rough" ? "Rough-in kits" : "Trim kits",
          description: material?.label ?? `Unknown material: ${item.materialId}`,
          unit: material?.unit ?? "ea",
          qty: item.qty * qty,
          unitCost: material?.unitCost ?? 0,
          laborHours: material?.laborHours ?? 0
        });
      });
    });
  });
}

function addPipeLines(
  lines: LineAccumulator,
  runs: PipeRun[],
  areaMultiplier: Map<string, number>,
  config: PlumbingConfig,
  materials: Map<string, MaterialItem>
): PipeRunTotal[] {
  const rules = config.pipingRulePack;
  const pipeMaterials = new Map(rules.pipeMaterials.map((material) => [material.id, material]));
  const systemRules = new Map(rules.systems.map((rule) => [rule.system, rule]));
  const totals = new Map<string, PipeRunTotal>();
  const pipeLengths = new Map<string, { phase: PlumbingPhase; material: PipeMaterial; spec: PipeSizeSpec | undefined; size: number; lengthFt: number }>();

  runs.forEach((run) => {
    const pipeMaterial = pipeMaterials.get(run.pipeMaterialId);
    if (!pipeMaterial || !(run.lengthFt > 0)) return;
    const multiplier = run.areaId ? areaMultiplier.get(run.areaId) ?? 1 : 1;
    const lengthFt = run.lengthFt * multiplier;
    const spec = pipeMaterial.sizes.find((candidate) => candidate.size === run.size);
    const phase: PlumbingPhase = run.location === "underground" ? "underground" : "rough";
    const systemRule = systemRules.get(run.system);
    const fittings = getRunFittingCount(run, systemRule?.fittingsPer100Ft ?? 0) * multiplier;
    const hangers = run.location === "underground" ? 0 : getRunHangerCount(run, pipeMaterial) * multiplier;
    const sizeLabel = formatPipeSize(run.size);

    const lengthKey = `${phase}|${pipeMaterial.id}|${run.size}`;
    const existingLength = pipeLengths.get(lengthKey);
    pipeLengths.set(lengthKey, {
      phase,
      material: pipeMaterial,
      spec,
      size: run.size,
      lengthFt: (existingLength?.lengthFt ?? 0) + lengthFt
    });

    if (fittings > 0) {
      lines.add({
        key: `${phase}|fitting|${pipeMaterial.id}|${run.size}`,
        kind: "fitting",
        phase,
        group: "Fittings",
        description: `${pipeMaterial.label} ${sizeLabel} fittings (avg)`,
        unit: "ea",
        qty: fittings,
        unitCost: spec?.fittingCost ?? 0,
        laborHours: spec?.laborHoursPerFitting ?? 0
      });
    }

    if (hangers > 0) {
      const hanger = materials.get(pipeMaterial.hangerMaterialId);
      lines.add({
        key: `${phase}|hanger|${pipeMaterial.hangerMaterialId}`,
        kind: "hanger",
        phase,
        group: "Hangers & supports",
        description: hanger?.label ?? pipeMaterial.hangerMaterialId,
        unit: hanger?.unit ?? "ea",
        qty: hangers,
        unitCost: hanger?.unitCost ?? 0,
        laborHours: hanger?.laborHours ?? 0
      });
    }

    const insulationId = systemRule?.insulationMaterialId;
    if (run.insulated && insulationId) {
      const insulation = materials.get(insulationId);
      lines.add({
        key: `${phase}|insulation|${insulationId}|${run.size}`,
        kind: "insulation",
        phase,
        group: "Insulation",
        description: `${insulation?.label ?? insulationId} for ${sizeLabel} pipe`,
        unit: insulation?.unit ?? "lf",
        qty: lengthFt,
        unitCost: insulation?.unitCost ?? 0,
        laborHours: insulation?.laborHours ?? 0
      });
    }

    const totalKey = `${run.system}|${pipeMaterial.id}|${run.size}|${run.location}`;
    const total = totals.get(totalKey);
    totals.set(totalKey, {
      key: totalKey,
      system: run.system,
      systemLabel: systemRule?.label ?? run.system,
      pipeMaterialId: pipeMaterial.id,
      materialLabel: pipeMaterial.label,
      size: run.size,
      location: run.location,
      lengthFt: round((total?.lengthFt ?? 0) + lengthFt, 2),
      fittings: (total?.fittings ?? 0) + fittings,
      hangers: (total?.hangers ?? 0) + hangers
    });
  });

  pipeLengths.forEach(({ phase, material, spec, size, lengthFt }) => {
    const withWaste = lengthFt * (1 + rules.wastePercent / 100);
    const sticks = Math.ceil(round(withWaste / material.stickLengthFt, 4));
    const orderQty = sticks * material.stickLengthFt;
    const stickWord = material.stickLengthFt >= 50 ? (sticks === 1 ? "coil" : "coils") : sticks === 1 ? "stick" : "sticks";
    lines.add({
      key: `${phase}|pipe|${material.id}|${size}`,
      kind: "pipe",
      phase,
      group: "Pipe",
      description: `${material.label} ${formatPipeSize(size)} pipe`,
      unit: "lf",
      qty: lengthFt,
      unitCost: spec?.costPerFoot ?? 0,
      laborHours: spec?.laborHoursPerFoot ?? 0,
      orderQty,
      orderNote: `${sticks} x ${material.stickLengthFt}' ${stickWord} (incl. ${rules.wastePercent}% waste)`
    });
  });

  return [...totals.values()].sort(
    (a, b) => a.system.localeCompare(b.system) || a.materialLabel.localeCompare(b.materialLabel) || b.size - a.size
  );
}

export function getRunFittingCount(run: PipeRun, fittingsPer100Ft: number): number {
  if (run.fittingCount !== null && run.fittingCount !== undefined) return Math.max(0, Math.round(run.fittingCount));
  if (!(run.lengthFt > 0)) return 0;
  return Math.ceil(round((run.lengthFt * fittingsPer100Ft) / 100, 4));
}

export function getRunHangerCount(run: PipeRun, material: PipeMaterial): number {
  if (!(run.lengthFt > 0)) return 0;
  const useLarge = material.largeHangerSpacingFt && material.largeSizeFrom !== undefined && run.size >= material.largeSizeFrom;
  const spacing = useLarge ? material.largeHangerSpacingFt! : material.hangerSpacingFt;
  return Math.ceil(round(run.lengthFt / spacing, 4));
}

export function normalizeMultiplier(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

type LineInput = Omit<MaterialTakeoffLine, "materialCost" | "orderQty" | "orderNote"> & {
  orderQty?: number;
  orderNote?: string;
};

class LineAccumulator {
  private lines = new Map<string, LineInput>();

  add(input: LineInput) {
    const existing = this.lines.get(input.key);
    if (!existing) {
      this.lines.set(input.key, { ...input });
      return;
    }
    existing.qty += input.qty;
    if (input.orderQty !== undefined) existing.orderQty = (existing.orderQty ?? 0) + input.orderQty;
  }

  toSortedLines(): MaterialTakeoffLine[] {
    return [...this.lines.values()]
      .map((line) => {
        const qty = round(line.qty, 2);
        const orderQty = round(line.orderQty ?? line.qty, 2);
        return {
          ...line,
          qty,
          orderQty,
          orderNote: line.orderNote ?? "",
          // Pipe is bought by the stick, so it is costed on the order quantity; labor stays on installed length.
          materialCost: roundCurrency(orderQty * line.unitCost),
          laborHours: round(qty * line.laborHours, 2)
        };
      })
      .sort(
        (a, b) =>
          PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) ||
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          a.description.localeCompare(b.description)
      );
  }
}
