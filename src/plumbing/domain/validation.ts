import { formatInchesFraction, formatPipeSize } from "./math";
import { isBeyondDemandTable } from "./sizing";
import type { FixtureType, PlumbingConfig, PlumbingFlag, PlumbingJob, PlumbingTakeoff } from "./types";

/**
 * Advisory checks. Nothing here blocks output; errors mean the takeoff cannot be priced as entered.
 */
export function validatePlumbingJob(
  job: PlumbingJob,
  takeoff: Omit<PlumbingTakeoff, "flags">,
  fixtures: Map<string, FixtureType>,
  config: PlumbingConfig
): PlumbingFlag[] {
  const flags: PlumbingFlag[] = [];
  const add = (flag: Omit<PlumbingFlag, "id">) => flags.push({ id: `${flag.code}-${flags.length}`, ...flag });
  const rules = config.pipingRulePack;
  const pipeMaterials = new Map(rules.pipeMaterials.map((material) => [material.id, material]));
  const systemLabels = new Map(rules.systems.map((rule) => [rule.system, rule.label]));
  const activeRuns = job.runs.filter((run) => run.lengthFt > 0);
  const scheduleTypes = takeoff.fixtureSchedule.map((line) => fixtures.get(line.fixtureTypeId)).filter(Boolean) as FixtureType[];
  const { sizing } = takeoff;

  if (takeoff.fixtureCount === 0) {
    add({
      code: "NO_FIXTURES",
      severity: "info",
      message: "No fixtures entered yet.",
      recommendation: "Add areas and fixture counts to build rough-in kits and fixture-unit totals."
    });
  }

  activeRuns.forEach((run) => {
    const material = pipeMaterials.get(run.pipeMaterialId);
    const label = run.label || `${systemLabels.get(run.system) ?? run.system} run`;
    if (!material) {
      add({
        code: "PIPE_MATERIAL_UNKNOWN",
        severity: "error",
        message: `${label}: pipe material "${run.pipeMaterialId}" is not in the piping rule pack.`,
        recommendation: "Pick a pipe material from the list or add it to the piping rule pack."
      });
      return;
    }
    if (!material.allowedSystems.includes(run.system)) {
      add({
        code: "PIPE_MATERIAL_SYSTEM",
        severity: "error",
        message: `${label}: ${material.label} is not set up for ${systemLabels.get(run.system) ?? run.system}.`,
        recommendation: "Change the material or system. Allowed systems are set per material in the piping rule pack."
      });
    }
    if (!material.sizes.some((spec) => spec.size === run.size)) {
      add({
        code: "PIPE_SIZE_UNPRICED",
        severity: "warning",
        message: `${label}: ${formatPipeSize(run.size)} ${material.label} has no unit cost, so it is priced at $0.`,
        recommendation: "Add the size to the piping rule pack or pick a listed size."
      });
    }
  });

  if (sizing.totalDfu > 0 && !activeRuns.some((run) => run.system === "sanitary")) {
    add({
      code: "NO_SANITARY_PIPING",
      severity: "warning",
      message: "Fixtures drain to sanitary, but no sanitary piping is entered.",
      recommendation: "Add underground and above-ground waste runs, or the quote only covers rough-in kits and labor."
    });
  }

  if (sizing.totalDfu > 0 && !activeRuns.some((run) => run.system === "vent")) {
    add({
      code: "NO_VENT_PIPING",
      severity: "info",
      message: "No vent piping entered.",
      recommendation: "Add vent runs or confirm venting is by AAV or existing."
    });
  }

  if (sizing.totalWsfu.total > 0 && !activeRuns.some((run) => run.system === "cold")) {
    add({
      code: "NO_WATER_PIPING",
      severity: "warning",
      message: "Fixtures need water, but no domestic cold water piping is entered.",
      recommendation: "Add cold water mains and branches."
    });
  }

  if (sizing.totalWsfu.hot > 0 && !activeRuns.some((run) => run.system === "hot")) {
    add({
      code: "NO_HOT_PIPING",
      severity: "warning",
      message: "Fixtures need hot water, but no domestic hot water piping is entered.",
      recommendation: "Add hot water mains and branches."
    });
  }

  if (sizing.hotWaterFixtureCount > 0 && !scheduleTypes.some((fixture) => fixture.providesHotWater)) {
    add({
      code: "NO_HOT_WATER_SOURCE",
      severity: "info",
      message: "Hot water fixtures are entered, but no water heater is in the takeoff.",
      recommendation: "Add a water heater, or note that hot water is existing or by others."
    });
  }

  if (scheduleTypes.some((fixture) => fixture.needsGas) && !activeRuns.some((run) => run.system === "gas")) {
    add({
      code: "NO_GAS_PIPING",
      severity: "warning",
      message: "A gas appliance is entered, but no fuel gas piping is entered.",
      recommendation: "Add gas piping from the meter or existing manifold, or note gas by others."
    });
  }

  if (
    sizing.minBuildingDrainSize !== null &&
    sizing.largestSanitaryEntered !== null &&
    sizing.largestSanitaryEntered < sizing.minBuildingDrainSize
  ) {
    add({
      code: "BUILDING_DRAIN_UNDERSIZED",
      severity: "warning",
      message: `Largest sanitary pipe entered is ${formatPipeSize(sizing.largestSanitaryEntered)}, but ${sizing.totalDfu} DFU${
        sizing.waterClosetCount > 0 ? " with water closets" : ""
      } needs at least ${formatPipeSize(sizing.minBuildingDrainSize)} at 1/4" per foot.`,
      recommendation: "Check the building drain size against the plans and the adopted code."
    });
  }

  if (isBeyondDemandTable(sizing.totalWsfu.total, rules.demand)) {
    add({
      code: "DEMAND_BEYOND_TABLE",
      severity: "info",
      message: `${sizing.totalWsfu.total} WSFU is past the end of the demand table, so peak GPM is capped.`,
      recommendation: "Have the engineer of record size the water service."
    });
  }

  const uninsulatedHot = activeRuns.filter((run) => (run.system === "hot" || run.system === "hot-return") && !run.insulated);
  if (uninsulatedHot.length > 0) {
    add({
      code: "HOT_PIPING_NOT_INSULATED",
      severity: "info",
      message: `${uninsulatedHot.length} hot water run${uninsulatedHot.length === 1 ? " is" : "s are"} not insulated.`,
      recommendation: "The energy code usually requires hot water pipe insulation. Confirm the scope."
    });
  }

  if (job.buildingType === "commercial" && takeoff.fixtureCount > 0 && !scheduleTypes.some((fixture) => fixture.id === "mop-sink")) {
    add({
      code: "COMMERCIAL_SERVICE_SINK",
      severity: "info",
      message: "Commercial job has no service sink.",
      recommendation: "Most commercial occupancies need a service sink. Confirm with the plans."
    });
  }

  takeoff.roughIn
    .filter((result) => result.status === "out-of-range")
    .forEach((result) => {
      add({
        code: "ROUGH_IN_OUT_OF_RANGE",
        severity: "warning",
        message: `${result.areaName} ${result.fixtureLabel}: ${result.dimensionLabel} measured ${formatInchesFraction(
          result.measured ?? 0
        )}, expected ${formatInchesFraction(result.min)} to ${formatInchesFraction(result.max)}.`,
        recommendation: "Confirm against the fixture cut sheet before setting the fixture. Re-rough if it does not fit."
      });
    });

  const unmeasured = takeoff.roughIn.filter((result) => result.status === "not-measured").length;
  if (unmeasured > 0) {
    add({
      code: "ROUGH_IN_UNMEASURED",
      severity: "info",
      message: `${unmeasured} rough-in dimension${unmeasured === 1 ? " is" : "s are"} not measured yet.`,
      recommendation: "Field verify the stub-outs before trim."
    });
  }

  return flags;
}
