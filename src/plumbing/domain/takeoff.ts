import { analyzePlans, buildCutListLine, type PlanFixtureLine } from "../plan/analyze";
import { formatPipeSize, round, roundCurrency } from "./math";
import { evaluateRoughIn } from "./roughIn";
import { calculateSizing } from "./sizing";
import { validatePlumbingJob } from "./validation";
import type {
  CutListLine,
  FittingTypeRule,
  FixtureScheduleLine,
  FixtureType,
  FurnishedBy,
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
const KIND_ORDER: TakeoffLineKind[] = [
  "fixture",
  "labor",
  "excavation",
  "site-material",
  "kit",
  "pipe",
  "fitting",
  "hanger",
  "insulation"
];

/** Pure entry point: job input + rule packs -> complete takeoff. */
export function buildPlumbingTakeoff(job: PlumbingJob, config: PlumbingConfig): PlumbingTakeoff {
  const fixtures = new Map(config.fixtureLibrary.fixtures.map((fixture) => [fixture.id, fixture]));
  const materials = new Map(config.materialCatalog.materials.map((material) => [material.id, material]));
  const areaMultiplier = new Map(job.areas.map((area) => [area.id, normalizeMultiplier(area.multiplier)]));

  const plan = analyzePlans(job, config);
  const allRuns = [...job.runs, ...plan.derivedRuns];
  const fixtureSchedule = buildFixtureSchedule(job, fixtures, plan.fixtureLines);
  const lines = new LineAccumulator();

  addFixtureLines(lines, fixtureSchedule, fixtures, materials);
  const { totals: pipeTotals, cutList } = addPipeLines(lines, allRuns, areaMultiplier, config, materials);
  addExcavationLines(lines, allRuns, areaMultiplier, config);

  const sizing = calculateSizing(fixtureSchedule, fixtures, allRuns, config.pipingRulePack);
  const roughIn = evaluateRoughIn(job, fixtures);
  const fixtureCount = fixtureSchedule.reduce((total, line) => total + line.totalQty, 0);
  const takeoffWithoutFlags = {
    fixtureSchedule,
    planRuns: plan.results,
    cutList,
    fixtureCount,
    materials: lines.toSortedLines(),
    pipeTotals,
    sizing,
    roughIn
  };

  return {
    ...takeoffWithoutFlags,
    flags: validatePlumbingJob(job, takeoffWithoutFlags, fixtures, config, allRuns)
  };
}

export function buildFixtureSchedule(
  job: PlumbingJob,
  fixtures: Map<string, FixtureType>,
  planLines: PlanFixtureLine[] = []
): FixtureScheduleLine[] {
  const isPublic = job.buildingType === "commercial";
  const schedule: FixtureScheduleLine[] = [];
  const areas = new Map(job.areas.map((area) => [area.id, area]));

  const push = (
    areaId: string,
    fixtureTypeId: string,
    rawQty: number,
    furnishedBy: FurnishedBy,
    source: FixtureScheduleLine["source"]
  ) => {
    const fixture = fixtures.get(fixtureTypeId);
    const qty = Math.max(0, Math.round(rawQty));
    if (!fixture || qty === 0) return;
    const area = areas.get(areaId);
    const multiplier = normalizeMultiplier(area?.multiplier);
    const dfuEach = isPublic ? fixture.publicUse?.dfu ?? fixture.dfu : fixture.dfu;
    const wsfuEach = isPublic ? fixture.publicUse?.wsfu ?? fixture.wsfu : fixture.wsfu;
    const totalQty = qty * multiplier;
    schedule.push({
      areaId,
      areaName: area?.name ?? "Building-wide",
      multiplier,
      fixtureTypeId: fixture.id,
      label: fixture.label,
      qtyPerArea: qty,
      totalQty,
      furnishedBy,
      source,
      dfuEach,
      wsfuEach,
      totalDfu: round(dfuEach * totalQty, 2),
      totalWsfu: {
        cold: round(wsfuEach.cold * totalQty, 2),
        hot: round(wsfuEach.hot * totalQty, 2),
        total: round(wsfuEach.total * totalQty, 2)
      }
    });
  };

  job.areas.forEach((area) => area.fixtures.forEach((line) => push(area.id, line.fixtureTypeId, line.qty, line.furnishedBy, "manual")));
  planLines.forEach((line) => push(line.areaId, line.fixtureTypeId, line.qty, line.furnishedBy, "plan"));
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
      orderNote: byWorth ? "" : "Install only",
      brandKey: `fixture:${fixture.id}`
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
          laborHours: material?.laborHours ?? 0,
          brandKey: `material:${item.materialId}`
        });
      });
    });
  });
}

type PipeAccumulator = {
  phase: PlumbingPhase;
  material: PipeMaterial;
  spec: PipeSizeSpec | undefined;
  size: number;
  lengthFt: number;
  pieces: number[];
};

function addPipeLines(
  lines: LineAccumulator,
  runs: PipeRun[],
  areaMultiplier: Map<string, number>,
  config: PlumbingConfig,
  materials: Map<string, MaterialItem>
): { totals: PipeRunTotal[]; cutList: CutListLine[] } {
  const rules = config.pipingRulePack;
  const pipeMaterials = new Map(rules.pipeMaterials.map((material) => [material.id, material]));
  const systemRules = new Map(rules.systems.map((rule) => [rule.system, rule]));
  const fittingRules = new Map<string, FittingTypeRule>((rules.fittingTypes ?? []).map((rule) => [rule.type, rule]));
  const totals = new Map<string, PipeRunTotal>();
  const pipeLengths = new Map<string, PipeAccumulator>();

  runs.forEach((run) => {
    const pipeMaterial = pipeMaterials.get(run.pipeMaterialId);
    if (!pipeMaterial || !(run.lengthFt > 0)) return;
    const multiplier = run.areaId ? areaMultiplier.get(run.areaId) ?? 1 : 1;
    const lengthFt = run.lengthFt * multiplier;
    const spec = pipeMaterial.sizes.find((candidate) => candidate.size === run.size);
    const phase: PlumbingPhase = run.location === "underground" ? "underground" : "rough";
    const systemRule = systemRules.get(run.system);
    const hangers = run.location === "underground" ? 0 : getRunHangerCount(run, pipeMaterial) * multiplier;
    const sizeLabel = formatPipeSize(run.size);
    let fittingCount = 0;

    const lengthKey = `${phase}|${pipeMaterial.id}|${run.size}`;
    const accumulator = pipeLengths.get(lengthKey) ?? { phase, material: pipeMaterial, spec, size: run.size, lengthFt: 0, pieces: [] };
    accumulator.lengthFt += lengthFt;
    const runPieces = run.pieces?.length ? run.pieces : [run.lengthFt];
    for (let copy = 0; copy < multiplier; copy += 1) accumulator.pieces.push(...runPieces);
    pipeLengths.set(lengthKey, accumulator);

    if (run.fittingItems) {
      run.fittingItems.forEach((item) => {
        const rule = fittingRules.get(item.type);
        const itemSpec = pipeMaterial.sizes.find((candidate) => candidate.size === item.size);
        const name = rule ? (pipeMaterial.family === "dwv" ? rule.dwvLabel : rule.pressureLabel) : item.type;
        const itemSize = item.branchSize !== undefined ? `${formatPipeSize(item.size)} x ${formatPipeSize(item.branchSize)}` : formatPipeSize(item.size);
        const qty = item.qty * multiplier;
        fittingCount += qty;
        lines.add({
          key: `${phase}|fitting|${pipeMaterial.id}|${item.type}|${item.size}|${item.branchSize ?? ""}`,
          kind: "fitting",
          phase,
          group: "Fittings",
          description: `${pipeMaterial.label} ${itemSize} ${name}`,
          unit: "ea",
          qty,
          unitCost: (itemSpec?.fittingCost ?? 0) * (rule?.costFactor ?? 1),
          laborHours: (itemSpec?.laborHoursPerFitting ?? 0) * (rule?.laborFactor ?? 1),
          brandKey: `fitting:${pipeMaterial.id}`,
          sizeLabel: itemSize
        });
      });
    } else {
      fittingCount = getRunFittingCount(run, systemRule?.fittingsPer100Ft ?? 0) * multiplier;
      if (fittingCount > 0) {
        lines.add({
          key: `${phase}|fitting|${pipeMaterial.id}|avg|${run.size}`,
          kind: "fitting",
          phase,
          group: "Fittings",
          description: `${pipeMaterial.label} ${sizeLabel} fittings (avg mix)`,
          unit: "ea",
          qty: fittingCount,
          unitCost: spec?.fittingCost ?? 0,
          laborHours: spec?.laborHoursPerFitting ?? 0,
          brandKey: `fitting:${pipeMaterial.id}`,
          sizeLabel
        });
      }
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
        laborHours: hanger?.laborHours ?? 0,
        brandKey: `material:${pipeMaterial.hangerMaterialId}`
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
        laborHours: insulation?.laborHours ?? 0,
        brandKey: `material:${insulationId}`,
        sizeLabel
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
      fittings: (total?.fittings ?? 0) + fittingCount,
      hangers: (total?.hangers ?? 0) + hangers
    });
  });

  const cutList: CutListLine[] = [];
  pipeLengths.forEach(({ phase, material, spec, size, lengthFt, pieces }, key) => {
    const cut = buildCutListLine(key, material.id, material.label, size, material.stickLengthFt, pieces);
    const wasteSticks = Math.ceil(round((lengthFt * (1 + rules.wastePercent / 100)) / material.stickLengthFt, 4));
    const sticks = Math.max(cut.sticks, wasteSticks);
    cutList.push({ ...cut, sticks });
    const orderQty = sticks * material.stickLengthFt;
    const stockWord = material.stickLengthFt >= 50 ? (sticks === 1 ? "coil" : "coils") : sticks === 1 ? "stick" : "sticks";
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
      orderNote: `${sticks} x ${material.stickLengthFt}' ${stockWord} (cut list, min ${rules.wastePercent}% waste)`,
      brandKey: `pipe:${material.id}`,
      sizeLabel: formatPipeSize(size)
    });
  });

  return {
    totals: [...totals.values()].sort(
      (a, b) => a.system.localeCompare(b.system) || a.materialLabel.localeCompare(b.materialLabel) || b.size - a.size
    ),
    cutList: cutList.sort((a, b) => a.materialLabel.localeCompare(b.materialLabel) || b.size - a.size)
  };
}

function addExcavationLines(lines: LineAccumulator, runs: PipeRun[], areaMultiplier: Map<string, number>, config: PlumbingConfig) {
  const ex = config.pipingRulePack.excavation;
  if (!ex) return;
  let excavationCy = 0;
  let beddingCy = 0;
  let backfillCy = 0;
  let tapeFt = 0;
  let tracerFt = 0;

  runs.forEach((run) => {
    const trench = run.trenchCalc;
    if (!trench) return;
    const multiplier = run.areaId ? areaMultiplier.get(run.areaId) ?? 1 : 1;
    excavationCy += trench.excavationCy * multiplier;
    beddingCy += trench.beddingCy * multiplier;
    backfillCy += trench.backfillCy * multiplier;
    if (ex.warningTapeSystems.includes(run.system)) tapeFt += trench.lengthFt * multiplier;
    if (ex.tracerWireSystems.includes(run.system) && ex.nonMetallicMaterialIds.includes(run.pipeMaterialId)) {
      tracerFt += trench.lengthFt * multiplier;
    }
  });

  const group = "Excavation & bedding";
  if (excavationCy > 0) {
    const hours = excavationCy / ex.excavateCyPerHour;
    lines.add({
      key: "underground|excavation|dig",
      kind: "excavation",
      phase: "underground",
      group,
      description: "Trench excavation",
      unit: "cy",
      qty: excavationCy,
      unitCost: 0,
      laborHours: 1 / ex.excavateCyPerHour
    });
    lines.add({
      key: "underground|excavation|equipment",
      kind: "excavation",
      phase: "underground",
      group,
      description: `${ex.equipmentLabel} (with operator time above)`,
      unit: "hr",
      qty: hours,
      unitCost: ex.equipmentRatePerHour,
      laborHours: 0
    });
  }
  if (backfillCy > 0) {
    lines.add({
      key: "underground|excavation|backfill",
      kind: "excavation",
      phase: "underground",
      group,
      description: "Backfill & compaction",
      unit: "cy",
      qty: backfillCy,
      unitCost: 0,
      laborHours: 1 / ex.backfillCyPerHour
    });
  }
  if (beddingCy > 0) {
    lines.add({
      key: "underground|site-material|bedding",
      kind: "site-material",
      phase: "underground",
      group,
      description: ex.beddingLabel,
      unit: "cy",
      qty: beddingCy,
      unitCost: ex.beddingCostPerCy,
      laborHours: 0
    });
  }
  if (tapeFt > 0) {
    lines.add({
      key: "underground|site-material|tape",
      kind: "site-material",
      phase: "underground",
      group,
      description: "Detectable warning tape",
      unit: "lf",
      qty: tapeFt,
      unitCost: ex.warningTapeCostPerFt,
      laborHours: 0
    });
  }
  if (tracerFt > 0) {
    lines.add({
      key: "underground|site-material|tracer",
      kind: "site-material",
      phase: "underground",
      group,
      description: "Tracer wire for non-metallic pipe",
      unit: "lf",
      qty: tracerFt,
      unitCost: ex.tracerWireCostPerFt,
      laborHours: 0
    });
  }
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
        // Bulk site materials are ordered in whole units.
        const orderQty = round(line.orderQty ?? (line.kind === "site-material" ? Math.ceil(line.qty) : line.qty), 2);
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
