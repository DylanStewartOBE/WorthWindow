import { describe, expect, it } from "vitest";
import { defaultPlumbingConfig } from "../src/plumbing/config";
import { createBlankPlumbingJob } from "../src/plumbing/domain/jobs";
import { buildShoppingList, shoppingListText } from "../src/plumbing/domain/shopping";
import { buildPlumbingTakeoff } from "../src/plumbing/domain/takeoff";
import type { FixtureMarker, PlanRun, PlanSheet, PlumbingJob } from "../src/plumbing/domain/types";
import { analyzePlans, calculateTrench, decomposeBend, packStock } from "../src/plumbing/plan/analyze";
import { describePaper, detectScales, detectSheetIdentity } from "../src/plumbing/plan/sheetInfo";

const config = defaultPlumbingConfig;
// 1/4" = 1'-0": one inch of paper (72 pt) is 4 ft, so 18 pt = 1 ft.
const QUARTER_INCH = { feetPerPoint: 4 / 72, label: `1/4" = 1'-0"`, source: "detected" as const };
const FT = 18;

function sheet(partial: Partial<PlanSheet> = {}): PlanSheet {
  return {
    id: "s1",
    fileId: "f1",
    pageNumber: 1,
    pageLabel: "1",
    sheetNumber: "P-101",
    title: "PLUMBING FLOOR PLAN",
    widthPt: 2592,
    heightPt: 1728,
    detectedScales: [QUARTER_INCH.label],
    scale: QUARTER_INCH,
    areaId: "",
    notes: [],
    ...partial
  };
}

function run(id: string, points: [number, number][], partial: Partial<PlanRun> = {}): PlanRun {
  return {
    id,
    sheetId: "s1",
    areaId: "",
    label: id,
    system: "sanitary",
    pipeMaterialId: "pvc-dwv",
    size: 3,
    location: "underground",
    points: points.map(([x, y]) => ({ x: x * FT, y: y * FT })),
    extraVerticalFt: 0,
    startDepthFt: null,
    slopeInPerFt: null,
    trench: "own",
    ...partial
  };
}

function marker(id: string, x: number, y: number, fixtureTypeId = "wc-tank", areaId = ""): FixtureMarker {
  return { id, sheetId: "s1", areaId, fixtureTypeId, furnishedBy: "worth", x: x * FT, y: y * FT };
}

function jobWithPlan(runs: PlanRun[], markers: FixtureMarker[] = [], sheets: PlanSheet[] = [sheet()]): PlumbingJob {
  return { ...createBlankPlumbingJob(), areas: [], plans: { files: [], sheets, runs, markers } };
}

describe("reading plan sheets", () => {
  it("finds architectural, engineering, and ratio scales", () => {
    expect(detectScales(`FLOOR PLAN SCALE: 1/4" = 1'-0"`)[0].feetPerInch).toBe(4);
    expect(detectScales(`SCALE 1/8"=1'-0"`)[0].feetPerInch).toBe(8);
    expect(detectScales(`3/16 ” = 1 ’- 0 ”`)[0].feetPerInch).toBeCloseTo(16 / 3);
    expect(detectScales(`DETAIL 1 1/2" = 1'-0"`)[0].feetPerInch).toBeCloseTo(2 / 3);
    expect(detectScales(`SITE PLAN 1" = 20'`)[0].feetPerInch).toBe(20);
    expect(detectScales(`SCALE 1:48`)[0].feetPerInch).toBe(4);
    expect(detectScales("SCALE: NTS")).toEqual([]);
  });

  it("puts the most frequent scale first", () => {
    const scales = detectScales(`1/4" = 1'-0" ... 1/4" = 1'-0" ... DETAIL 1/2" = 1'-0"`);
    expect(scales.map((scale) => scale.feetPerInch)).toEqual([4, 2]);
  });

  it("picks the title-block sheet number and title", () => {
    const identity = detectSheetIdentity([
      { text: "SEE A-201", height: 8 },
      { text: "A-201", height: 8 },
      { text: "PLUMBING FLOOR PLAN - LEVEL 1", height: 14 },
      { text: "P-101", height: 24 },
      { text: "SCALE: 1/4\" = 1'-0\"", height: 9 }
    ]);
    expect(identity).toEqual({ sheetNumber: "P-101", title: "PLUMBING FLOOR PLAN - LEVEL 1", isPlumbing: true });
  });

  it("names paper sizes and flags reduced prints", () => {
    expect(describePaper(2592, 1728)).toEqual({ label: `ARCH D (24" x 36")`, reduced: false });
    expect(describePaper(1224, 792).reduced).toBe(true);
  });
});

describe("bends and stock lengths", () => {
  const angles = config.pipingRulePack.plan.bendAngles;
  it("builds turns from standard bends", () => {
    expect(decomposeBend(90, angles, 5)).toEqual({ fittings: ["elbow90"], offAngle: false });
    expect(decomposeBend(88, angles, 5).fittings).toEqual(["elbow90"]);
    expect(decomposeBend(67.5, angles, 5)).toEqual({ fittings: ["elbow45", "elbow22"], offAngle: false });
    expect(decomposeBend(3, angles, 5).fittings).toEqual([]);
    expect(decomposeBend(30, angles, 5).offAngle).toBe(true);
  });

  it("packs cut pieces into stock lengths", () => {
    expect(packStock([12, 12, 8, 8, 5], 20).sticks).toBe(3);
    const long = packStock([45], 20);
    expect(long.sticks).toBe(3);
    expect(long.offcutFt).toBe(15);
  });
});

describe("measuring drawn runs", () => {
  it("measures length and the bend in an L-shaped run", () => {
    const [result] = analyzePlans(jobWithPlan([run("a", [[0, 0], [10, 0], [10, 6]], { location: "aboveground" })]), config).results;
    expect(result.horizontalFt).toBe(16);
    expect(result.fittingItems).toEqual([{ type: "elbow90", size: 3, qty: 1 }]);
  });

  it("adds a branch fitting where a run starts on another run", () => {
    const analysis = analyzePlans(
      jobWithPlan([
        run("main", [[0, 0], [20, 0]], { location: "aboveground" }),
        run("branch", [[8, 0], [8, 6]], { size: 2, location: "aboveground" }),
        run("angled", [[14, 0], [18, 4]], { size: 2, location: "aboveground" })
      ]),
      config
    );
    const branch = analysis.results.find((result) => result.runId === "branch")!;
    const angled = analysis.results.find((result) => result.runId === "angled")!;
    expect(branch.fittingItems).toContainEqual({ type: "combo", size: 3, branchSize: 2, qty: 1 });
    expect(angled.fittingItems).toContainEqual({ type: "wye", size: 3, branchSize: 2, qty: 1 });
  });

  it("uses tees on pressure piping and counts a straight continuation once", () => {
    const analysis = analyzePlans(
      jobWithPlan([
        run("main", [[0, 0], [10, 0]], { system: "cold", pipeMaterialId: "copper-l", size: 1, location: "aboveground" }),
        run("next", [[10, 0], [20, 0]], { system: "cold", pipeMaterialId: "copper-l", size: 0.75, location: "aboveground" }),
        run("branch", [[5, 0], [5, 5]], { system: "cold", pipeMaterialId: "copper-l", size: 0.5, location: "aboveground" })
      ]),
      config
    );
    const items = analysis.results.flatMap((result) => result.fittingItems);
    expect(items).toContainEqual({ type: "reducer", size: 1, branchSize: 0.75, qty: 1 });
    expect(items).toContainEqual({ type: "tee", size: 1, branchSize: 0.5, qty: 1 });
    expect(items.filter((item) => item.type === "reducer")).toHaveLength(1);
  });

  it("adds a riser and vertical pipe where a run ends at a fixture", () => {
    const analysis = analyzePlans(jobWithPlan([run("a", [[0, 0], [8, 0]])], [marker("m1", 8, 0)]), config);
    const [result] = analysis.results;
    // The fixture is at the last point, the high end: 1.5 ft deep plus the 1 ft fixture rise
    expect(result.fixtureConnections).toBe(1);
    expect(result.verticalFt).toBeCloseTo(2.5, 2);
    expect(result.fittingItems).toContainEqual({ type: "riser90", size: 3, qty: 1 });
    expect(analysis.fixtureLines).toEqual([{ areaId: "", fixtureTypeId: "wc-tank", furnishedBy: "worth", qty: 1 }]);
  });

  it("rises from the low end when the fixture is at the first point", () => {
    const [result] = analyzePlans(jobWithPlan([run("a", [[0, 0], [8, 0]])], [marker("m1", 0, 0)]), config).results;
    // 1.5 ft + 8 ft x 1/4"/ft = 1.667 ft deep at the first point, plus 1 ft
    expect(result.verticalFt).toBeCloseTo(2.67, 2);
  });

  it("adds couplings where a straight is longer than a stick", () => {
    const [result] = analyzePlans(jobWithPlan([run("a", [[0, 0], [45, 0]], { location: "aboveground" })]), config).results;
    expect(result.fittingItems).toEqual([{ type: "coupling", size: 3, qty: 2 }]);
  });

  it("skips runs on sheets without a scale", () => {
    const job = jobWithPlan([run("a", [[0, 0], [10, 0]])], [], [sheet({ scale: null })]);
    const takeoff = buildPlumbingTakeoff(job, config);
    expect(takeoff.planRuns[0].measured).toBe(false);
    expect(takeoff.flags.find((flag) => flag.code === "PLAN_SHEET_NOT_SCALED")?.severity).toBe("error");
  });
});

describe("trenches", () => {
  it("deepens along the slope and computes volumes", () => {
    const trench = calculateTrench({ system: "sanitary", size: 4, startDepthFt: 2, slopeInPerFt: 0.25, trench: "own" }, 48, config);
    expect(trench.endDepthFt).toBe(3);
    expect(trench.averageDepthFt).toBe(2.5);
    // 4" pipe (about 4.8" OD) + 8" clearance each side = 20.8" wide
    expect(trench.widthFt).toBeCloseTo(1.73, 2);
    // 48 ft x 1.733 ft x (2.5 ft + 0.5 ft bedding) / 27
    expect(trench.excavationCy).toBeCloseTo(9.24, 1);
  });

  it("charges no digging for a shared trench but still beds the pipe", () => {
    const trench = calculateTrench({ system: "cold", size: 1, startDepthFt: null, slopeInPerFt: null, trench: "shared" }, 30, config);
    expect(trench.excavationCy).toBe(0);
    expect(trench.beddingCy).toBeGreaterThan(0);
  });
});

describe("plan takeoff and shopping list", () => {
  const area = { id: "unit", name: "Unit A", level: "", multiplier: 2, fixtures: [] };
  const job: PlumbingJob = {
    ...jobWithPlan(
      [run("a", [[0, 0], [12, 0], [12, 10]], { areaId: "unit" })],
      [marker("m1", 12, 10, "wc-tank", "unit")]
    ),
    areas: [area]
  };

  it("counts plan fixtures and runs with the area multiplier", () => {
    const takeoff = buildPlumbingTakeoff(job, config);
    const wc = takeoff.fixtureSchedule.find((line) => line.fixtureTypeId === "wc-tank")!;
    expect(wc.source).toBe("plan");
    expect(wc.totalQty).toBe(2);
    const pipe = takeoff.materials.find((line) => line.kind === "pipe")!;
    expect(pipe.phase).toBe("underground");
    expect(pipe.qty).toBeGreaterThan(44);
    expect(takeoff.materials.some((line) => line.description === "Trench excavation")).toBe(true);
    expect(takeoff.cutList[0].pieces.length).toBe(6);
  });

  it("lists pipe in sticks with the default or chosen brand", () => {
    const takeoff = buildPlumbingTakeoff(job, config);
    const list = buildShoppingList(takeoff, job, config);
    const pipe = list.sections.find((section) => section.name === "Pipe")!.items[0];
    expect(pipe.brand).toBe("Charlotte Pipe");
    expect(pipe.orderText).toMatch(/^\d+ x 20' sticks$/);
    expect(list.sections.some((section) => section.name === "Fittings")).toBe(true);
    expect(list.sections.some((section) => section.name.includes("labor"))).toBe(false);

    const chosen = { ...job, brandChoices: { "pipe:pvc-dwv": "JM Eagle" } };
    const chosenList = buildShoppingList(buildPlumbingTakeoff(chosen, config), chosen, config);
    expect(chosenList.sections[0].items[0].brand).toBe("JM Eagle");
    expect(shoppingListText(chosenList, chosen)).toContain("JM Eagle PVC Sch 40 DWV 3\" pipe");
  });
});
