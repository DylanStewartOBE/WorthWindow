import { round, roundCurrency } from "./math";
import type { PhaseCost, PlumbingJob, PlumbingPhase, PlumbingPricingRulePack, PlumbingQuote, PlumbingTakeoff } from "./types";

const PHASES: PlumbingPhase[] = ["underground", "rough", "trim"];

export function calculatePlumbingQuote(
  job: PlumbingJob,
  takeoff: PlumbingTakeoff,
  pricing: PlumbingPricingRulePack
): PlumbingQuote {
  const laborRate = pricing.laborRatePerHour;
  const phases: PhaseCost[] = PHASES.map((phase) => {
    const lines = takeoff.materials.filter((line) => line.phase === phase);
    const materialCost = roundCurrency(
      lines.filter((line) => line.kind !== "fixture").reduce((total, line) => total + line.materialCost, 0)
    );
    const laborHours = round(lines.reduce((total, line) => total + line.laborHours, 0), 2);
    return { phase, materialCost, laborHours, laborCost: roundCurrency(laborHours * laborRate) };
  });

  const materialCost = roundCurrency(phases.reduce((total, phase) => total + phase.materialCost, 0));
  const fixtureCost = roundCurrency(
    takeoff.materials.filter((line) => line.kind === "fixture").reduce((total, line) => total + line.materialCost, 0)
  );
  const materialTax = roundCurrency((materialCost + fixtureCost) * (pricing.materialTaxPercent / 100));
  const testAndInspectHours = round(takeoff.fixtureCount * pricing.testAndInspectHoursPerFixture, 2);
  const mobilizationHours = takeoff.fixtureCount > 0 || job.runs.length > 0 ? pricing.mobilizationHours : 0;
  const laborHours = round(
    phases.reduce((total, phase) => total + phase.laborHours, 0) + testAndInspectHours + mobilizationHours,
    2
  );
  const laborCost = roundCurrency(laborHours * laborRate);
  const allowances = job.allowances.filter((allowance) => allowance.amount !== 0);
  const allowanceTotal = roundCurrency(allowances.reduce((total, allowance) => total + allowance.amount, 0));
  const permitFee = takeoff.fixtureCount > 0 || job.runs.length > 0 ? pricing.permitFee : 0;
  const directCost = roundCurrency(materialCost + fixtureCost + materialTax + laborCost + allowanceTotal + permitFee);
  const overhead = roundCurrency(directCost * (pricing.overheadPercent / 100));
  const margin = roundCurrency((directCost + overhead) * (pricing.marginPercent / 100));

  return {
    pricingName: pricing.name,
    pricingVersion: pricing.version,
    pricingEffectiveDate: pricing.effectiveDate,
    phases,
    materialCost,
    fixtureCost,
    materialTax,
    laborHours,
    laborRate,
    laborCost,
    testAndInspectHours,
    mobilizationHours,
    allowances,
    allowanceTotal,
    permitFee,
    directCost,
    overheadPercent: pricing.overheadPercent,
    overhead,
    marginPercent: pricing.marginPercent,
    margin,
    total: roundCurrency(directCost + overhead + margin),
    assumptions: pricing.assumptions,
    exclusions: pricing.exclusions
  };
}
