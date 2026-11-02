import { round } from "../domain/math";
import type {
  CutListLine,
  FittingItem,
  FittingType,
  FurnishedBy,
  PipeRun,
  PipeSystem,
  PlanPoint,
  PlanRun,
  PlanRunResult,
  PlanSheet,
  PlumbingConfig,
  PlumbingJob,
  TrenchCalc
} from "../domain/types";

/** Snapped points coincide exactly; this only absorbs floating-point noise (PDF points). */
const CONNECT_TOLERANCE_PT = 0.75;

const BEND_FITTING: Record<string, FittingType> = {
  "90": "elbow90",
  "45": "elbow45",
  "22.5": "elbow22",
  "11.25": "elbow11"
};

/** Systems that tie into each other; a vent can branch off a sanitary line, hot return off hot. */
const CONNECTION_GROUP: Record<PipeSystem, string> = {
  sanitary: "drain",
  vent: "drain",
  storm: "storm",
  condensate: "condensate",
  cold: "cold",
  hot: "hot",
  "hot-return": "hot",
  gas: "gas"
};

export interface PlanFixtureLine {
  areaId: string;
  fixtureTypeId: string;
  furnishedBy: FurnishedBy;
  qty: number;
}

export interface PlanAnalysis {
  results: PlanRunResult[];
  derivedRuns: PipeRun[];
  fixtureLines: PlanFixtureLine[];
}

export function analyzePlans(job: PlumbingJob, config: PlumbingConfig): PlanAnalysis {
  const plans = job.plans;
  const sheets = new Map(plans.sheets.map((sheet) => [sheet.id, sheet]));
  const rules = config.pipingRulePack;
  const materials = new Map(rules.pipeMaterials.map((material) => [material.id, material]));
  const results: PlanRunResult[] = [];
  const derivedRuns: PipeRun[] = [];

  plans.runs.forEach((run, index) => {
    const sheet = sheets.get(run.sheetId);
    if (!sheet || run.points.length < 2) return;
    const label = run.label || `${sheet.sheetNumber || `Page ${sheet.pageNumber}`} ${run.system} run`;

    if (!sheet.scale) {
      results.push({
        runId: run.id,
        sheetId: sheet.id,
        label,
        horizontalFt: 0,
        verticalFt: 0,
        totalFt: 0,
        bends: [],
        fittingItems: [],
        fixtureConnections: 0,
        trench: null,
        measured: false
      });
      return;
    }

    const material = materials.get(run.pipeMaterialId);
    const stockFt = material?.stickLengthFt ?? 20;
    const sameSheetRuns = plans.runs.map((other, otherIndex) => ({ other, otherIndex })).filter(({ other }) => other.sheetId === run.sheetId);
    const markers = plans.markers.filter((marker) => marker.sheetId === run.sheetId);
    const fittings = new FittingTally();
    const feetPerPoint = sheet.scale.feetPerPoint;

    const segments = run.points.slice(1).map((point, i) => distance(run.points[i], point) * feetPerPoint);
    const horizontalFt = segments.reduce((total, length) => total + length, 0);

    // Bends at interior vertices
    const bends = run.points.slice(1, -1).map((point, i) => {
      const angle = deflectionDeg(run.points[i], point, run.points[i + 2]);
      const decomposition = decomposeBend(angle, rules.plan.bendAngles, rules.plan.bendToleranceDeg);
      decomposition.fittings.forEach((type) => fittings.add(type, run.size));
      return { angleDeg: round(angle, 1), ...decomposition };
    });

    // Trench and depth. Runs are drawn from the downstream end (sewer, main) outward, so the pipe
    // is shallowest at the last point and falls toward the first point.
    const trench = run.location === "underground" && run.trench !== "none" ? calculateTrench(run, horizontalFt, config) : null;
    const shallowDepth = run.location === "underground" ? run.startDepthFt ?? rules.plan.defaultDepthFt[run.system] ?? 1.5 : 0;
    const deepDepth =
      run.location === "underground" ? shallowDepth + ((run.slopeInPerFt ?? rules.plan.defaultSlopeInPerFt[run.system] ?? 0) * horizontalFt) / 12 : 0;

    // Endpoint connections
    const verticalPieces: number[] = [];
    let fixtureConnections = 0;
    const endpoints = [
      { point: run.points[0], next: run.points[1], depth: deepDepth },
      { point: run.points[run.points.length - 1], next: run.points[run.points.length - 2], depth: shallowDepth }
    ];

    endpoints.forEach(({ point, next, depth }) => {
      if (markers.some((marker) => distance(marker, point) <= CONNECT_TOLERANCE_PT)) {
        fixtureConnections += 1;
        fittings.add("riser90", run.size);
        const rise = (rules.plan.fixtureRiseFt[run.system] ?? 0) + (run.location === "underground" ? depth : 0);
        if (rise > 0) verticalPieces.push(rise);
        return;
      }

      const outward = unit(subtract(next, point));
      for (const { other, otherIndex } of sameSheetRuns) {
        if (other.id === run.id || CONNECTION_GROUP[other.system] !== CONNECTION_GROUP[run.system]) continue;
        const last = other.points.length - 1;

        // End to end: continuation. Counted once, by the later run.
        const otherEnd = [0, last].find((i) => distance(other.points[i], point) <= CONNECT_TOLERANCE_PT);
        if (otherEnd !== undefined) {
          if (index < otherIndex) return;
          const otherOutward = unit(subtract(other.points[otherEnd === 0 ? 1 : last - 1], point));
          const turn = 180 - angleBetween(outward, otherOutward);
          const size = Math.max(run.size, other.size);
          if (turn > rules.plan.bendToleranceDeg) {
            decomposeBend(turn, rules.plan.bendAngles, rules.plan.bendToleranceDeg).fittings.forEach((type) => fittings.add(type, size));
          }
          if (run.size !== other.size) fittings.add("reducer", size, Math.min(run.size, other.size));
          else if (turn <= rules.plan.bendToleranceDeg) fittings.add("coupling", size);
          return;
        }

        // End onto the middle of another run: branch fitting on the main, counted by the branch.
        const hit = findSegmentHit(other.points, point);
        if (hit) {
          const branchAngle = angleBetween(outward, hit.direction);
          const acute = Math.min(branchAngle, 180 - branchAngle);
          fittings.add(branchFitting(run.system, material?.family ?? "pressure", acute), other.size, run.size);
          return;
        }
      }
    });

    if (run.extraVerticalFt > 0) verticalPieces.push(run.extraVerticalFt);

    // Splices where a straight is longer than one stick or coil
    [...segments, ...verticalPieces].forEach((length) => {
      const joints = Math.max(0, Math.ceil(round(length / stockFt, 6)) - 1);
      if (joints > 0) fittings.add("coupling", run.size, undefined, joints);
    });

    const verticalFt = verticalPieces.reduce((total, length) => total + length, 0);
    const totalFt = horizontalFt + verticalFt;
    const fittingItems = fittings.items();

    results.push({
      runId: run.id,
      sheetId: sheet.id,
      label,
      horizontalFt: round(horizontalFt, 2),
      verticalFt: round(verticalFt, 2),
      totalFt: round(totalFt, 2),
      bends: bends.map(({ angleDeg, fittings: bendFittings, offAngle }) => ({ angleDeg, fittings: bendFittings, offAngle })),
      fittingItems,
      fixtureConnections,
      trench,
      measured: true
    });

    derivedRuns.push({
      id: `plan-${run.id}`,
      areaId: run.areaId,
      label,
      system: run.system,
      pipeMaterialId: run.pipeMaterialId,
      size: run.size,
      lengthFt: round(totalFt, 2),
      location: run.location,
      fittingCount: null,
      insulated: run.system === "hot" || run.system === "hot-return",
      fittingItems,
      pieces: [...segments, ...verticalPieces].map((length) => round(length, 3)),
      trenchCalc: trench,
      source: "plan"
    });
  });

  const fixtureTally = new Map<string, PlanFixtureLine>();
  plans.markers.forEach((marker) => {
    const key = `${marker.areaId}|${marker.fixtureTypeId}|${marker.furnishedBy}`;
    const existing = fixtureTally.get(key);
    if (existing) existing.qty += 1;
    else fixtureTally.set(key, { areaId: marker.areaId, fixtureTypeId: marker.fixtureTypeId, furnishedBy: marker.furnishedBy, qty: 1 });
  });

  return { results, derivedRuns, fixtureLines: [...fixtureTally.values()] };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function distance(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function subtract(a: PlanPoint, b: PlanPoint): PlanPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v: PlanPoint): PlanPoint {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

/** Angle between two direction vectors, 0-180 degrees. */
export function angleBetween(a: PlanPoint, b: PlanPoint): number {
  const ua = unit(a);
  const ub = unit(b);
  const dot = Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** How far the path turns at `b`: 0 = straight through, 90 = square corner. */
export function deflectionDeg(a: PlanPoint, b: PlanPoint, c: PlanPoint): number {
  return angleBetween(subtract(b, a), subtract(c, b));
}

/**
 * Builds a turn from standard bends, largest first (67.5 = 45 + 22.5).
 * `offAngle` means the drawn angle cannot be made from standard bends within tolerance.
 */
export function decomposeBend(angleDeg: number, angles: number[], toleranceDeg: number): { fittings: FittingType[]; offAngle: boolean } {
  if (angleDeg <= toleranceDeg) return { fittings: [], offAngle: false };
  const sorted = [...angles].sort((a, b) => b - a);
  const exact = sorted.find((angle) => Math.abs(angle - angleDeg) <= toleranceDeg);
  if (exact !== undefined) return { fittings: [BEND_FITTING[String(exact)] ?? "elbow90"], offAngle: false };

  const fittings: FittingType[] = [];
  let remaining = angleDeg;
  for (const angle of sorted) {
    while (remaining >= angle - toleranceDeg / 2 && fittings.length < 8) {
      fittings.push(BEND_FITTING[String(angle)] ?? "elbow90");
      remaining -= angle;
    }
  }
  return { fittings, offAngle: Math.abs(remaining) > toleranceDeg };
}

function findSegmentHit(points: PlanPoint[], point: PlanPoint): { direction: PlanPoint } | null {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const ab = subtract(b, a);
    const lengthSq = ab.x * ab.x + ab.y * ab.y;
    if (lengthSq === 0) continue;
    const t = ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const projection = { x: a.x + ab.x * t, y: a.y + ab.y * t };
    if (distance(projection, point) > CONNECT_TOLERANCE_PT) continue;
    const atStart = distance(a, point) <= CONNECT_TOLERANCE_PT;
    const atEnd = distance(b, point) <= CONNECT_TOLERANCE_PT;
    // Run endpoints are handled as continuations; interior vertices and mid-segment points are branches.
    if ((atStart && i === 0) || (atEnd && i === points.length - 2)) continue;
    return { direction: ab };
  }
  return null;
}

function branchFitting(system: PipeSystem, family: "dwv" | "pressure", acuteAngle: number): FittingType {
  if (family === "pressure" || system === "vent") return "tee";
  return Math.abs(acuteAngle - 45) <= 15 ? "wye" : "combo";
}

class FittingTally {
  private tally = new Map<string, FittingItem>();

  add(type: FittingType, size: number, branchSize?: number, qty = 1) {
    const key = `${type}|${size}|${branchSize ?? ""}`;
    const existing = this.tally.get(key);
    if (existing) existing.qty += qty;
    else this.tally.set(key, { type, size, ...(branchSize !== undefined && branchSize !== size ? { branchSize } : {}), qty });
  }

  items(): FittingItem[] {
    return [...this.tally.values()];
  }
}

// ---------------------------------------------------------------------------
// Trench
// ---------------------------------------------------------------------------

/** Approximate outside diameter in inches for trench width and bedding. */
export function approximateOutsideDiameterIn(nominal: number): number {
  return nominal * 1.1 + 0.4;
}

export function calculateTrench(run: Pick<PlanRun, "system" | "size" | "startDepthFt" | "slopeInPerFt" | "trench">, lengthFt: number, config: PlumbingConfig): TrenchCalc {
  const rules = config.pipingRulePack;
  const ex = rules.excavation;
  // startDepthFt is the high (shallow) end; endDepthFt is the low end after the fall.
  const startDepthFt = run.startDepthFt ?? rules.plan.defaultDepthFt[run.system] ?? 1.5;
  const slope = run.slopeInPerFt ?? rules.plan.defaultSlopeInPerFt[run.system] ?? 0;
  const endDepthFt = startDepthFt + (slope * lengthFt) / 12;
  const averageDepthFt = (startDepthFt + endDepthFt) / 2;
  const od = approximateOutsideDiameterIn(run.size);
  const widthFt = Math.max(ex.minTrenchWidthIn, od + ex.sideClearanceIn * 2) / 12;
  const excavationCy = run.trench === "own" ? (lengthFt * widthFt * (averageDepthFt + ex.beddingBelowIn / 12)) / 27 : 0;
  const beddingCy = (lengthFt * widthFt * ((ex.beddingBelowIn + od) / 12)) / 27;
  const backfillCy = Math.max(0, excavationCy - beddingCy);

  return {
    lengthFt: round(lengthFt, 2),
    widthFt: round(widthFt, 2),
    startDepthFt: round(startDepthFt, 2),
    endDepthFt: round(endDepthFt, 2),
    averageDepthFt: round(averageDepthFt, 2),
    excavationCy: round(excavationCy, 2),
    beddingCy: round(beddingCy, 2),
    backfillCy: round(backfillCy, 2)
  };
}

// ---------------------------------------------------------------------------
// Stock lengths
// ---------------------------------------------------------------------------

/**
 * First-fit-decreasing cut list. Pieces longer than a stick use full sticks plus a remainder
 * (joined with couplings counted elsewhere).
 */
export function packStock(pieces: number[], stockFt: number): { sticks: number; bins: number[][]; offcutFt: number } {
  const remainders: number[] = [];
  let fullSticks = 0;
  pieces.forEach((piece) => {
    if (!(piece > 0)) return;
    const whole = Math.floor(round(piece / stockFt, 6));
    const rest = round(piece - whole * stockFt, 4);
    fullSticks += whole;
    if (rest > 0.01) remainders.push(rest);
  });

  const bins: number[][] = [];
  const free: number[] = [];
  remainders
    .sort((a, b) => b - a)
    .forEach((piece) => {
      const index = free.findIndex((space) => space >= piece - 1e-6);
      if (index >= 0) {
        bins[index].push(piece);
        free[index] = round(free[index] - piece, 4);
      } else {
        bins.push([piece]);
        free.push(round(stockFt - piece, 4));
      }
    });

  return { sticks: fullSticks + bins.length, bins, offcutFt: round(free.reduce((total, space) => total + space, 0), 2) };
}

export function buildCutListLine(
  key: string,
  pipeMaterialId: string,
  materialLabel: string,
  size: number,
  stockLengthFt: number,
  pieces: number[]
): CutListLine {
  const packed = packStock(pieces, stockLengthFt);
  const usedFt = round(pieces.reduce((total, piece) => total + piece, 0), 2);
  return {
    key,
    pipeMaterialId,
    materialLabel,
    size,
    stockLengthFt,
    pieces: pieces.map((piece) => round(piece, 2)).sort((a, b) => b - a),
    sticks: packed.sticks,
    usedFt,
    offcutFt: packed.offcutFt
  };
}

export function sheetLabel(sheet: Pick<PlanSheet, "sheetNumber" | "title" | "pageNumber">): string {
  return [sheet.sheetNumber || `Page ${sheet.pageNumber}`, sheet.title].filter(Boolean).join(" - ");
}
