import type {
  FixtureLine,
  FixtureType,
  PipeRun,
  PipeSystem,
  PlumbingAllowance,
  PlumbingArea,
  PlumbingJob,
  PlumbingRevision
} from "./types";

export function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function createBlankPlumbingJob(createdBy = ""): PlumbingJob {
  const now = new Date().toISOString();
  return {
    id: createId("pjob"),
    name: "New plumbing job",
    number: "",
    customer: "",
    address: "",
    createdBy,
    dateCreated: now,
    updatedAt: now,
    revision: "A",
    status: "active",
    buildingType: "residential",
    projectType: "new",
    areas: [createArea("Area 1")],
    runs: [],
    fieldChecks: [],
    allowances: [],
    notes: ""
  };
}

export function createArea(name: string, level = "", multiplier = 1): PlumbingArea {
  return { id: createId("area"), name, level, multiplier, fixtures: [] };
}

export function createFixtureLine(fixture: Pick<FixtureType, "id" | "defaultFurnishedBy">, qty = 1): FixtureLine {
  return { id: createId("fx"), fixtureTypeId: fixture.id, qty, furnishedBy: fixture.defaultFurnishedBy, note: "" };
}

export function createRun(system: PipeSystem, overrides: Partial<PipeRun> = {}): PipeRun {
  const defaults: Record<PipeSystem, Pick<PipeRun, "pipeMaterialId" | "size">> = {
    sanitary: { pipeMaterialId: "pvc-dwv", size: 3 },
    vent: { pipeMaterialId: "pvc-dwv", size: 2 },
    cold: { pipeMaterialId: "pex-a", size: 0.75 },
    hot: { pipeMaterialId: "pex-a", size: 0.75 },
    "hot-return": { pipeMaterialId: "pex-a", size: 0.5 },
    gas: { pipeMaterialId: "steel-gas", size: 0.75 },
    storm: { pipeMaterialId: "pvc-dwv", size: 4 },
    condensate: { pipeMaterialId: "pvc-dwv", size: 0.75 }
  };
  return {
    id: createId("run"),
    areaId: "",
    label: "",
    system,
    ...defaults[system],
    lengthFt: 0,
    location: system === "sanitary" ? "underground" : "aboveground",
    fittingCount: null,
    insulated: system === "hot" || system === "hot-return",
    ...overrides
  };
}

export function createAllowance(label = "Allowance", amount = 0): PlumbingAllowance {
  return { id: createId("allow"), label, amount };
}

export function createPlumbingRevision(job: PlumbingJob): PlumbingRevision {
  return {
    id: createId("prev"),
    jobId: job.id,
    number: job.revision,
    createdAt: new Date().toISOString(),
    snapshot: JSON.parse(JSON.stringify(job)) as PlumbingJob
  };
}

/** Fills in fields that older saved jobs may be missing. */
export function normalizePlumbingJob(job: Partial<PlumbingJob> & Pick<PlumbingJob, "id">): PlumbingJob {
  const blank = createBlankPlumbingJob();
  return {
    ...blank,
    ...job,
    areas: (job.areas ?? []).map((area) => ({ ...area, multiplier: area.multiplier || 1, fixtures: area.fixtures ?? [] })),
    runs: (job.runs ?? []).map((run) => ({ ...run, fittingCount: run.fittingCount ?? null })),
    fieldChecks: job.fieldChecks ?? [],
    allowances: job.allowances ?? []
  };
}

/** Four-unit residential sample used for demos and tests. */
export function createSamplePlumbingJob(): PlumbingJob {
  const bath: PlumbingArea = {
    id: "area-sample-bath",
    name: "Unit A - Bath",
    level: "Typical unit",
    multiplier: 4,
    fixtures: [
      { id: "fx-sample-wc", fixtureTypeId: "wc-tank", qty: 1, furnishedBy: "worth", note: "" },
      { id: "fx-sample-lav", fixtureTypeId: "lavatory", qty: 1, furnishedBy: "worth", note: "" },
      { id: "fx-sample-tub", fixtureTypeId: "tub-shower", qty: 1, furnishedBy: "worth", note: "" }
    ]
  };
  const kitchen: PlumbingArea = {
    id: "area-sample-kitchen",
    name: "Unit A - Kitchen / Laundry",
    level: "Typical unit",
    multiplier: 4,
    fixtures: [
      { id: "fx-sample-ks", fixtureTypeId: "kitchen-sink", qty: 1, furnishedBy: "worth", note: "" },
      { id: "fx-sample-dw", fixtureTypeId: "dishwasher", qty: 1, furnishedBy: "others", note: "" },
      { id: "fx-sample-im", fixtureTypeId: "icemaker", qty: 1, furnishedBy: "others", note: "" },
      { id: "fx-sample-cw", fixtureTypeId: "washer-box", qty: 1, furnishedBy: "others", note: "" },
      { id: "fx-sample-wh", fixtureTypeId: "wh-electric-50", qty: 1, furnishedBy: "worth", note: "" }
    ]
  };
  const site: PlumbingArea = {
    id: "area-sample-site",
    name: "Exterior",
    level: "Site",
    multiplier: 1,
    fixtures: [{ id: "fx-sample-hb", fixtureTypeId: "hose-bibb", qty: 2, furnishedBy: "worth", note: "" }]
  };

  const run = (id: string, areaId: string, label: string, system: PipeSystem, partial: Partial<PipeRun>): PipeRun => ({
    ...createRun(system),
    id,
    areaId,
    label,
    ...partial
  });

  return {
    id: "pjob-sample-fourplex",
    name: "Sample fourplex",
    number: "WP-1001",
    customer: "Sample Owner LLC",
    address: "",
    createdBy: "Worth Estimating",
    dateCreated: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    revision: "A",
    status: "active",
    buildingType: "residential",
    projectType: "new",
    areas: [bath, kitchen, site],
    runs: [
      run("run-sample-bldg-drain", "", "Building drain to sewer", "sanitary", { pipeMaterialId: "pvc-dwv", size: 4, lengthFt: 85, location: "underground" }),
      run("run-sample-ug-waste", bath.id, "Bath underground waste", "sanitary", { pipeMaterialId: "pvc-dwv", size: 3, lengthFt: 28, location: "underground" }),
      run("run-sample-kit-waste", kitchen.id, "Kitchen / laundry waste", "sanitary", { pipeMaterialId: "pvc-dwv", size: 2, lengthFt: 18, location: "in-wall" }),
      run("run-sample-bath-vent", bath.id, "Bath vents", "vent", { pipeMaterialId: "pvc-dwv", size: 2, lengthFt: 40, location: "aboveground" }),
      run("run-sample-kit-vent", kitchen.id, "Kitchen / laundry vents", "vent", { pipeMaterialId: "pvc-dwv", size: 1.5, lengthFt: 20, location: "in-wall" }),
      run("run-sample-service", "", "Water service", "cold", { pipeMaterialId: "pex-a", size: 1.25, lengthFt: 60, location: "underground", insulated: false }),
      run("run-sample-cold-main", bath.id, "Unit cold main", "cold", { pipeMaterialId: "pex-a", size: 0.75, lengthFt: 40, location: "aboveground" }),
      run("run-sample-cold-branch", bath.id, "Unit cold branches", "cold", { pipeMaterialId: "pex-a", size: 0.5, lengthFt: 60, location: "in-wall" }),
      run("run-sample-hot-main", kitchen.id, "Unit hot main", "hot", { pipeMaterialId: "pex-a", size: 0.75, lengthFt: 30, location: "aboveground" }),
      run("run-sample-hot-branch", kitchen.id, "Unit hot branches", "hot", { pipeMaterialId: "pex-a", size: 0.5, lengthFt: 50, location: "in-wall" })
    ],
    fieldChecks: [
      { id: "chk-sample-wc", areaId: bath.id, fixtureTypeId: "wc-tank", dimensionId: "drain-from-wall", measured: 12.25, note: "" },
      { id: "chk-sample-lav", areaId: bath.id, fixtureTypeId: "lavatory", dimensionId: "drain-height", measured: 21, note: "Vanity drawer conflict?" },
      { id: "chk-sample-tub", areaId: bath.id, fixtureTypeId: "tub-shower", dimensionId: "valve-height", measured: 28.5, note: "" }
    ],
    allowances: [{ id: "allow-sample-core", label: "Core drilling allowance", amount: 600 }],
    notes: "Sample job: typical unit entered once and multiplied by 4."
  };
}
