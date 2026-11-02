import { round } from "./math";
import type { DemandRow, FixtureScheduleLine, FixtureType, PipeRun, PipingRulePack, SizingSummary } from "./types";

export function calculateSizing(
  schedule: FixtureScheduleLine[],
  fixtures: Map<string, FixtureType>,
  runs: PipeRun[],
  rules: PipingRulePack
): SizingSummary {
  const totalDfu = round(schedule.reduce((total, line) => total + line.totalDfu, 0), 2);
  const totalWsfu = {
    cold: round(schedule.reduce((total, line) => total + line.totalWsfu.cold, 0), 2),
    hot: round(schedule.reduce((total, line) => total + line.totalWsfu.hot, 0), 2),
    total: round(schedule.reduce((total, line) => total + line.totalWsfu.total, 0), 2)
  };
  const hasFlushValves = schedule.some((line) => fixtures.get(line.fixtureTypeId)?.flushValve);
  const waterClosetCount = schedule
    .filter((line) => line.fixtureTypeId.startsWith("wc-"))
    .reduce((total, line) => total + line.totalQty, 0);
  const hotWaterFixtureCount = schedule
    .filter((line) => fixtures.get(line.fixtureTypeId)?.needsHotWater)
    .reduce((total, line) => total + line.totalQty, 0);
  const sanitarySizes = runs.filter((run) => run.system === "sanitary" && run.lengthFt > 0).map((run) => run.size);

  return {
    totalDfu,
    totalWsfu,
    hasFlushValves,
    estimatedPeakGpm: estimatePeakDemandGpm(totalWsfu.total, hasFlushValves, rules.demand),
    minBuildingDrainSize: getMinBuildingDrainSize(totalDfu, waterClosetCount, rules),
    largestSanitaryEntered: sanitarySizes.length ? Math.max(...sanitarySizes) : null,
    waterClosetCount,
    hotWaterFixtureCount
  };
}

/**
 * Smallest building drain that carries the DFU load at 1/4" per foot.
 * Any water closet forces at least a 3" drain.
 */
export function getMinBuildingDrainSize(totalDfu: number, waterClosetCount: number, rules: PipingRulePack): number | null {
  if (totalDfu <= 0) return null;
  const rows = [...rules.buildingDrainAtQuarterInch].sort((a, b) => a.size - b.size);
  const row = rows.find((candidate) => candidate.maxDfu >= totalDfu);
  const bySize = row ? row.size : rows[rows.length - 1]?.size ?? null;
  if (bySize === null) return null;
  return waterClosetCount > 0 ? Math.max(bySize, 3) : bySize;
}

/** Linear interpolation on the Hunter's curve table. Flush-valve systems use the flush-valve column. */
export function estimatePeakDemandGpm(totalWsfu: number, flushValve: boolean, demand: DemandRow[]): number {
  if (totalWsfu <= 0) return 0;
  const points = demand
    .map((row) => ({ wsfu: row.wsfu, gpm: flushValve ? row.gpmFlushValve : row.gpmFlushTank }))
    .filter((point) => point.gpm > 0)
    .sort((a, b) => a.wsfu - b.wsfu);
  if (points.length === 0) return 0;
  if (totalWsfu <= points[0].wsfu) return points[0].gpm;

  for (let index = 1; index < points.length; index += 1) {
    const upper = points[index];
    if (totalWsfu <= upper.wsfu) {
      const lower = points[index - 1];
      const ratio = (totalWsfu - lower.wsfu) / (upper.wsfu - lower.wsfu);
      return round(lower.gpm + ratio * (upper.gpm - lower.gpm), 1);
    }
  }
  return points[points.length - 1].gpm;
}

export function isBeyondDemandTable(totalWsfu: number, demand: DemandRow[]): boolean {
  const max = demand.reduce((value, row) => Math.max(value, row.wsfu), 0);
  return totalWsfu > max;
}
