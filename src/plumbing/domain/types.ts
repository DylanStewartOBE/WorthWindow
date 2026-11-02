// Plumbing takeoff domain types.
// This engine is intentionally separate from the FG-2000 storefront engine in src/domain.

export type Inches = number;
export type Feet = number;

export type PlumbingBuildingType = "residential" | "commercial";
export type PlumbingProjectType = "new" | "remodel" | "tenant-improvement";
export type PlumbingJobStatus = "active" | "archived";
export type PlumbingPhase = "underground" | "rough" | "trim";
export type PlumbingSeverity = "info" | "warning" | "error";

export type PipeSystem =
  | "sanitary"
  | "vent"
  | "cold"
  | "hot"
  | "hot-return"
  | "gas"
  | "storm"
  | "condensate";

export type RunLocation = "underground" | "aboveground" | "in-wall";

export type FixtureCategory = "fixture" | "appliance" | "equipment" | "drain";

/** Furnished-by: Worth supplies the fixture, or the owner/GC supplies it and Worth only installs it. */
export type FurnishedBy = "worth" | "others";

// ---------------------------------------------------------------------------
// Job input (what the estimator / field tech enters)
// ---------------------------------------------------------------------------

export interface PlumbingJob {
  id: string;
  name: string;
  number: string;
  customer: string;
  address: string;
  createdBy: string;
  dateCreated: string;
  updatedAt: string;
  revision: string;
  status: PlumbingJobStatus;
  buildingType: PlumbingBuildingType;
  projectType: PlumbingProjectType;
  areas: PlumbingArea[];
  runs: PipeRun[];
  fieldChecks: RoughInCheck[];
  allowances: PlumbingAllowance[];
  notes: string;
  plans: PlanSet;
  /** Brand picked per catalog group, e.g. "pipe:pvc-dwv" -> "Charlotte Pipe". */
  brandChoices: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Plan takeoff (runs and fixtures drawn on uploaded PDF sheets)
// ---------------------------------------------------------------------------

/** Point in PDF page space at scale 1: points (1/72 in), origin top-left, y down, page rotation applied. */
export interface PlanPoint {
  x: number;
  y: number;
}

export interface PlanFile {
  id: string;
  name: string;
  sizeBytes: number;
  pageCount: number;
  uploadedAt: string;
  info: {
    title: string;
    author: string;
    subject: string;
    creator: string;
    producer: string;
    created: string;
    modified: string;
  };
}

export type PlanScaleSource = "detected" | "calibrated" | "manual";

export interface PlanScale {
  /** Real-world feet represented by one PDF point. */
  feetPerPoint: number;
  label: string;
  source: PlanScaleSource;
}

export interface PlanSheet {
  id: string;
  fileId: string;
  pageNumber: number;
  pageLabel: string;
  sheetNumber: string;
  title: string;
  widthPt: number;
  heightPt: number;
  detectedScales: string[];
  scale: PlanScale | null;
  /** Default area for runs and fixtures drawn on this sheet. Empty = building-wide. */
  areaId: string;
  notes: string[];
}

export type TrenchMode = "own" | "shared" | "none";

export interface PlanRun {
  id: string;
  sheetId: string;
  areaId: string;
  label: string;
  system: PipeSystem;
  pipeMaterialId: string;
  size: number;
  location: RunLocation;
  points: PlanPoint[];
  /** Extra rises and drops not shown in plan view, in feet. */
  extraVerticalFt: number;
  /** Underground only: depth to pipe at the high (shallow) end, the last point drawn. Null = rule-pack default. */
  startDepthFt: number | null;
  /** Underground only: fall in inches per foot toward the first point drawn. Null = rule-pack default. */
  slopeInPerFt: number | null;
  trench: TrenchMode;
}

export interface FixtureMarker {
  id: string;
  sheetId: string;
  areaId: string;
  fixtureTypeId: string;
  furnishedBy: FurnishedBy;
  x: number;
  y: number;
}

export interface PlanSet {
  files: PlanFile[];
  sheets: PlanSheet[];
  runs: PlanRun[];
  markers: FixtureMarker[];
}

export type FittingType =
  | "elbow90"
  | "elbow45"
  | "elbow22"
  | "elbow11"
  | "riser90"
  | "tee"
  | "wye"
  | "combo"
  | "coupling"
  | "reducer";

export interface FittingItem {
  type: FittingType;
  size: number;
  /** Branch or reduced size for tees, wyes and reducers. */
  branchSize?: number;
  qty: number;
}

/**
 * A room, unit type, or floor. `multiplier` lets an estimator enter one typical
 * unit and count it N times (for example, "Unit Type A x 12").
 */
export interface PlumbingArea {
  id: string;
  name: string;
  level: string;
  multiplier: number;
  fixtures: FixtureLine[];
}

export interface FixtureLine {
  id: string;
  fixtureTypeId: string;
  qty: number;
  furnishedBy: FurnishedBy;
  note: string;
}

export interface PipeRun {
  id: string;
  /** Area the run belongs to. Empty string = building-wide (mains, service, building drain). */
  areaId: string;
  label: string;
  system: PipeSystem;
  pipeMaterialId: string;
  /** Nominal pipe size in inches, e.g. 0.5, 0.75, 1.5, 3, 4. */
  size: number;
  lengthFt: Feet;
  location: RunLocation;
  /** Explicit fitting count. `null` means estimate from the system's fittings-per-100-ft rule. */
  fittingCount: number | null;
  insulated: boolean;
  /** Set on runs measured from plans: fittings by type replace the average fitting estimate. */
  fittingItems?: FittingItem[];
  /** Straight pieces in feet, used for the stock-length cut list. */
  pieces?: number[];
  trenchCalc?: TrenchCalc | null;
  source?: "manual" | "plan";
}

export interface TrenchCalc {
  lengthFt: number;
  widthFt: number;
  startDepthFt: number;
  endDepthFt: number;
  averageDepthFt: number;
  excavationCy: number;
  beddingCy: number;
  backfillCy: number;
}

export interface RoughInCheck {
  id: string;
  areaId: string;
  fixtureTypeId: string;
  dimensionId: string;
  measured: Inches | null;
  note: string;
}

export interface PlumbingAllowance {
  id: string;
  label: string;
  amount: number;
}

export interface PlumbingRevision {
  id: string;
  jobId: string;
  number: string;
  createdAt: string;
  snapshot: PlumbingJob;
}

// ---------------------------------------------------------------------------
// Rule packs (JSON-editable)
// ---------------------------------------------------------------------------

export interface KitItem {
  materialId: string;
  qty: number;
}

export interface RoughInDimensionSpec {
  id: string;
  label: string;
  /** How the measurement is taken in the field. */
  reference: string;
  min: Inches;
  target: Inches;
  max: Inches;
}

export interface FixtureType {
  id: string;
  label: string;
  shortLabel: string;
  category: FixtureCategory;
  /** Drainage fixture units (IPC Table 709.1 defaults). */
  dfu: number;
  /** Water supply fixture units (IPC Appendix E defaults). */
  wsfu: { cold: number; hot: number; total: number };
  /** Overrides applied when the job is a commercial (public-use) building. */
  publicUse?: {
    dfu?: number;
    wsfu?: { cold: number; hot: number; total: number };
  };
  /** Treat as flush-valve load when estimating peak demand. */
  flushValve: boolean;
  /** True for water heaters, so the takeoff can tell whether hot water has a source. */
  providesHotWater: boolean;
  /** Field default for new lines: appliances are usually furnished by others. */
  defaultFurnishedBy: FurnishedBy;
  minTrapSize: number | null;
  minDrainSize: number | null;
  needsHotWater: boolean;
  needsGas: boolean;
  roughLaborHours: number;
  trimLaborHours: number;
  /** Budget price of the fixture itself when Worth furnishes it. */
  fixtureAllowance: number;
  roughKit: KitItem[];
  trimKit: KitItem[];
  roughIn: RoughInDimensionSpec[];
}

export interface FixtureLibrary {
  id: string;
  name: string;
  version: string;
  source: string;
  fixtures: FixtureType[];
}

export interface MaterialItem {
  id: string;
  label: string;
  /** Optional brand options; the first is the default. */
  brands?: string[];
  sku?: string;
  unit: string;
  unitCost: number;
  laborHours: number;
}

export interface MaterialCatalog {
  id: string;
  name: string;
  version: string;
  effectiveDate: string;
  materials: MaterialItem[];
}

export interface PipeSizeSpec {
  size: number;
  costPerFoot: number;
  laborHoursPerFoot: number;
  fittingCost: number;
  laborHoursPerFitting: number;
}

export interface PipeMaterial {
  id: string;
  label: string;
  /** Wall or pressure class shown on the shopping list, e.g. "Sch 40", "Type L". */
  schedule: string;
  /** Drainage fittings (bends, wyes) or pressure fittings (elbows, tees). */
  family: "dwv" | "pressure";
  /** Brands for pipe; the first is the default. */
  brands: string[];
  /** Brands for fittings; the first is the default. */
  fittingBrands: string[];
  allowedSystems: PipeSystem[];
  stickLengthFt: Feet;
  /** Maximum horizontal hanger spacing in feet. Underground runs get no hangers. */
  hangerSpacingFt: Feet;
  /** Optional larger spacing once pipe size reaches `largeSizeFrom`. */
  largeHangerSpacingFt?: Feet;
  largeSizeFrom?: number;
  hangerMaterialId: string;
  sizes: PipeSizeSpec[];
}

export interface SystemRule {
  system: PipeSystem;
  label: string;
  fittingsPer100Ft: number;
  insulationMaterialId?: string;
}

export interface DrainSizingRow {
  size: number;
  maxDfu: number;
}

export interface DemandRow {
  wsfu: number;
  gpmFlushTank: number;
  gpmFlushValve: number;
}

export interface FittingTypeRule {
  type: FittingType;
  dwvLabel: string;
  pressureLabel: string;
  /** Multiplier on the size's average fitting cost and labor. */
  costFactor: number;
  laborFactor: number;
}

export interface PlanRules {
  /** Standard bend angles available, largest first. */
  bendAngles: number[];
  /** Degrees a drawn bend may miss a standard angle before it is flagged. */
  bendToleranceDeg: number;
  /** Vertical feet added at each fixture connection (riser, stub, or drop). */
  fixtureRiseFt: Partial<Record<PipeSystem, number>>;
  /** Default depth to pipe at the start of underground runs, in feet. */
  defaultDepthFt: Partial<Record<PipeSystem, number>>;
  /** Default fall for underground runs, in inches per foot. */
  defaultSlopeInPerFt: Partial<Record<PipeSystem, number>>;
}

export interface ExcavationRules {
  minTrenchWidthIn: number;
  sideClearanceIn: number;
  beddingBelowIn: number;
  excavateCyPerHour: number;
  backfillCyPerHour: number;
  equipmentLabel: string;
  equipmentRatePerHour: number;
  beddingLabel: string;
  beddingCostPerCy: number;
  warningTapeCostPerFt: number;
  warningTapeSystems: PipeSystem[];
  tracerWireCostPerFt: number;
  /** Tracer wire goes on non-metallic pipe in these systems. */
  tracerWireSystems: PipeSystem[];
  nonMetallicMaterialIds: string[];
}

export interface PipingRulePack {
  id: string;
  name: string;
  version: string;
  source: string;
  wastePercent: number;
  fittingTypes: FittingTypeRule[];
  plan: PlanRules;
  excavation: ExcavationRules;
  systems: SystemRule[];
  pipeMaterials: PipeMaterial[];
  /** Building drain / sewer capacity at 1/4" per foot slope. */
  buildingDrainAtQuarterInch: DrainSizingRow[];
  /** Fixture-unit to GPM estimate (Hunter's curve). */
  demand: DemandRow[];
}

export interface PlumbingPricingRulePack {
  id: string;
  name: string;
  version: string;
  effectiveDate: string;
  owner: string;
  laborRatePerHour: number;
  materialTaxPercent: number;
  overheadPercent: number;
  marginPercent: number;
  permitFee: number;
  testAndInspectHoursPerFixture: number;
  mobilizationHours: number;
  assumptions: string[];
  exclusions: string[];
}

export interface PlumbingConfig {
  fixtureLibrary: FixtureLibrary;
  materialCatalog: MaterialCatalog;
  pipingRulePack: PipingRulePack;
  pricing: PlumbingPricingRulePack;
}

// ---------------------------------------------------------------------------
// Computed takeoff
// ---------------------------------------------------------------------------

export interface FixtureScheduleLine {
  areaId: string;
  areaName: string;
  multiplier: number;
  fixtureTypeId: string;
  label: string;
  qtyPerArea: number;
  totalQty: number;
  furnishedBy: FurnishedBy;
  source: "manual" | "plan";
  dfuEach: number;
  wsfuEach: FixtureType["wsfu"];
  totalDfu: number;
  totalWsfu: FixtureType["wsfu"];
}

export type TakeoffLineKind =
  | "fixture"
  | "labor"
  | "kit"
  | "pipe"
  | "fitting"
  | "hanger"
  | "insulation"
  | "excavation"
  | "site-material";

export interface MaterialTakeoffLine {
  key: string;
  kind: TakeoffLineKind;
  phase: PlumbingPhase;
  group: string;
  description: string;
  unit: string;
  qty: number;
  /** Quantity to order after waste and stick rounding (pipe only; equals qty otherwise). */
  orderQty: number;
  orderNote: string;
  unitCost: number;
  materialCost: number;
  laborHours: number;
  /** Key into the brand lists, e.g. "pipe:pvc-dwv", "fitting:pvc-dwv", "material:washer-box". */
  brandKey?: string;
  /** Size label for shopping lists (pipe and fittings). */
  sizeLabel?: string;
}

export interface PipeRunTotal {
  key: string;
  system: PipeSystem;
  systemLabel: string;
  pipeMaterialId: string;
  materialLabel: string;
  size: number;
  location: RunLocation;
  lengthFt: Feet;
  fittings: number;
  hangers: number;
}

export interface SizingSummary {
  totalDfu: number;
  totalWsfu: FixtureType["wsfu"];
  hasFlushValves: boolean;
  estimatedPeakGpm: number;
  minBuildingDrainSize: number | null;
  largestSanitaryEntered: number | null;
  waterClosetCount: number;
  hotWaterFixtureCount: number;
}

export interface RoughInResult {
  checkId: string;
  areaName: string;
  fixtureLabel: string;
  dimensionLabel: string;
  reference: string;
  measured: Inches | null;
  min: Inches;
  target: Inches;
  max: Inches;
  deviation: Inches | null;
  status: "pass" | "out-of-range" | "not-measured" | "unknown-spec";
}

export interface PlumbingFlag {
  id: string;
  code: string;
  severity: PlumbingSeverity;
  message: string;
  recommendation: string;
}

export interface CutListLine {
  key: string;
  pipeMaterialId: string;
  materialLabel: string;
  size: number;
  stockLengthFt: number;
  pieces: number[];
  sticks: number;
  usedFt: number;
  offcutFt: number;
}

export interface PlanRunResult {
  runId: string;
  sheetId: string;
  label: string;
  horizontalFt: number;
  verticalFt: number;
  totalFt: number;
  bends: { angleDeg: number; fittings: FittingType[]; offAngle: boolean }[];
  fittingItems: FittingItem[];
  fixtureConnections: number;
  trench: TrenchCalc | null;
  measured: boolean;
}

export interface PlumbingTakeoff {
  fixtureSchedule: FixtureScheduleLine[];
  planRuns: PlanRunResult[];
  cutList: CutListLine[];
  fixtureCount: number;
  materials: MaterialTakeoffLine[];
  pipeTotals: PipeRunTotal[];
  sizing: SizingSummary;
  roughIn: RoughInResult[];
  flags: PlumbingFlag[];
}

export interface PhaseCost {
  phase: PlumbingPhase;
  materialCost: number;
  laborHours: number;
  laborCost: number;
}

export interface PlumbingQuote {
  pricingName: string;
  pricingVersion: string;
  pricingEffectiveDate: string;
  phases: PhaseCost[];
  materialCost: number;
  fixtureCost: number;
  materialTax: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  testAndInspectHours: number;
  mobilizationHours: number;
  allowances: PlumbingAllowance[];
  allowanceTotal: number;
  permitFee: number;
  directCost: number;
  overheadPercent: number;
  overhead: number;
  marginPercent: number;
  margin: number;
  total: number;
  assumptions: string[];
  exclusions: string[];
}
