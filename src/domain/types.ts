export type Inches = number;

export type ProjectType = "new" | "replacement" | "alteration";
export type DoorType = "none" | "single" | "pair";
export type DoorLocationMode = "center" | "left" | "right" | "custom";
export type DoorRowPlacement = "above" | "below";
export type DoorSwing = "inswing" | "outswing";
export type HingeType = "butt" | "pivot" | "continuous-gear" | "center-hung";
export type ValidationSeverity = "info" | "warning" | "error";
export type JobStatus = "active" | "archived";
export type LiteType = "fixed" | "sidelite" | "transom" | "door-adjacent-lite";
export type BayType = "lite" | "door" | "transom";
export type DimensionOrientation = "horizontal" | "vertical";
export type LayoutSizingMode = "equal" | "custom";
export type AssemblyCalloutLevel = "assembly" | "subassembly";
export type AssemblyCalloutType = "column" | "door" | "lite" | "transom" | "door-leaf";
export type MemberRole =
  | "left-jamb"
  | "right-jamb"
  | "vertical-mullion"
  | "door-jamb"
  | "head"
  | "sill"
  | "horizontal-mullion";

export interface MeasurementSet {
  widthBottom: Inches;
  widthCenter: Inches;
  widthTop: Inches;
  heightLeft: Inches;
  heightCenter: Inches;
  heightRight: Inches;
}

export interface GoverningDimensions {
  openingWidthMeasured: Inches;
  openingHeightMeasured: Inches;
  governingWidthSource: keyof Pick<MeasurementSet, "widthBottom" | "widthCenter" | "widthTop">;
  governingHeightSource: keyof Pick<MeasurementSet, "heightLeft" | "heightCenter" | "heightRight">;
}

export interface DoorConfig {
  hasDoor: boolean;
  doorType: DoorType;
  widthPerLeaf: Inches;
  height: Inches;
  locationMode: DoorLocationMode;
  columnIndex: number | null;
  rowPlacement: DoorRowPlacement;
  swing: DoorSwing;
  hingeType: HingeType;
  hardwareNoteIds: string[];
  thresholdNoteId: string;
  doorSetCount: number;
  doorSets: DoorSetConfig[];
}

export interface DoorSetConfig {
  id: string;
  rowIndex: number;
  doorType: Exclude<DoorType, "none">;
  widthPerLeaf: Inches;
  height: Inches;
  locationMode: DoorLocationMode;
  columnIndex: number | null;
  swing: DoorSwing;
  hingeType: HingeType;
  hardwareNoteIds: string[];
  thresholdNoteId: string;
}

export interface FinishConfig {
  finishId: string;
  finishLabel: string;
}

export interface GlassConfig {
  glassTypeId: string;
  glassTypeLabel: string;
}

export interface Job {
  id: string;
  name: string;
  number: string;
  customer: string;
  createdBy: string;
  dateCreated: string;
  logoId: string;
  activeRevision: string;
  activeElevationId?: string;
  status: JobStatus;
  archivedAt?: string;
  elevationIds: string[];
}

export interface ElevationInput {
  id: string;
  jobId: string;
  name: string;
  measurementSet: MeasurementSet;
  projectType: ProjectType;
  rows: number;
  columns: number;
  rowSizingMode: LayoutSizingMode;
  columnSizingMode: LayoutSizingMode;
  rowHeights: Inches[];
  columnWidths: Inches[];
  doorConfig: DoorConfig;
  finishConfig: FinishConfig;
  glassConfig: GlassConfig;
  systemRulePackId: string;
  assemblyType: string;
}

export interface Elevation extends ElevationInput {
  governingWidth: Inches;
  governingHeight: Inches;
  computedGeometry: ComputedGeometry;
  computedGlass: ComputedGlass;
  validationFlags: ValidationFlag[];
  currentRevisionId: string;
  pdfArtifacts: PdfArtifact[];
}

export interface ComputedGeometry {
  frameWidth: Inches;
  frameHeight: Inches;
  openingWidthMeasured: Inches;
  openingHeightMeasured: Inches;
  subsillType: string;
  subsillHeight: Inches;
  subsillWidth: Inches;
  perimeterJoints: PerimeterJoints;
  sightlines: SightlineConfig;
  rowHeights: Inches[];
  columnWidths: Inches[];
  bays: Bay[];
  members: MemberSegment[];
  lites: Lite[];
  transoms: Transom[];
  doorOpenings: DoorOpening[];
  assemblyCallouts: AssemblyCallout[];
  dimensions: DimensionLine[];
  notes: string[];
  memberCalcs: MemberCalcs;
}

export interface PerimeterJoints {
  head: Inches;
  sill: Inches;
  leftJamb: Inches;
  rightJamb: Inches;
}

export interface Bay {
  id: string;
  rowIndex: number;
  columnIndex: number;
  type: BayType;
  x: Inches;
  y: Inches;
  width: Inches;
  height: Inches;
  label: string;
}

export interface Lite {
  id: string;
  rowIndex: number;
  columnIndex: number;
  type: LiteType;
  bayId: string;
  width: Inches;
  height: Inches;
  dloX: Inches;
  dloY: Inches;
  dloWidth: Inches;
  dloHeight: Inches;
  glassWidth: Inches;
  glassHeight: Inches;
  safetyGlazingLikely: boolean;
  quantity: number;
  mark: string;
}

export interface Transom {
  id: string;
  liteId: string;
  aboveDoorId: string;
  width: Inches;
  height: Inches;
}

export interface DoorOpening {
  id: string;
  type: Exclude<DoorType, "none">;
  columnIndex: number;
  x: Inches;
  y: Inches;
  width: Inches;
  height: Inches;
  leafCount: number;
  widthPerLeaf: Inches;
  swing: DoorSwing;
  hingeType: HingeType;
  locationMode: DoorLocationMode;
  clearWidthAdvisory: Inches;
}

export interface AssemblyCallout {
  id: string;
  mark: string;
  level: AssemblyCalloutLevel;
  type: AssemblyCalloutType;
  elementId: string;
  parentMark?: string;
  x: Inches;
  y: Inches;
}

export interface DimensionLine {
  id: string;
  label: string;
  value: Inches;
  orientation: DimensionOrientation;
  from: Inches;
  to: Inches;
  offset: Inches;
}

export interface MemberSegment {
  id: string;
  role: MemberRole;
  x: Inches;
  y: Inches;
  width: Inches;
  height: Inches;
}

export interface MemberCalcs {
  mullionHeight: Inches;
  typicalHorizontalLength: Inches;
  typicalHorizontalGlassStopLength: Inches;
  leftSideliteSubsillWidth: Inches;
  rightSideliteSubsillWidth: Inches;
  doorJambHeight: Inches;
}

export interface ComputedGlass {
  items: GlassItem[];
}

export interface GlassItem {
  liteId: string;
  mark: string;
  location: string;
  qty: number;
  width: Inches;
  height: Inches;
  glassType: string;
  safetyGlazingLikely: boolean;
  sourceType: "storefront-lite" | "door-lite";
}

export interface ValidationFlag {
  id: string;
  code: string;
  severity: ValidationSeverity;
  message: string;
  affectedElementId?: string;
  recommendation: string;
}

export interface Revision {
  id: string;
  elevationId: string;
  number: string;
  timestamp: string;
  snapshot: ElevationSnapshot;
  pdfArtifactIds: string[];
}

export interface ElevationSnapshot {
  input: ElevationInput;
  governingWidth: Inches;
  governingHeight: Inches;
  computedGeometry: ComputedGeometry;
  computedGlass: ComputedGlass;
  validationFlags: ValidationFlag[];
}

export interface PdfArtifact {
  id: string;
  elevationId: string;
  revisionId: string;
  type: "elevation" | "glass-takeoff" | "package";
  fileName: string;
  createdAt: string;
  objectUrl?: string;
}

export interface StorefrontRulePack {
  id: string;
  name: string;
  systemName: string;
  version: string;
  nominalFaceWidth: Inches;
  sightlines: SightlineConfig;
  nominalDepth: Inches;
  centerSet: boolean;
  typicalInfillThickness: Inches;
  defaultAssemblyType: string;
  assemblyTypes: string[];
  perimeterJoints: PerimeterJoints;
  subsillOptions: Record<string, { label: string; height: Inches }>;
  defaultSubsillId: string;
  entranceSideliteSubsillAdd: Inches;
  dloDeduct: {
    width: Inches;
    height: Inches;
  };
  glassBite?: {
    leftJamb: Inches;
    rightJamb: Inches;
    verticalMullion: Inches;
    doorJamb: Inches;
    head: Inches;
    sill: Inches;
    horizontalMullion: Inches;
  };
  glassAdd: {
    width: Inches;
    height: Inches;
  };
  memberRules: {
    horizontalGlassStopDeduct: Inches;
  };
  transom: {
    minimumHeight: Inches;
  };
  advisoryThresholds: {
    simpleRulePackMaxWidth: Inches;
    simpleRulePackMaxHeight: Inches;
    expansionVerticalWidth: Inches;
  };
  notes: string[];
}

export interface SightlineConfig {
  leftJamb: Inches;
  rightJamb: Inches;
  verticalMullion: Inches;
  doorJamb: Inches;
  head: Inches;
  sill: Inches;
  horizontalMullion: Inches;
}

export interface EntranceRulePack {
  id: string;
  name: string;
  version: string;
  defaultLeafWidth: Inches;
  defaultPairLeafWidth: Inches;
  defaultDoorHeight: Inches;
  bottomRailMinimum: Inches;
  assumedClearWidthDeduct: Inches;
  supportedSwings: DoorSwing[];
  supportedHingeTypes: HingeType[];
  hardwareCompatibility: Record<string, string[]>;
  notes: string[];
}

export interface NoteLibrary {
  system: Record<string, string>;
  finish: Record<string, string>;
  glass: Record<string, string>;
  hardware: Record<string, string>;
  threshold: Record<string, string>;
}

export interface ValidationLibrary {
  enabled: boolean;
  messages: Record<
    string,
    {
      enabled: boolean;
      severity: ValidationSeverity;
      message: string;
      recommendation: string;
    }
  >;
}

export interface BrandingConfig {
  id: string;
  companyName: string;
  logoText: string;
  logoPath?: string;
  logoMarkPath?: string;
  addressLine: string;
  phone: string;
  accentColor: string;
}
