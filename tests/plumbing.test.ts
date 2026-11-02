import { describe, expect, it } from "vitest";
import { defaultPlumbingConfig } from "../src/plumbing/config";
import { createRun, createSamplePlumbingJob, createBlankPlumbingJob } from "../src/plumbing/domain/jobs";
import { formatInchesFraction, formatPipeSize, parseFeet, parseInches } from "../src/plumbing/domain/math";
import { calculatePlumbingQuote } from "../src/plumbing/domain/quote";
import { checkMeasurement, getMissingRoughInChecks } from "../src/plumbing/domain/roughIn";
import { estimatePeakDemandGpm, getMinBuildingDrainSize } from "../src/plumbing/domain/sizing";
import { buildPlumbingTakeoff, getRunFittingCount, getRunHangerCount } from "../src/plumbing/domain/takeoff";
import type { PlumbingJob } from "../src/plumbing/domain/types";

const config = defaultPlumbingConfig;
const fixtures = new Map(config.fixtureLibrary.fixtures.map((fixture) => [fixture.id, fixture]));

function jobWith(partial: Partial<PlumbingJob>): PlumbingJob {
  return { ...createBlankPlumbingJob(), areas: [], ...partial };
}

describe("plumbing rule packs", () => {
  it("references only materials that exist in the catalog", () => {
    const materialIds = new Set(config.materialCatalog.materials.map((material) => material.id));
    const kitIds = config.fixtureLibrary.fixtures.flatMap((fixture) => [...fixture.roughKit, ...fixture.trimKit].map((item) => item.materialId));
    const hangerIds = config.pipingRulePack.pipeMaterials.map((material) => material.hangerMaterialId);
    const insulationIds = config.pipingRulePack.systems.flatMap((rule) => (rule.insulationMaterialId ? [rule.insulationMaterialId] : []));
    [...kitIds, ...hangerIds, ...insulationIds].forEach((id) => expect(materialIds.has(id), id).toBe(true));
  });

  it("keeps rough-in specs ordered min <= target <= max", () => {
    config.fixtureLibrary.fixtures.forEach((fixture) =>
      fixture.roughIn.forEach((spec) => {
        expect(spec.min, `${fixture.id}.${spec.id}`).toBeLessThanOrEqual(spec.target);
        expect(spec.target, `${fixture.id}.${spec.id}`).toBeLessThanOrEqual(spec.max);
      })
    );
  });
});

describe("fixture schedule and fixture units", () => {
  it("multiplies typical areas and totals DFU / WSFU", () => {
    const takeoff = buildPlumbingTakeoff(createSamplePlumbingJob(), config);
    const wc = takeoff.fixtureSchedule.find((line) => line.fixtureTypeId === "wc-tank")!;
    expect(wc.totalQty).toBe(4);
    expect(wc.totalDfu).toBe(12);
    expect(wc.totalWsfu.cold).toBeCloseTo(8.8);

    // 4 x (WC 3 + LAV 1 + TUB 2 + KS 2 + DW 2 + CW 2) = 48 DFU, hose bibbs add 0
    expect(takeoff.sizing.totalDfu).toBe(48);
    expect(takeoff.fixtureCount).toBe(4 * 8 + 2);
  });

  it("uses public-use fixture units on commercial jobs", () => {
    const area = { id: "a", name: "Restroom", level: "", multiplier: 1, fixtures: [{ id: "l", fixtureTypeId: "wc-tank", qty: 2, furnishedBy: "worth" as const, note: "" }] };
    const residential = buildPlumbingTakeoff(jobWith({ areas: [area] }), config);
    const commercial = buildPlumbingTakeoff(jobWith({ areas: [area], buildingType: "commercial" }), config);
    expect(residential.sizing.totalDfu).toBe(6);
    expect(commercial.sizing.totalDfu).toBe(8);
    expect(commercial.sizing.totalWsfu.total).toBe(10);
  });
});

describe("sizing", () => {
  it("picks the smallest building drain for the DFU load and forces 3 in. with water closets", () => {
    expect(getMinBuildingDrainSize(20, 0, config.pipingRulePack)).toBe(2);
    expect(getMinBuildingDrainSize(20, 1, config.pipingRulePack)).toBe(3);
    expect(getMinBuildingDrainSize(43, 1, config.pipingRulePack)).toBe(4);
    expect(getMinBuildingDrainSize(0, 0, config.pipingRulePack)).toBeNull();
  });

  it("interpolates peak demand on the Hunter's curve table", () => {
    expect(estimatePeakDemandGpm(10, false, config.pipingRulePack.demand)).toBe(14.6);
    expect(estimatePeakDemandGpm(11, false, config.pipingRulePack.demand)).toBe(15.3);
    expect(estimatePeakDemandGpm(2, true, config.pipingRulePack.demand)).toBe(15);
    expect(estimatePeakDemandGpm(0, true, config.pipingRulePack.demand)).toBe(0);
  });
});

describe("pipe takeoff", () => {
  const pvc = config.pipingRulePack.pipeMaterials.find((material) => material.id === "pvc-dwv")!;
  const copper = config.pipingRulePack.pipeMaterials.find((material) => material.id === "copper-l")!;

  it("estimates fittings from the system rule unless counted", () => {
    expect(getRunFittingCount(createRun("sanitary", { lengthFt: 50 }), 18)).toBe(9);
    expect(getRunFittingCount(createRun("sanitary", { lengthFt: 50, fittingCount: 3 }), 18)).toBe(3);
  });

  it("spaces hangers by material and size", () => {
    expect(getRunHangerCount(createRun("vent", { lengthFt: 40 }), pvc)).toBe(10);
    expect(getRunHangerCount(createRun("cold", { lengthFt: 60, size: 1 }), copper)).toBe(10);
    expect(getRunHangerCount(createRun("cold", { lengthFt: 60, size: 2 }), copper)).toBe(6);
  });

  it("rounds pipe up to full sticks after waste and skips hangers underground", () => {
    const job = jobWith({
      runs: [createRun("sanitary", { pipeMaterialId: "pvc-dwv", size: 4, lengthFt: 85, location: "underground" })]
    });
    const takeoff = buildPlumbingTakeoff(job, config);
    const pipe = takeoff.materials.find((line) => line.kind === "pipe")!;
    expect(pipe.phase).toBe("underground");
    expect(pipe.qty).toBe(85);
    // 85 ft + 10% = 93.5 ft -> 5 x 20 ft sticks
    expect(pipe.orderQty).toBe(100);
    expect(pipe.materialCost).toBe(410);
    expect(takeoff.materials.some((line) => line.kind === "hanger")).toBe(false);
  });

  it("applies area multipliers to runs", () => {
    const takeoff = buildPlumbingTakeoff(createSamplePlumbingJob(), config);
    const bathWaste = takeoff.pipeTotals.find((total) => total.system === "sanitary" && total.size === 3)!;
    expect(bathWaste.lengthFt).toBe(28 * 4);
  });

  it("adds insulation for insulated hot water runs", () => {
    const job = jobWith({ runs: [createRun("hot", { lengthFt: 30 })] });
    const insulation = buildPlumbingTakeoff(job, config).materials.find((line) => line.kind === "insulation");
    expect(insulation?.qty).toBe(30);
  });
});

describe("rough-in field verification", () => {
  it("classifies measurements against the spec range", () => {
    const spec = { min: 11.5, target: 12, max: 12.5 };
    expect(checkMeasurement(12.25, spec)).toEqual({ deviation: 0.25, status: "pass" });
    expect(checkMeasurement(13, spec)).toEqual({ deviation: 1, status: "out-of-range" });
    expect(checkMeasurement(null, spec).status).toBe("not-measured");
  });

  it("flags out-of-range stub-outs in the takeoff", () => {
    const takeoff = buildPlumbingTakeoff(createSamplePlumbingJob(), config);
    const lav = takeoff.roughIn.find((result) => result.checkId === "chk-sample-lav")!;
    expect(lav.status).toBe("out-of-range");
    expect(takeoff.flags.some((flag) => flag.code === "ROUGH_IN_OUT_OF_RANGE")).toBe(true);
  });

  it("lists the dimensions still to be measured for entered fixtures", () => {
    const missing = getMissingRoughInChecks(createSamplePlumbingJob(), fixtures);
    expect(missing.some((item) => item.fixtureTypeId === "lavatory" && item.dimensionId === "supply-height")).toBe(true);
    expect(missing.some((item) => item.fixtureTypeId === "wc-tank" && item.dimensionId === "drain-from-wall")).toBe(false);
  });
});

describe("validation", () => {
  it("rejects a pipe material on the wrong system", () => {
    const job = jobWith({ runs: [createRun("sanitary", { pipeMaterialId: "pex-a", size: 0.75, lengthFt: 10 })] });
    const flags = buildPlumbingTakeoff(job, config).flags;
    expect(flags.find((flag) => flag.code === "PIPE_MATERIAL_SYSTEM")?.severity).toBe("error");
  });

  it("warns when the largest sanitary pipe is smaller than the DFU load needs", () => {
    const area = { id: "a", name: "Bath", level: "", multiplier: 1, fixtures: [{ id: "l", fixtureTypeId: "wc-tank", qty: 1, furnishedBy: "worth" as const, note: "" }] };
    const job = jobWith({ areas: [area], runs: [createRun("sanitary", { size: 2, lengthFt: 20 })] });
    expect(buildPlumbingTakeoff(job, config).flags.some((flag) => flag.code === "BUILDING_DRAIN_UNDERSIZED")).toBe(true);
  });

  it("asks for gas piping when a gas appliance is entered", () => {
    const area = { id: "a", name: "Mech", level: "", multiplier: 1, fixtures: [{ id: "l", fixtureTypeId: "wh-gas-50", qty: 1, furnishedBy: "worth" as const, note: "" }] };
    const flags = buildPlumbingTakeoff(jobWith({ areas: [area] }), config).flags;
    expect(flags.some((flag) => flag.code === "NO_GAS_PIPING")).toBe(true);
  });
});

describe("plumbing quote", () => {
  it("rolls up material, fixtures, labor, tax, overhead, and margin", () => {
    const job = createSamplePlumbingJob();
    const takeoff = buildPlumbingTakeoff(job, config);
    const quote = calculatePlumbingQuote(job, takeoff, config.pricing);
    const pricing = config.pricing;

    const expectedFixtures = 4 * (325 + 275 + 650 + 450 + 1100) + 0; // hose bibbs carry no fixture allowance
    expect(quote.fixtureCost).toBe(expectedFixtures);
    expect(quote.materialTax).toBeCloseTo((quote.materialCost + quote.fixtureCost) * (pricing.materialTaxPercent / 100), 1);
    expect(quote.laborCost).toBeCloseTo(quote.laborHours * pricing.laborRatePerHour, 1);
    expect(quote.allowanceTotal).toBe(600);
    expect(quote.directCost).toBeCloseTo(
      quote.materialCost + quote.fixtureCost + quote.materialTax + quote.laborCost + quote.allowanceTotal + quote.permitFee,
      1
    );
    expect(quote.total).toBeCloseTo(quote.directCost * (1 + pricing.overheadPercent / 100) * (1 + pricing.marginPercent / 100), 0);
  });

  it("does not price fixtures furnished by others", () => {
    const area = { id: "a", name: "Kitchen", level: "", multiplier: 1, fixtures: [{ id: "l", fixtureTypeId: "kitchen-sink", qty: 1, furnishedBy: "others" as const, note: "" }] };
    const job = jobWith({ areas: [area] });
    const quote = calculatePlumbingQuote(job, buildPlumbingTakeoff(job, config), config.pricing);
    expect(quote.fixtureCost).toBe(0);
    expect(quote.laborHours).toBeGreaterThan(0);
  });

  it("is zero for an empty job", () => {
    const job = jobWith({});
    const quote = calculatePlumbingQuote(job, buildPlumbingTakeoff(job, config), config.pricing);
    expect(quote.total).toBe(0);
  });
});

describe("field entry parsing", () => {
  it("reads tape measurements", () => {
    expect(parseInches("17 1/2")).toBe(17.5);
    expect(parseInches("17-1/2\"")).toBe(17.5);
    expect(parseInches("1'5-1/2")).toBe(17.5);
    expect(parseInches("12.25")).toBe(12.25);
    expect(parseInches("abc")).toBeNull();
  });

  it("reads pipe lengths", () => {
    expect(parseFeet("42")).toBe(42);
    expect(parseFeet("42'6")).toBe(42.5);
    expect(parseFeet("42' 6\"")).toBe(42.5);
    expect(parseFeet("30\"")).toBe(2.5);
  });

  it("formats sizes and fractions", () => {
    expect(formatPipeSize(0.5)).toBe('1/2"');
    expect(formatPipeSize(1.25)).toBe('1-1/4"');
    expect(formatPipeSize(4)).toBe('4"');
    expect(formatInchesFraction(17.5)).toBe('17-1/2"');
  });
});
