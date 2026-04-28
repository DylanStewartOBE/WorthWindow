import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  LayoutGrid,
  Ruler,
  Save,
  Settings,
  Share2,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  defaultBranding,
  defaultEntranceRulePack,
  defaultNoteLibrary,
  defaultStorefrontRulePack,
  defaultValidationLibrary,
  finishOptions,
  glassOptions,
  hardwareOptions,
  thresholdOptions
} from "../config/options";
import { calculateElevation, type CalculationContext } from "../domain/calculate";
import { getDoorLeafVisuals } from "../domain/door";
import { formatFeetInches, formatInches } from "../domain/format";
import { getDoorGlassCalloutMap } from "../domain/glass";
import { getDoorColumnIndex } from "../domain/geometry";
import { createSquaredMeasurementSet } from "../domain/measurements";
import { createRevisionSnapshot, getNextRevisionNumber } from "../domain/revision";
import type {
  BrandingConfig,
  CornerConfig,
  CornerSide,
  DoorConfig,
  DoorSetConfig,
  Elevation,
  ElevationInput,
  EntranceRulePack,
  Job,
  LayoutSizingMode,
  NoteLibrary,
  StorefrontRulePack,
  ValidationLibrary
} from "../domain/types";
import { createBlankElevationInput, createBlankJob, noDoorSeedInput, pairDoorSeedInput, seedJob } from "../data/seed";
import { createRepository } from "../persistence/database";
import {
  downloadBlob,
  generateDrawingPackagePdf,
  generateQuotePdf,
  pdfFileName
} from "../pdf/pdfGenerator";

const steps = [
  { label: "Job", icon: FileText },
  { label: "Measure", icon: Ruler },
  { label: "Layout", icon: LayoutGrid },
  { label: "Door", icon: DoorOpen },
  { label: "Product", icon: SlidersHorizontal },
  { label: "Review", icon: ClipboardCheck },
  { label: "Output", icon: FileDown }
];

type ConfigState = {
  storefrontRulePack: StorefrontRulePack;
  entranceRulePack: EntranceRulePack;
  noteLibrary: NoteLibrary;
  validationLibrary: ValidationLibrary;
  branding: BrandingConfig;
};

type LayoutAxis = "row" | "column";
type JobSetupMode = "new" | "existing";

type CustomSizingFieldState = {
  disabled: boolean;
  helperText: string;
  index: number;
  label: string;
  placeholder: string;
  resolvedValue: number;
  status: "door" | "driven" | "manual";
  value: number | null;
};

type AssemblySelectionType = "column" | "door";
type PreviewMode = "elevation" | "plan";

type AssemblyRegion = {
  mark: string;
  type: AssemblySelectionType;
  x: number;
  y: number;
  width: number;
  height: number;
};

type CornerPlanContext = {
  primaryElevation: Elevation;
  returnElevation: Elevation | null;
  side: CornerSide;
  angle: number;
  cornerSightline: number;
  activeElevationId: string;
};

const initialConfig: ConfigState = {
  storefrontRulePack: defaultStorefrontRulePack,
  entranceRulePack: defaultEntranceRulePack,
  noteLibrary: defaultNoteLibrary,
  validationLibrary: defaultValidationLibrary,
  branding: defaultBranding
};

const defaultCornerConfig: CornerConfig = {
  hasCorner: false,
  side: "right",
  angle: 90
};

export function App() {
  const [activeStep, setActiveStep] = useState(0);
  const [job, setJob] = useState<Job>(seedJob);
  const [input, setInput] = useState<ElevationInput>(pairDoorSeedInput);
  const [config, setConfig] = useState<ConfigState>(initialConfig);
  const [jobSetupMode, setJobSetupMode] = useState<JobSetupMode>("new");
  const [savedJobs, setSavedJobs] = useState<Job[]>([]);
  const [savedElevations, setSavedElevations] = useState<Elevation[]>([]);
  const [, setStatus] = useState("Ready offline");
  const [adminMode, setAdminMode] = useState(() => isAdminModeEnabled());
  const [adminOpen, setAdminOpen] = useState(false);
  const [pdfUrls, setPdfUrls] = useState<{ package?: string; quote?: string }>({});
  const [activeDoorSetIndex, setActiveDoorSetIndex] = useState(0);
  const [showAssemblyNumbers, setShowAssemblyNumbers] = useState(false);
  const [selectedAssemblyMark, setSelectedAssemblyMark] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("elevation");
  const stepperRef = useRef<HTMLElement | null>(null);

  const repository = useMemo(() => createRepository(), []);
  const calculationContext: CalculationContext = useMemo(
    () => ({
      storefrontRulePack: config.storefrontRulePack,
      entranceRulePack: config.entranceRulePack,
      noteLibrary: config.noteLibrary,
      validationLibrary: config.validationLibrary
    }),
    [config]
  );
  const elevation = useMemo(() => calculateElevation(input, calculationContext), [input, calculationContext]);
  const jobElevations = useMemo(() => {
    const currentElevation = input.jobId === job.id ? elevation : null;
    const matchingElevations = savedElevations.filter((item) => item.jobId === job.id);
    const merged = uniqueById(currentElevation ? [...matchingElevations, currentElevation] : matchingElevations);
    const order = new Map(job.elevationIds.map((id, index) => [id, index]));
    return merged.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) || a.name.localeCompare(b.name));
  }, [elevation, input.jobId, job, savedElevations]);
  const cornerPlan = useMemo(
    () => getCornerPlanContext(jobElevations, elevation, config.storefrontRulePack),
    [config.storefrontRulePack, elevation, jobElevations]
  );
  const activeJobs = useMemo(() => savedJobs.filter((savedJob) => normalizeJob(savedJob).status !== "archived"), [savedJobs]);
  const archivedJobs = useMemo(() => savedJobs.filter((savedJob) => normalizeJob(savedJob).status === "archived"), [savedJobs]);

  useEffect(() => {
    Promise.all([repository.getJobs(), repository.getElevations()])
      .then(([jobs, elevations]) => {
        const normalizedJobs = jobs.map(normalizeJob);
        if (jobs.length > 0) {
          setSavedJobs(normalizedJobs);
        }
        if (elevations.length > 0) {
          const firstElevation = elevations[0];
          const firstJob = normalizedJobs.find((item) => item.id === firstElevation.jobId) ?? normalizedJobs[0] ?? seedJob;
          const firstJobElevation =
            elevations.find((item) => item.id === firstJob.activeElevationId) ??
            elevations.find((item) => item.jobId === firstJob.id) ??
            firstElevation;
          setSavedElevations(elevations);
          setJob(firstJob);
          setInput(toInput(firstJobElevation));
          setJobSetupMode("existing");
          setStatus("Loaded local job");
        }
      })
      .catch(() => setStatus("Using in-memory seed data"));
  }, [repository]);

  useEffect(() => {
    stepperRef.current
      ?.querySelector<HTMLElement>(".step.active")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeStep]);

  useEffect(() => {
    const openAdminShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setAdminMode(true);
        setAdminOpen(true);
      }
    };

    window.addEventListener("keydown", openAdminShortcut);
    return () => window.removeEventListener("keydown", openAdminShortcut);
  }, []);

  useEffect(() => {
    setActiveDoorSetIndex((index) => clampIndex(index, Math.max(getDoorSetCount(input.doorConfig, input.columns), 1)));
  }, [input.doorConfig, input.columns]);

  useEffect(() => {
    if (activeStep === 3 && input.doorConfig.hasDoor) {
      setSelectedAssemblyMark(`DA${clampIndex(activeDoorSetIndex, Math.max(getDoorSetCount(input.doorConfig, input.columns), 1)) + 1}`);
      return;
    }
    if (activeStep === 2 && (!selectedAssemblyMark || !selectedAssemblyMark.startsWith("A"))) {
      setSelectedAssemblyMark("A1");
    }
  }, [activeStep, activeDoorSetIndex, input.doorConfig, input.columns, selectedAssemblyMark]);

  const selectAssembly = (mark: string, type: AssemblySelectionType) => {
    setSelectedAssemblyMark(mark);
    if (type === "door") {
      const doorIndex = clampIndex(
        Math.max(Number(mark.replace("DA", "")) - 1, 0),
        Math.max(getDoorSetCount(input.doorConfig, input.columns), 1)
      );
      setActiveDoorSetIndex(doorIndex);
      setActiveStep(3);
      return;
    }
    setActiveStep(2);
  };

  const updateJob = <K extends keyof Job>(key: K, value: Job[K]) => {
    setJob((current) => ({ ...current, [key]: value }));
  };

  const saveJobState = (nextJob: Job, statusMessage: string) => {
    const normalized = normalizeJob(nextJob);
    setJob(normalized);
    setSavedJobs((current) => uniqueById([...current.map(normalizeJob), normalized]));
    repository.saveJob(normalized).catch(() => setStatus("Job changes are in memory until local storage is available"));
    setStatus(statusMessage);
  };

  const startNewJob = () => {
    const nextJob = createBlankJob(job.createdBy || "Dylan Stewart");
    const nextInput = createBlankElevationInput(nextJob.id, nextJob.createdBy);
    const jobWithElevation = normalizeJob({ ...nextJob, activeElevationId: nextInput.id, elevationIds: [nextInput.id] });
    setJob(jobWithElevation);
    setInput(nextInput);
    setJobSetupMode("new");
    setPdfUrls({});
    setSavedJobs((current) => uniqueById([...current.map(normalizeJob), jobWithElevation]));
    repository.saveJob(jobWithElevation).catch(() => setStatus("New job is in memory until local storage is available"));
    setStatus("Started new job");
  };

  const loadExistingJob = (jobId: string) => {
    const nextJob = savedJobs.map(normalizeJob).find((item) => item.id === jobId);
    if (!nextJob) return;
    const nextElevation =
      savedElevations.find((item) => item.id === nextJob.activeElevationId) ??
      savedElevations.find((item) => item.jobId === nextJob.id);
    setJob(nextJob);
    if (nextElevation) {
      setInput(toInput(nextElevation));
    } else {
      setInput(createBlankElevationInput(nextJob.id, nextJob.createdBy));
    }
    setJobSetupMode("existing");
    setPdfUrls({});
    setStatus(`Loaded ${nextJob.name || "existing job"}`);
  };

  const createElevationForJob = () => {
    const template = getFirstElevationTemplate(job, savedElevations, input);
    const nextInput = inheritHorizontalPattern(
      createBlankElevationInput(job.id, job.createdBy || "Dylan Stewart"),
      template,
      { name: "Field elevation" }
    );
    const nextJob = normalizeJob({ ...job, activeElevationId: nextInput.id, status: "active", elevationIds: unique([...job.elevationIds, nextInput.id]) });
    setJob(nextJob);
    setInput(nextInput);
    setPdfUrls({});
    setSavedJobs((current) => uniqueById([...current.map(normalizeJob), nextJob]));
    repository.saveJob(nextJob).catch(() => setStatus("Elevation is in memory until local storage is available"));
    setStatus("Started new elevation for this job");
  };

  const loadJobElevation = (elevationId: string) => {
    if (elevationId === input.id) return;
    const nextElevation = savedElevations.find((item) => item.id === elevationId);
    if (!nextElevation) return;
    const nextJob = normalizeJob({ ...job, activeElevationId: elevationId });
    setInput(toInput(nextElevation));
    saveJobState(nextJob, `Loaded ${nextElevation.name}`);
    setPdfUrls({});
  };

  const selectElevationFromPlan = (elevationId: string) => {
    loadJobElevation(elevationId);
    setPreviewMode("elevation");
    setActiveStep(2);
  };

  const archiveCurrentJob = () => {
    saveJobState({ ...job, status: "archived", archivedAt: new Date().toISOString() }, "Archived current job");
    setJobSetupMode("existing");
  };

  const restoreJob = (jobId: string) => {
    const archivedJob = savedJobs.map(normalizeJob).find((item) => item.id === jobId);
    if (!archivedJob) return;
    const restoredJob = normalizeJob({ ...archivedJob, status: "active", archivedAt: undefined });
    saveJobState(restoredJob, `Restored ${restoredJob.name || "job"}`);
    const restoredElevation =
      savedElevations.find((item) => item.id === restoredJob.activeElevationId) ??
      savedElevations.find((item) => item.jobId === restoredJob.id);
    if (restoredElevation) {
      setInput(toInput(restoredElevation));
    }
    setJobSetupMode("existing");
  };

  const updateInput = (patch: Partial<ElevationInput>) => {
    setInput((current) => normalizeLayoutSizingInput({ ...current, ...patch }));
  };

  const updateOpeningSize = (axis: "width" | "height", value: number) => {
    setInput((current) => ({
      ...current,
      measurementSet: createSquaredMeasurementSet(
        axis === "width" ? value : current.measurementSet.widthCenter,
        axis === "height" ? value : current.measurementSet.heightCenter
      )
    }));
  };

  const updateDoor = (patch: Partial<DoorConfig>) => {
    setInput((current) =>
      normalizeLayoutSizingInput({
        ...current,
        doorConfig: normalizeDoorConfig({ ...current.doorConfig, ...patch }, current.rows, current.columns)
      })
    );
  };

  const updateCorner = (patch: Partial<CornerConfig>) => {
    const nextCorner = normalizeCornerConfig({ ...input.cornerConfig, ...patch });

    if (!nextCorner.hasCorner) {
      const nextInput = normalizeLayoutSizingInput({ ...input, cornerConfig: { ...nextCorner, linkedElevationId: undefined } });
      const calculated = calculateElevation(nextInput, calculationContext);
      setInput(nextInput);
      setSavedElevations((current) => uniqueById([...current, calculated]));
      repository.saveElevation(calculated).catch(() => setStatus("Corner change is in memory until local storage is available"));
      setPreviewMode("elevation");
      setStatus("Corner removed from this elevation");
      return;
    }

    const linkedElevationId = nextCorner.linkedElevationId ?? createId("elev");
    const nextInput = normalizeLayoutSizingInput({
      ...input,
      cornerConfig: {
        ...nextCorner,
        hasCorner: true,
        angle: 90,
        linkedElevationId
      }
    });
    const calculatedCurrent = calculateElevation(nextInput, calculationContext);
    const existingReturn = savedElevations.find((item) => item.id === linkedElevationId);
    const returnInput = normalizeLayoutSizingInput(
      inheritHorizontalPattern(
        existingReturn
          ? toInput(existingReturn)
          : createCornerReturnElevationInput(
              nextInput,
              linkedElevationId,
              calculatedCurrent.computedGeometry.frameHeight,
              config.storefrontRulePack
            ),
        nextInput,
        {
          cornerConfig: {
            hasCorner: true,
            side: oppositeCornerSide(nextInput.cornerConfig.side),
            angle: 90,
            linkedElevationId: nextInput.id
          }
        }
      )
    );
    const calculatedReturn = calculateElevation(returnInput, calculationContext);
    const nextJob = normalizeJob({
      ...job,
      activeElevationId: nextInput.id,
      status: "active",
      elevationIds: unique([...job.elevationIds, nextInput.id, returnInput.id])
    });

    setInput(nextInput);
    setJob(nextJob);
    setSavedJobs((current) => uniqueById([...current.map(normalizeJob), nextJob]));
    setSavedElevations((current) => uniqueById([...current, calculatedCurrent, calculatedReturn]));
    repository.saveJob(nextJob).catch(() => setStatus("Corner job update is in memory until local storage is available"));
    repository.saveElevation(calculatedCurrent).catch(() => setStatus("Corner elevation is in memory until local storage is available"));
    repository.saveElevation(calculatedReturn).catch(() => setStatus("Corner return is in memory until local storage is available"));
    setPreviewMode("plan");
    setStatus(`${titleCase(nextInput.cornerConfig.side)} corner return added`);
  };

  const updateDoorSetCount = (value: number) => {
    setInput((current) => {
      const count = clampDoorSetCount(value, current.columns);
      const doorConfig =
        count === 0
          ? normalizeDoorConfig({ ...current.doorConfig, hasDoor: false, doorType: "none", doorSetCount: 0, doorSets: [] }, current.rows, current.columns)
          : normalizeDoorConfig(
              {
                ...current.doorConfig,
                hasDoor: true,
                doorType: current.doorConfig.doorType === "none" ? "single" : current.doorConfig.doorType,
                doorSetCount: count
              },
              current.rows,
              current.columns
            );
      setActiveDoorSetIndex((index) => clampIndex(index, Math.max(count, 1)));
      return normalizeLayoutSizingInput({ ...current, doorConfig });
    });
  };

  const updateDoorSet = (index: number, patch: Partial<DoorSetConfig>) => {
    setInput((current) => {
      const doorConfig = normalizeDoorConfig(current.doorConfig, current.rows, current.columns);
      const doorSets = getDoorSets(doorConfig, current.rows, current.columns);
      const nextDoorSets = doorSets.map((doorSet, doorSetIndex) =>
        doorSetIndex === index ? { ...doorSet, ...patch } : doorSet
      );
      return normalizeLayoutSizingInput({
        ...current,
        doorConfig: normalizeDoorConfig(
          {
            ...doorConfig,
            hasDoor: true,
            doorSetCount: Math.max(doorConfig.doorSetCount, index + 1),
            doorSets: nextDoorSets
          },
          current.rows,
          current.columns
        )
      });
    });
  };

  const updateLayoutCount = (axis: "rows" | "columns", value: number) => {
    setInput((current) => {
      const count = Math.max(1, Math.round(value));
      if (axis === "columns") {
        const nextInput = {
          ...current,
          columns: count,
          columnWidths: resizeCustomSizingInputs(current.columnWidths, count),
          doorConfig: normalizeDoorConfig(current.doorConfig, current.rows, count)
        };
        return normalizeLayoutSizingInput(nextInput);
      }

      return normalizeLayoutSizingInput({
        ...current,
        rows: count,
        rowHeights: resizeCustomSizingInputs(current.rowHeights, count),
        doorConfig: normalizeDoorConfig(current.doorConfig, count, current.columns)
      });
    });
  };

  const updateSizingMode = (axis: LayoutAxis, mode: LayoutSizingMode) => {
    setInput((current) => {
      const nextInput = {
        ...current,
        rowSizingMode: axis === "row" ? mode : current.rowSizingMode,
        columnSizingMode: axis === "column" ? mode : current.columnSizingMode,
        rowHeights:
          axis === "row"
            ? mode === "custom" && current.rowSizingMode !== "custom"
              ? prepareSizingInputsForCustom(current.rowHeights, current.rows)
              : resizeCustomSizingInputs(current.rowHeights, current.rows)
            : current.rowHeights,
        columnWidths:
          axis === "column"
            ? mode === "custom" && current.columnSizingMode !== "custom"
              ? prepareSizingInputsForCustom(current.columnWidths, current.columns)
              : resizeCustomSizingInputs(current.columnWidths, current.columns)
            : current.columnWidths
      };
      return normalizeLayoutSizingInput(nextInput);
    });
  };

  const updateCustomSize = (axis: LayoutAxis, index: number, value: number | null) => {
    setInput((current) => {
      const count = axis === "row" ? current.rows : current.columns;
      const currentSizes = axis === "row" ? current.rowHeights : current.columnWidths;
      const nextSizes = resizeCustomSizingInputs(currentSizes, count).map((size, sizeIndex) =>
        sizeIndex === index ? sanitizeCustomSizingValue(value) : size
      );
      const nextInput = {
        ...current,
        rowHeights: axis === "row" ? nextSizes : current.rowHeights,
        columnWidths: axis === "column" ? nextSizes : current.columnWidths
      };
      return normalizeLayoutSizingInput(nextInput, axis, index);
    });
  };

  const snapDoorLocation = (locationMode: DoorConfig["locationMode"]) => {
    setInput((current) => {
      const columnIndex = getDoorColumnIndex(current.columns, locationMode);
      return normalizeLayoutSizingInput({
        ...current,
        doorConfig: {
          ...current.doorConfig,
          locationMode,
          columnIndex
        }
      });
    });
  };

  const shiftDoorColumn = (delta: number) => {
    setInput((current) => {
      const nextIndex = clampIndex(
        (current.doorConfig.columnIndex ?? getDoorColumnIndex(current.columns, current.doorConfig.locationMode)) + delta,
        current.columns
      );
      return normalizeLayoutSizingInput({
        ...current,
        doorConfig: {
          ...current.doorConfig,
          columnIndex: nextIndex,
          locationMode: getLocationModeForColumn(nextIndex, current.columns)
        }
      });
    });
  };

  const saveRevision = async () => {
    const existingRevisions = await repository.getRevisions(input.id).catch(() => []);
    const nextRevision = getNextRevisionNumber(existingRevisions);
    const calculated = { ...elevation, currentRevisionId: nextRevision };
    const revision = createRevisionSnapshot(calculated, nextRevision);
    const nextJob = normalizeJob({
      ...job,
      activeRevision: nextRevision,
      activeElevationId: input.id,
      status: "active",
      elevationIds: unique([...job.elevationIds, input.id])
    });
    await repository.saveJob(nextJob);
    await repository.saveElevation(calculated);
    await repository.saveRevision(revision);
    setJob(nextJob);
    setSavedJobs((current) => uniqueById([...current, nextJob]));
    setSavedElevations((current) => uniqueById([...current, calculated]));
    setStatus(`Saved revision ${nextRevision}`);
  };

  const generatePdfs = () => {
    const packageBlob = generateDrawingPackagePdf(elevation, job, config.branding, { showAssemblyNumbers });
    const packageUrl = downloadBlob(packageBlob, pdfFileName(job, elevation, "package"));
    setPdfUrls((current) => ({ ...current, package: packageUrl }));
    setStatus("PDF package generated");
  };

  const generateQuote = () => {
    const quoteBlob = generateQuotePdf(elevation, job, config.branding);
    const quoteUrl = downloadBlob(quoteBlob, pdfFileName(job, elevation, "quote"));
    setPdfUrls((current) => ({ ...current, quote: quoteUrl }));
    setStatus("Customer quote generated");
  };

  const sharePackage = async () => {
    const packageBlob = generateDrawingPackagePdf(elevation, job, config.branding, { showAssemblyNumbers });
    const files = [
      new File([packageBlob], pdfFileName(job, elevation, "package"), { type: "application/pdf" })
    ];

    if ("canShare" in navigator && navigator.canShare?.({ files })) {
      await navigator.share({ title: `${job.number} ${elevation.name}`, files });
      setStatus("Shared PDF package");
    } else {
      generatePdfs();
    }
  };

  const loadSample = (sample: ElevationInput) => {
    setJob(normalizeJob(seedJob));
    setInput(normalizeLayoutSizingInput(sample));
    setJobSetupMode("existing");
    setActiveStep(5);
    setStatus(`Loaded ${sample.name}`);
  };

  const duplicateElevation = () => {
    const nextId = `elev-${crypto.randomUUID?.() ?? Date.now()}`;
    setInput((current) => ({ ...current, id: nextId, name: `${current.name} copy`, jobId: job.id }));
    setJob((current) => normalizeJob({ ...current, activeElevationId: nextId, elevationIds: unique([...current.elevationIds, nextId]) }));
    setStatus("Duplicated current elevation");
  };

  return (
    <main className="app-shell">
      <div className="sticky-controls">
        <a
          className="brand-lockup"
          href="https://www.worthcon.com"
          target="_blank"
          rel="noreferrer"
          aria-label={`${config.branding.companyName} website`}
        >
          <img
            className="brand-logo-full"
            src={config.branding.logoPath ?? "/brand/worthcon.svg"}
            alt={config.branding.companyName}
          />
          <img
            className="brand-logo-mark"
            src={config.branding.logoMarkPath ?? "/brand/worthcon-w.svg"}
            alt={config.branding.companyName}
          />
        </a>
        <nav className="stepper" ref={stepperRef} aria-label="Wizard steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <button
                key={step.label}
                className={index === activeStep ? "step active" : index < activeStep ? "step complete" : "step"}
                onClick={() => setActiveStep(index)}
              >
                <Icon size={16} />
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>
        {adminMode && (
          <button className="icon-button" onClick={() => setAdminOpen((open) => !open)} aria-label="Open admin config">
            <Settings size={20} />
          </button>
        )}
      </div>

      <section className="workspace">
        <div className="work-panel">
          {activeStep === 0 && (
            <JobStep
              job={job}
              jobSetupMode={jobSetupMode}
              setJobSetupMode={setJobSetupMode}
              activeJobs={activeJobs}
              archivedJobs={archivedJobs}
              jobElevations={jobElevations}
              activeElevationId={input.id}
              updateJob={updateJob}
              input={input}
              updateInput={updateInput}
              onStartNewJob={startNewJob}
              onLoadJob={loadExistingJob}
              onCreateElevation={createElevationForJob}
              onLoadElevation={loadJobElevation}
              onArchiveJob={archiveCurrentJob}
              onRestoreJob={restoreJob}
            />
          )}
          {activeStep === 1 && (
            <MeasureStep input={input} updateOpeningSize={updateOpeningSize} updateInput={updateInput} elevation={elevation} />
          )}
          {activeStep === 2 && (
            <LayoutStep
              input={input}
              elevation={elevation}
              updateLayoutCount={updateLayoutCount}
              updateDoorSetCount={updateDoorSetCount}
              updateSizingMode={updateSizingMode}
              updateCustomSize={updateCustomSize}
              updateDoor={updateDoor}
              updateCorner={updateCorner}
              cornerSightline={getCornerMullionSightline(config.storefrontRulePack)}
              onShowFloorPlan={() => setPreviewMode("plan")}
              onSelectColumnAssembly={(columnIndex) => setSelectedAssemblyMark(`A${columnIndex + 1}`)}
            />
          )}
          {activeStep === 3 && (
            <DoorStep
              input={input}
              activeDoorSetIndex={activeDoorSetIndex}
              setActiveDoorSetIndex={(index) => {
                setActiveDoorSetIndex(index);
                setSelectedAssemblyMark(`DA${index + 1}`);
              }}
              updateDoorSet={updateDoorSet}
              updateDoorSetCount={updateDoorSetCount}
            />
          )}
          {activeStep === 4 && (
            <ProductStep
              input={input}
              updateInput={updateInput}
              storefrontRulePack={config.storefrontRulePack}
            />
          )}
          {activeStep === 5 && (
            <ReviewStep
              elevation={elevation}
              showAssemblyNumbers={showAssemblyNumbers}
              setShowAssemblyNumbers={setShowAssemblyNumbers}
            />
          )}
          {activeStep === 6 && (
            <OutputStep
              elevation={elevation}
              job={job}
              pdfUrls={pdfUrls}
              onGenerate={generatePdfs}
              onGenerateQuote={generateQuote}
              onShare={sharePackage}
              onSave={saveRevision}
              onDuplicate={duplicateElevation}
              onLoadSample={loadSample}
              savedElevations={savedElevations}
            />
          )}
        </div>

        <aside className="preview-panel">
          <ElevationPreview
            elevation={elevation}
            cornerPlan={cornerPlan}
            previewMode={previewMode}
            showAssemblyNumbers={showAssemblyNumbers}
            selectedAssemblyMark={selectedAssemblyMark}
            onSelectAssembly={selectAssembly}
            onSelectElevation={selectElevationFromPlan}
          />
        </aside>
      </section>

      <footer className="nav-actions">
        <button className="secondary-button" onClick={() => setActiveStep((step) => Math.max(step - 1, 0))}>
          <ChevronLeft size={18} />
          Back
        </button>
        <button className="primary-button" onClick={() => setActiveStep((step) => Math.min(step + 1, steps.length - 1))}>
          Next
          <ChevronRight size={18} />
        </button>
      </footer>

      {adminOpen && <AdminPanel config={config} setConfig={setConfig} onClose={() => setAdminOpen(false)} />}
    </main>
  );
}

function JobStep({
  job,
  jobSetupMode,
  setJobSetupMode,
  activeJobs,
  archivedJobs,
  jobElevations,
  activeElevationId,
  updateJob,
  input,
  updateInput,
  onStartNewJob,
  onLoadJob,
  onCreateElevation,
  onLoadElevation,
  onArchiveJob,
  onRestoreJob
}: {
  job: Job;
  jobSetupMode: JobSetupMode;
  setJobSetupMode: (mode: JobSetupMode) => void;
  activeJobs: Job[];
  archivedJobs: Job[];
  jobElevations: Elevation[];
  activeElevationId: string;
  updateJob: <K extends keyof Job>(key: K, value: Job[K]) => void;
  input: ElevationInput;
  updateInput: (patch: Partial<ElevationInput>) => void;
  onStartNewJob: () => void;
  onLoadJob: (jobId: string) => void;
  onCreateElevation: () => void;
  onLoadElevation: (elevationId: string) => void;
  onArchiveJob: () => void;
  onRestoreJob: (jobId: string) => void;
}) {
  return (
    <section className="step-content">
      <SectionTitle title="Job Setup" subtitle="Create a job or open an existing one with multiple elevations" />
      <Segmented
        label="Job"
        value={jobSetupMode}
        options={[
          { value: "new", label: "New" },
          { value: "existing", label: "Existing" }
        ]}
        onChange={(value) => setJobSetupMode(value as JobSetupMode)}
      />

      {jobSetupMode === "new" && (
        <button type="button" className="secondary-button wide job-action" onClick={onStartNewJob}>
          <FileText size={18} />
          Start blank job
        </button>
      )}

      {jobSetupMode === "existing" && (
        activeJobs.length > 0 ? (
          <SelectField
            label="Existing job"
            value={job.id}
            options={activeJobs.map((savedJob) => ({
              id: savedJob.id,
              label: `${savedJob.number || "No number"} - ${savedJob.name || "Untitled job"}`
            }))}
            onChange={onLoadJob}
          />
        ) : (
          <div className="empty-state">No saved jobs yet. Start a new job, then save a revision to keep it available here.</div>
        )
      )}

      <div className="field-grid compact">
        <TextField label="Job name" value={job.name} onChange={(value) => updateJob("name", value)} />
        <TextField label="Job number" value={job.number} onChange={(value) => updateJob("number", value)} />
        <TextField label="Customer" value={job.customer} onChange={(value) => updateJob("customer", value)} />
        <TextField label="Created by" value={job.createdBy} onChange={(value) => updateJob("createdBy", value)} />
        <TextField label="Elevation name" value={input.name} onChange={(value) => updateInput({ name: value })} />
      </div>

      <div className="elevation-hub">
        <div className="elevation-hub-header">
          <strong>Elevations in this job</strong>
          <button type="button" className="text-button" onClick={onCreateElevation}>New elevation</button>
        </div>
        {jobElevations.length === 0 ? (
          <span>No elevations saved for this job yet.</span>
        ) : (
          jobElevations.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`elevation-row ${item.id === activeElevationId ? "selected" : ""}`}
              onClick={() => onLoadElevation(item.id)}
            >
              <span>
                <strong>{index + 1}. {item.name}</strong>
                <small>{formatFeetInches(item.governingWidth)} x {formatFeetInches(item.governingHeight)}</small>
              </span>
              <small>{item.currentRevisionId ? `Rev ${item.currentRevisionId}` : "Working"}</small>
            </button>
          ))
        )}
      </div>

      <div className="job-management">
        <button type="button" className="secondary-button wide" onClick={onArchiveJob}>Archive current job</button>
        {archivedJobs.length > 0 && (
          <SelectField
            label="Restore archived job"
            value=""
            options={[
              { id: "", label: "Select archived job" },
              ...archivedJobs.map((archivedJob) => ({
                id: archivedJob.id,
                label: `${archivedJob.number || "No number"} - ${archivedJob.name || "Untitled job"}`
              }))
            ]}
            onChange={(jobId) => {
              if (jobId) onRestoreJob(jobId);
            }}
          />
        )}
      </div>
    </section>
  );
}

function MeasureStep({
  input,
  updateOpeningSize,
  updateInput,
  elevation
}: {
  input: ElevationInput;
  updateOpeningSize: (axis: "width" | "height", value: number) => void;
  updateInput: (patch: Partial<ElevationInput>) => void;
  elevation: Elevation;
}) {
  return (
    <section className="step-content">
      <SectionTitle title="Opening Measure" subtitle="Squared rough opening for estimating" />
      <div className="field-grid compact">
        <NumberField
          label="Opening width"
          value={input.measurementSet.widthCenter}
          onChange={(value) => updateOpeningSize("width", value)}
        />
        <NumberField
          label="Opening height"
          value={input.measurementSet.heightCenter}
          onChange={(value) => updateOpeningSize("height", value)}
        />
      </div>
      <Segmented
        label="Project type"
        value={input.projectType}
        options={[
          { value: "new", label: "New" },
          { value: "replacement", label: "Replacement" },
          { value: "alteration", label: "Alteration" }
        ]}
        onChange={(value) => updateInput({ projectType: value as ElevationInput["projectType"] })}
      />
      <div className="result-band">
        <strong>Measured opening</strong>
        <span>{formatFeetInches(elevation.governingWidth)} W x {formatFeetInches(elevation.governingHeight)} H</span>
      </div>
    </section>
  );
}

function LayoutStep({
  input,
  elevation,
  updateLayoutCount,
  updateDoorSetCount,
  updateSizingMode,
  updateCustomSize,
  updateDoor,
  updateCorner,
  cornerSightline,
  onShowFloorPlan,
  onSelectColumnAssembly
}: {
  input: ElevationInput;
  elevation: Elevation;
  updateLayoutCount: (axis: "rows" | "columns", value: number) => void;
  updateDoorSetCount: (value: number) => void;
  updateSizingMode: (axis: LayoutAxis, mode: LayoutSizingMode) => void;
  updateCustomSize: (axis: LayoutAxis, index: number, value: number | null) => void;
  updateDoor: (patch: Partial<DoorConfig>) => void;
  updateCorner: (patch: Partial<CornerConfig>) => void;
  cornerSightline: number;
  onShowFloorPlan: () => void;
  onSelectColumnAssembly: (columnIndex: number) => void;
}) {
  const doorColumnIndex =
    input.doorConfig.columnIndex ?? getDoorColumnIndex(input.columns, input.doorConfig.locationMode);
  const columnFields = getCustomSizingFieldStates("column", input, elevation, doorColumnIndex);
  const rowFields = getCustomSizingFieldStates("row", input, elevation, doorColumnIndex);
  const columnManualLimit = getCustomManualLimit("column", input, doorColumnIndex);
  const rowManualLimit = getCustomManualLimit("row", input, doorColumnIndex);

  return (
    <section className="step-content">
      <SectionTitle title="Elevation Layout" subtitle="Rows, columns, and custom bay sizing" />
      <div className="field-grid compact">
        <NumberField label="Rows" value={input.rows} kind="count" min={1} onChange={(value) => updateLayoutCount("rows", value)} />
        <NumberField label="Columns" value={input.columns} kind="count" min={1} onChange={(value) => updateLayoutCount("columns", value)} />
        <NumberField
          label="Door sets"
          value={getDoorSetCount(input.doorConfig, input.columns)}
          kind="count"
          min={0}
          onChange={updateDoorSetCount}
        />
      </div>
      {input.doorConfig.hasDoor && (
        <p className="layout-note">One door set can occupy each left-to-right bay. Door package details live on the Door tab.</p>
      )}
      <Segmented
        label="Corner"
        value={input.cornerConfig.hasCorner ? "yes" : "no"}
        options={[
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" }
        ]}
        onChange={(value) => updateCorner({ hasCorner: value === "yes" })}
      />
      {input.cornerConfig.hasCorner && (
        <>
          <Segmented
            label="Corner side"
            value={input.cornerConfig.side}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" }
            ]}
            onChange={(value) => updateCorner({ side: value as CornerSide, hasCorner: true })}
          />
          <div className="result-band stacked">
            <strong>90 degree corner</strong>
            <span>Corner mullion sightline assumed at {formatInches(cornerSightline)}. The return elevation inherits this job's horizontal pattern.</span>
          </div>
          <button
            type="button"
            className="secondary-button wide"
            onClick={() => {
              if (!input.cornerConfig.linkedElevationId) updateCorner({ hasCorner: true });
              onShowFloorPlan();
            }}
          >
            Show floor plan selector
          </button>
        </>
      )}
      {input.doorConfig.hasDoor && input.rows > 1 && (
        <Segmented
          label="Extra rows"
          value={input.doorConfig.rowPlacement}
          options={[
            { value: "above", label: "Above door" },
            { value: "below", label: "Bottom row" }
          ]}
          onChange={(value) => updateDoor({ rowPlacement: value as DoorConfig["rowPlacement"] })}
        />
      )}
      <Segmented
        label="Column widths"
        value={input.columnSizingMode}
        options={[
          { value: "equal", label: "Equal" },
          { value: "custom", label: "Custom" }
        ]}
        onChange={(value) => updateSizingMode("column", value as LayoutSizingMode)}
      />
      {input.columnSizingMode === "custom" && (
        <>
          <p className="layout-note">
            {getCustomSizingGuidance("column", columnManualLimit, input.columns, input.doorConfig.hasDoor)}
          </p>
          <div className="field-grid compact">
            {columnFields.map((field) => (
              <CustomSizeField
                key={`column-width-${field.index}`}
                label={field.label}
                value={field.value}
                resolvedValue={field.resolvedValue}
                placeholder={field.placeholder}
                status={field.status}
                helperText={field.helperText}
                disabled={field.disabled}
                onFocus={() => onSelectColumnAssembly(field.index)}
                onChange={(value) => updateCustomSize("column", field.index, value)}
              />
            ))}
          </div>
        </>
      )}
      <Segmented
        label="Row heights"
        value={input.rowSizingMode}
        options={[
          { value: "equal", label: "Equal" },
          { value: "custom", label: "Custom" }
        ]}
        onChange={(value) => updateSizingMode("row", value as LayoutSizingMode)}
      />
      {input.rowSizingMode === "custom" && (
        <>
          <p className="layout-note">
            {getCustomSizingGuidance("row", rowManualLimit, input.rows, input.doorConfig.hasDoor, input.doorConfig.rowPlacement)}
          </p>
          <div className="field-grid compact">
            {rowFields.map((field) => (
              <CustomSizeField
                key={`row-height-${field.index}`}
                label={field.label}
                value={field.value}
                resolvedValue={field.resolvedValue}
                placeholder={field.placeholder}
                status={field.status}
                helperText={field.helperText}
                disabled={field.disabled}
                onChange={(value) => updateCustomSize("row", field.index, value)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DoorStep({
  input,
  activeDoorSetIndex,
  setActiveDoorSetIndex,
  updateDoorSet,
  updateDoorSetCount
}: {
  input: ElevationInput;
  activeDoorSetIndex: number;
  setActiveDoorSetIndex: (index: number) => void;
  updateDoorSet: (index: number, patch: Partial<DoorSetConfig>) => void;
  updateDoorSetCount: (value: number) => void;
}) {
  const doorSetCount = getDoorSetCount(input.doorConfig, input.columns);
  const doorSets = getDoorSets(input.doorConfig, input.rows, input.columns);
  const activeIndex = clampIndex(activeDoorSetIndex, Math.max(doorSets.length, 1));
  const activeDoorSet = doorSets[activeIndex];
  const doorColumnIndex =
    activeDoorSet?.columnIndex ?? getDoorColumnIndex(input.columns, activeDoorSet?.locationMode ?? "center");
  const enableDoor = () => updateDoorSetCount(Math.max(doorSetCount, 1));
  const disableDoor = () => updateDoorSetCount(0);
  const updateActiveDoorSet = (patch: Partial<DoorSetConfig>) => updateDoorSet(activeIndex, patch);
  const shiftActiveDoorColumn = (delta: number) => {
    const nextIndex = getNextAvailableDoorColumn(doorSets, activeIndex, doorColumnIndex, delta, input.columns);
    updateActiveDoorSet({
      columnIndex: nextIndex,
      locationMode: getLocationModeForColumn(nextIndex, input.columns)
    });
  };

  return (
    <section className="step-content">
      <SectionTitle title="Door Setup" subtitle="Entrance package and placement" />
      <Segmented
        label="Door"
        value={input.doorConfig.hasDoor ? "yes" : "no"}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" }
        ]}
        onChange={(value) => (value === "yes" ? enableDoor() : disableDoor())}
      />
      {!input.doorConfig.hasDoor && (
        <div className="empty-state">This elevation will generate as fixed storefront lites.</div>
      )}
      {input.doorConfig.hasDoor && activeDoorSet && (
        <>
          <div className="door-set-tabs" role="tablist" aria-label="Door sets">
            {doorSets.map((doorSet, index) => (
              <button
                key={doorSet.id}
                type="button"
                role="tab"
                aria-selected={index === activeIndex}
                className={`door-set-tab ${index === activeIndex ? "selected" : ""}`}
                onClick={() => setActiveDoorSetIndex(index)}
              >
                <span>Door set {index + 1}</span>
                <small>{getDoorColumnLabel(doorSet.columnIndex ?? getDoorColumnIndex(input.columns, doorSet.locationMode), input.columns)}</small>
              </button>
            ))}
          </div>
          {doorSetCount > 1 && (
            <p className="layout-note">Each door set is drawn in its selected bay. The same row and transom logic applies across the entrance line.</p>
          )}
          <Segmented
            label="Door type"
            value={activeDoorSet.doorType}
            options={[
              { value: "single", label: "Single" },
              { value: "pair", label: "Pair" }
            ]}
            onChange={(value) => updateActiveDoorSet({ doorType: value as DoorSetConfig["doorType"] })}
          />
          <div className="column-stepper">
            <span>Door bay</span>
            <div>
              <button type="button" className="icon-button" onClick={() => shiftActiveDoorColumn(-1)} aria-label="Move door left one column">
                <ChevronLeft size={18} />
              </button>
              <strong>Bay {doorColumnIndex + 1} of {input.columns}</strong>
              <button type="button" className="icon-button" onClick={() => shiftActiveDoorColumn(1)} aria-label="Move door right one column">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="field-grid compact">
            <NumberField
              label="Leaf width"
              value={activeDoorSet.widthPerLeaf}
              onChange={(value) => updateActiveDoorSet({ widthPerLeaf: value })}
            />
            <NumberField
              label="Door height"
              value={activeDoorSet.height}
              onChange={(value) => updateActiveDoorSet({ height: value })}
            />
          </div>
          <Segmented
            label="Swing"
            value={activeDoorSet.swing}
            options={[
              { value: "outswing", label: "Outswing" },
              { value: "inswing", label: "Inswing" }
            ]}
            onChange={(value) => updateActiveDoorSet({ swing: value as DoorConfig["swing"] })}
          />
          <SelectField
            label="Hinge type"
            value={activeDoorSet.hingeType}
            options={[
              { id: "butt", label: "Butt hinge" },
              { id: "pivot", label: "Pivot" },
              { id: "continuous-gear", label: "Continuous gear hinge" },
              { id: "center-hung", label: "Center hung" }
            ]}
            onChange={(value) => updateActiveDoorSet({ hingeType: value as DoorConfig["hingeType"] })}
          />
          <CheckboxGroup
            label="Hardware notes"
            selected={activeDoorSet.hardwareNoteIds}
            options={hardwareOptions}
            onChange={(selected) => updateActiveDoorSet({ hardwareNoteIds: selected })}
          />
          <SelectField
            label="Threshold / transition"
            value={activeDoorSet.thresholdNoteId}
            options={thresholdOptions}
            onChange={(value) => updateActiveDoorSet({ thresholdNoteId: value })}
          />
        </>
      )}
    </section>
  );
}

function ProductStep({
  input,
  updateInput,
  storefrontRulePack
}: {
  input: ElevationInput;
  updateInput: (patch: Partial<ElevationInput>) => void;
  storefrontRulePack: StorefrontRulePack;
}) {
  return (
    <section className="step-content">
      <SectionTitle title="Product / Finish" subtitle="Rule pack selections" />
      <SelectField
        label="Finish"
        value={input.finishConfig.finishId}
        options={finishOptions}
        onChange={(value) => {
          const option = finishOptions.find((item) => item.id === value)!;
          updateInput({ finishConfig: { finishId: option.id, finishLabel: option.label } });
        }}
      />
      <SelectField
        label="Glass"
        value={input.glassConfig.glassTypeId}
        options={glassOptions}
        onChange={(value) => {
          const option = glassOptions.find((item) => item.id === value)!;
          updateInput({ glassConfig: { glassTypeId: option.id, glassTypeLabel: option.label } });
        }}
      />
      <SelectField
        label="Assembly type"
        value={input.assemblyType}
        options={storefrontRulePack.assemblyTypes.map((type) => ({ id: type, label: titleCase(type) }))}
        onChange={(value) => updateInput({ assemblyType: value })}
      />
      <div className="result-band">
        <strong>Active rule pack</strong>
        <span>{storefrontRulePack.name}</span>
      </div>
    </section>
  );
}

function ReviewStep({
  elevation,
  showAssemblyNumbers,
  setShowAssemblyNumbers
}: {
  elevation: Elevation;
  showAssemblyNumbers: boolean;
  setShowAssemblyNumbers: (show: boolean) => void;
}) {
  const AssemblyIcon = showAssemblyNumbers ? EyeOff : Eye;

  return (
    <section className="step-content">
      <SectionTitle title="Review / Validation" subtitle="Generation remains available unless geometry is impossible" />
      <div className="metric-grid">
        <Metric label="Frame width" value={formatFeetInches(elevation.computedGeometry.frameWidth)} />
        <Metric label="Frame height" value={formatFeetInches(elevation.computedGeometry.frameHeight)} />
        <Metric label="Lites" value={String(elevation.computedGeometry.lites.length)} />
        <Metric label="Glass rows" value={String(elevation.computedGlass.items.length)} />
      </div>
      <div className="review-actions">
        <button
          type="button"
          className="secondary-button wide"
          aria-pressed={showAssemblyNumbers}
          onClick={() => setShowAssemblyNumbers(!showAssemblyNumbers)}
        >
          <AssemblyIcon size={18} />
          {showAssemblyNumbers ? "Hide Assembly Numbers" : "Show Assembly Numbers"}
        </button>
      </div>
      <ValidationList elevation={elevation} />
    </section>
  );
}

function OutputStep({
  elevation,
  job,
  pdfUrls,
  onGenerate,
  onGenerateQuote,
  onShare,
  onSave,
  onDuplicate,
  onLoadSample,
  savedElevations
}: {
  elevation: Elevation;
  job: Job;
  pdfUrls: { package?: string; quote?: string };
  onGenerate: () => void;
  onGenerateQuote: () => void;
  onShare: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onLoadSample: (sample: ElevationInput) => void;
  savedElevations: Elevation[];
}) {
  return (
    <section className="step-content">
      <SectionTitle title="Output" subtitle="PDF package and revisions" />
      <div className="button-stack">
        <button className="primary-button wide" onClick={onGenerate}>
          <FileDown size={18} />
          Generate PDF package
        </button>
        <button className="secondary-button wide" onClick={onGenerateQuote}>
          <FileText size={18} />
          Generate customer quote
        </button>
        <button className="secondary-button wide" onClick={onShare}>
          <Share2 size={18} />
          Share / export
        </button>
        <button className="secondary-button wide" onClick={onSave}>
          <Save size={18} />
          Save revision
        </button>
        <button className="secondary-button wide" onClick={onDuplicate}>
          <Copy size={18} />
          Duplicate elevation
        </button>
      </div>
      {pdfUrls.package && (
        <div className="result-band stacked">
          <strong>Generated package</strong>
          <a href={pdfUrls.package} target="_blank" rel="noreferrer">{pdfFileName(job, elevation, "package")}</a>
        </div>
      )}
      {pdfUrls.quote && (
        <div className="result-band stacked">
          <strong>Generated quote</strong>
          <a href={pdfUrls.quote} target="_blank" rel="noreferrer">{pdfFileName(job, elevation, "quote")}</a>
        </div>
      )}
      <div className="sample-actions">
        <button className="text-button" onClick={() => onLoadSample(pairDoorSeedInput)}>Load pair-door sample</button>
        <button className="text-button" onClick={() => onLoadSample(noDoorSeedInput)}>Load no-door sample</button>
      </div>
      <div className="revision-list">
        <strong>Local elevations</strong>
        {savedElevations.length === 0 ? <span>No saved revisions yet.</span> : savedElevations.map((item) => <span key={item.id}>{item.name}</span>)}
      </div>
    </section>
  );
}

function ElevationPreview({
  elevation,
  cornerPlan,
  previewMode,
  showAssemblyNumbers,
  selectedAssemblyMark,
  onSelectAssembly,
  onSelectElevation
}: {
  elevation: Elevation;
  cornerPlan: CornerPlanContext | null;
  previewMode: PreviewMode;
  showAssemblyNumbers: boolean;
  selectedAssemblyMark: string | null;
  onSelectAssembly: (mark: string, type: AssemblySelectionType) => void;
  onSelectElevation: (elevationId: string) => void;
}) {
  if (previewMode === "plan" && cornerPlan) {
    return <CornerPlanPreview plan={cornerPlan} onSelectElevation={onSelectElevation} />;
  }

  const geometry = elevation.computedGeometry;
  const viewBox = `-6 -16 ${Math.max(geometry.frameWidth + 12, 1)} ${Math.max(geometry.frameHeight + 22, 1)}`;
  const doorGlassCallouts = getDoorGlassCalloutMap(elevation.computedGlass.items);
  const visibleAssemblyCallouts = geometry.assemblyCallouts.filter((callout) => shouldShowAssemblyCallout(callout, showAssemblyNumbers));
  const mainAssemblyRegions = getMainAssemblyRegions(elevation);
  const selectedRegion = mainAssemblyRegions.find((region) => region.mark === selectedAssemblyMark);
  const handleRegionKeyDown = (event: KeyboardEvent<SVGRectElement>, region: AssemblyRegion) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectAssembly(region.mark, region.type);
    }
  };

  return (
    <section className="drawing-preview">
      <div className="preview-header">
        <strong>Elevation Preview</strong>
        <span>{formatFeetInches(geometry.frameWidth)} x {formatFeetInches(geometry.frameHeight)}</span>
      </div>
      <svg viewBox={viewBox} role="img" aria-label="Computed storefront elevation">
        <rect x="0" y="0" width={geometry.frameWidth} height={geometry.frameHeight} className="svg-frame" />
        {geometry.members.map((member) => (
          <rect
            key={member.id}
            x={member.x}
            y={geometry.frameHeight - member.y - member.height}
            width={member.width}
            height={member.height}
            className="svg-member"
          />
        ))}
        {geometry.lites.map((lite) => (
          <rect
            key={lite.id}
            x={lite.dloX}
            y={geometry.frameHeight - lite.dloY - lite.dloHeight}
            width={lite.dloWidth}
            height={lite.dloHeight}
            className={lite.type === "transom" ? "svg-transom" : "svg-lite"}
          />
        ))}
        {geometry.doorOpenings.map((door, doorIndex) => (
          <g key={door.id}>
            {getDoorLeafVisuals(door).map((leaf) => {
              const innerX = door.x + leaf.glassX;
              const innerY = geometry.frameHeight - door.height + leaf.glassY;
              const callout = doorGlassCallouts[`D${doorIndex + 1}L${leaf.leafIndex + 1}`];
              return (
                <g key={`${door.id}-leaf-${leaf.leafIndex}`}>
                  {leaf.members.map((member) => (
                    <rect
                      key={`${door.id}-leaf-${leaf.leafIndex}-${member.role}`}
                      x={door.x + member.x}
                      y={geometry.frameHeight - door.height + member.y}
                      width={member.width}
                      height={member.height}
                      className="svg-member"
                    />
                  ))}
                  <rect
                    x={innerX}
                    y={innerY}
                    width={leaf.glassWidth}
                    height={leaf.glassHeight}
                    className="svg-door-glass"
                  />
                  {callout && (
                    <text
                      x={innerX + leaf.glassWidth / 2}
                      y={innerY + leaf.glassHeight / 2}
                      className="svg-label"
                      textAnchor="middle"
                    >
                      {callout.mark}
                    </text>
                  )}
                  <line
                    x1={door.x + leaf.guideStartTop.x}
                    y1={geometry.frameHeight - door.height + leaf.guideStartTop.y}
                    x2={door.x + leaf.guideEnd.x}
                    y2={geometry.frameHeight - door.height + leaf.guideEnd.y}
                    className="svg-door-dash"
                  />
                  <line
                    x1={door.x + leaf.guideStartBottom.x}
                    y1={geometry.frameHeight - door.height + leaf.guideStartBottom.y}
                    x2={door.x + leaf.guideEnd.x}
                    y2={geometry.frameHeight - door.height + leaf.guideEnd.y}
                    className="svg-door-dash"
                  />
                </g>
              );
            })}
          </g>
        ))}
        {selectedRegion && (
          <rect
            x={selectedRegion.x}
            y={geometry.frameHeight - selectedRegion.y - selectedRegion.height}
            width={selectedRegion.width}
            height={selectedRegion.height}
            className={`svg-assembly-highlight ${selectedRegion.type}`}
          />
        )}
        {geometry.lites.map((lite) => {
          return (
            <text
              key={lite.id}
              x={lite.dloX + lite.dloWidth / 2}
              y={geometry.frameHeight - lite.dloY - lite.dloHeight / 2}
              className="svg-label"
              textAnchor="middle"
            >
              {lite.mark}
            </text>
          );
        })}
        {mainAssemblyRegions.map((region) => (
          <rect
            key={`hit-${region.mark}`}
            x={region.x}
            y={geometry.frameHeight - region.y - region.height}
            width={region.width}
            height={region.height}
            className="svg-assembly-hit-area"
            role="button"
            tabIndex={0}
            aria-label={`Edit ${region.type === "door" ? "door assembly" : "column assembly"} ${region.mark} area`}
            onClick={() => onSelectAssembly(region.mark, region.type)}
            onKeyDown={(event) => handleRegionKeyDown(event, region)}
          />
        ))}
        {visibleAssemblyCallouts
          .filter((callout) => callout.level === "assembly" && (callout.type === "column" || callout.type === "door"))
          .map((callout) => {
            const type = callout.type as AssemblySelectionType;
            const region: AssemblyRegion = {
              mark: callout.mark,
              type,
              x: callout.x - 9,
              y: callout.y - 4,
              width: 18,
              height: 8
            };
            return (
              <rect
                key={`label-hit-${callout.mark}`}
                x={region.x}
                y={geometry.frameHeight - region.y - region.height}
                width={region.width}
                height={region.height}
                className="svg-assembly-hit-area label-hit"
                role="button"
                tabIndex={0}
                aria-label={`Edit ${type === "door" ? "door assembly" : "column assembly"} ${callout.mark}`}
                onClick={() => onSelectAssembly(callout.mark, type)}
                onKeyDown={(event) => handleRegionKeyDown(event, region)}
              />
            );
          })}
        {visibleAssemblyCallouts.map((callout) => (
          <text
            key={callout.id}
            x={callout.x}
            y={geometry.frameHeight - callout.y}
            className={`svg-assembly-label ${callout.level} ${callout.mark === selectedAssemblyMark ? "selected" : ""}`}
            textAnchor={callout.type === "lite" || callout.type === "transom" ? "start" : "middle"}
          >
            {callout.mark}
          </text>
        ))}
      </svg>
    </section>
  );
}

function CornerPlanPreview({
  plan,
  onSelectElevation
}: {
  plan: CornerPlanContext;
  onSelectElevation: (elevationId: string) => void;
}) {
  const primaryWidth = Math.max(plan.primaryElevation.computedGeometry.frameWidth, 1);
  const returnWidth = Math.max(plan.returnElevation?.computedGeometry.frameWidth ?? primaryWidth * 0.65, 1);
  const profileWidth = Math.max(plan.cornerSightline, 2);
  const padding = Math.max(profileWidth * 4, 18);
  const cornerX = plan.side === "left" ? 0 : primaryWidth;
  const returnX = plan.side === "left" ? -profileWidth : primaryWidth;
  const viewX = plan.side === "left" ? -padding - profileWidth : -padding;
  const viewY = -returnWidth - padding;
  const viewWidth = primaryWidth + padding * 2 + profileWidth;
  const viewHeight = returnWidth + padding * 2 + profileWidth;
  const primaryActive = plan.activeElevationId === plan.primaryElevation.id;
  const returnActive = plan.returnElevation ? plan.activeElevationId === plan.returnElevation.id : false;

  return (
    <section className="drawing-preview">
      <div className="preview-header">
        <strong>Corner Floor Plan</strong>
        <span>{plan.angle} degree {plan.side} return</span>
      </div>
      <svg viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} role="img" aria-label="Corner floor plan selector">
        <line x1={0} y1={profileWidth + 10} x2={primaryWidth} y2={profileWidth + 10} className="svg-plan-datum" />
        <line x1={cornerX} y1={0} x2={cornerX} y2={-returnWidth} className="svg-plan-datum" />
        <rect
          x={0}
          y={0}
          width={primaryWidth}
          height={profileWidth}
          className={`svg-plan-leg ${primaryActive ? "selected" : ""}`}
        />
        <rect
          x={returnX}
          y={-returnWidth}
          width={profileWidth}
          height={returnWidth}
          className={`svg-plan-leg ${returnActive ? "selected" : ""}`}
        />
        <rect
          x={plan.side === "left" ? -profileWidth : primaryWidth}
          y={0}
          width={profileWidth}
          height={profileWidth}
          className="svg-plan-corner"
        />
        <rect
          x={0}
          y={-profileWidth * 1.8}
          width={primaryWidth}
          height={profileWidth * 4}
          className="svg-plan-hit-area"
          role="button"
          tabIndex={0}
          aria-label={`Edit ${plan.primaryElevation.name}`}
          onClick={() => onSelectElevation(plan.primaryElevation.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onSelectElevation(plan.primaryElevation.id);
          }}
        />
        {plan.returnElevation && (
          <rect
            x={returnX - profileWidth * 1.5}
            y={-returnWidth}
            width={profileWidth * 4}
            height={returnWidth}
            className="svg-plan-hit-area"
            role="button"
            tabIndex={0}
            aria-label={`Edit ${plan.returnElevation.name}`}
            onClick={() => onSelectElevation(plan.returnElevation!.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelectElevation(plan.returnElevation!.id);
            }}
          />
        )}
        <text x={primaryWidth / 2} y={-6} className="svg-plan-label" textAnchor="middle">
          {primaryActive ? "Editing " : ""}E1
        </text>
        {plan.returnElevation && (
          <text
            x={plan.side === "left" ? returnX - 7 : returnX + profileWidth + 7}
            y={-returnWidth / 2}
            className="svg-plan-label"
            textAnchor={plan.side === "left" ? "end" : "start"}
          >
            {returnActive ? "Editing " : ""}E2
          </text>
        )}
        <text
          x={plan.side === "left" ? -profileWidth - 4 : primaryWidth + profileWidth + 4}
          y={-6}
          className="svg-plan-corner-label"
          textAnchor={plan.side === "left" ? "end" : "start"}
        >
          Corner {formatInches(plan.cornerSightline)}
        </text>
      </svg>
      <p className="layout-note">Tap a leg to edit that elevation. Horizontal rows stay tied to the first elevation pattern.</p>
    </section>
  );
}

function shouldShowAssemblyCallout(
  callout: Elevation["computedGeometry"]["assemblyCallouts"][number],
  showAssemblyNumbers: boolean
): boolean {
  return callout.level === "assembly" || showAssemblyNumbers;
}

function getMainAssemblyRegions(elevation: Elevation): AssemblyRegion[] {
  const { computedGeometry: geometry } = elevation;
  let runningX = 0;
  const columnRegions = geometry.columnWidths.map((width, index) => {
    const region: AssemblyRegion = {
      mark: `A${index + 1}`,
      type: "column",
      x: runningX,
      y: 0,
      width,
      height: geometry.frameHeight
    };
    runningX += width;
    return region;
  });

  const doorRegions = geometry.doorOpenings.map((door, index) => ({
    mark: `DA${index + 1}`,
    type: "door" as const,
    x: door.x,
    y: door.y,
    width: door.width,
    height: door.height
  }));

  return [...columnRegions, ...doorRegions];
}

function ValidationList({ elevation }: { elevation: Elevation }) {
  if (elevation.validationFlags.length === 0) {
    return <div className="validation empty"><CheckCircle2 size={18} /> No validation warnings.</div>;
  }

  return (
    <div className="validation-list">
      {elevation.validationFlags.map((flag) => (
        <article key={flag.id} className={`validation ${flag.severity}`}>
          <AlertTriangle size={18} />
          <div>
            <strong>{flag.code}</strong>
            <p>{flag.message}</p>
            <span>{flag.recommendation}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function AdminPanel({
  config,
  setConfig,
  onClose
}: {
  config: ConfigState;
  setConfig: (config: ConfigState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    storefrontRulePack: JSON.stringify(config.storefrontRulePack, null, 2),
    entranceRulePack: JSON.stringify(config.entranceRulePack, null, 2),
    noteLibrary: JSON.stringify(config.noteLibrary, null, 2),
    validationLibrary: JSON.stringify(config.validationLibrary, null, 2),
    branding: JSON.stringify(config.branding, null, 2)
  });
  const [error, setError] = useState("");

  const apply = () => {
    try {
      setConfig({
        storefrontRulePack: JSON.parse(draft.storefrontRulePack),
        entranceRulePack: JSON.parse(draft.entranceRulePack),
        noteLibrary: JSON.parse(draft.noteLibrary),
        validationLibrary: JSON.parse(draft.validationLibrary),
        branding: JSON.parse(draft.branding)
      });
      setError("");
      onClose();
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
    }
  };

  return (
    <div className="admin-backdrop">
      <section className="admin-panel">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Admin Config</p>
            <h2>Rule packs and libraries</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close admin config">x</button>
        </div>
        <ConfigEditor label="Storefront rule pack" value={draft.storefrontRulePack} onChange={(value) => setDraft((current) => ({ ...current, storefrontRulePack: value }))} />
        <ConfigEditor label="Entrance rule pack" value={draft.entranceRulePack} onChange={(value) => setDraft((current) => ({ ...current, entranceRulePack: value }))} />
        <ConfigEditor label="Note library" value={draft.noteLibrary} onChange={(value) => setDraft((current) => ({ ...current, noteLibrary: value }))} />
        <ConfigEditor label="Validation library" value={draft.validationLibrary} onChange={(value) => setDraft((current) => ({ ...current, validationLibrary: value }))} />
        <ConfigEditor label="Branding" value={draft.branding} onChange={(value) => setDraft((current) => ({ ...current, branding: value }))} />
        {error && <div className="parse-error">{error}</div>}
        <button className="primary-button wide" onClick={apply}>Apply config</button>
      </section>
    </div>
  );
}

function ConfigEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="config-editor">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
    </label>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  kind = "dimension",
  min = kind === "count" ? 1 : 0
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  kind?: "count" | "dimension";
  min?: number;
}) {
  const [draft, setDraft] = useState(formatNumberInput(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumberInput(value));
  }, [focused, value]);

  const applyDraft = (rawValue: string) => {
    const nextDraft = kind === "count" ? rawValue.replace(/[^\d]/g, "") : rawValue;
    setDraft(nextDraft);
    const parsed = kind === "count" ? parseCountInput(nextDraft, min) : parseDimensionInput(nextDraft);
    if (parsed !== null && parsed >= min) onChange(parsed);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={kind === "count" ? "number" : "text"}
        inputMode={kind === "count" ? "numeric" : "decimal"}
        pattern={kind === "count" ? "[0-9]*" : `[0-9'" /.-]*`}
        min={kind === "count" ? min : undefined}
        step={kind === "count" ? 1 : undefined}
        enterKeyHint="done"
        autoComplete="off"
        value={focused ? draft : formatNumberInput(value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(formatNumberInput(value));
        }}
        onKeyDown={(event) => {
          if (kind === "count" && ["e", "E", ".", "-", "+"].includes(event.key)) event.preventDefault();
        }}
        onChange={(event) => {
          applyDraft(event.target.value);
        }}
      />
    </label>
  );
}

function CustomSizeField({
  label,
  value,
  resolvedValue,
  placeholder,
  status,
  helperText,
  disabled,
  onFocus,
  onChange
}: {
  label: string;
  value: number | null;
  resolvedValue: number;
  placeholder: string;
  status: "door" | "driven" | "manual";
  helperText: string;
  disabled: boolean;
  onFocus?: () => void;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : formatNumberInput(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === null ? "" : formatNumberInput(value));
  }, [focused, value]);

  const applyDraft = (rawValue: string) => {
    setDraft(rawValue);
    if (rawValue.trim() === "") {
      onChange(null);
      return;
    }

    const nextValue = parseDimensionInput(rawValue);
    if (nextValue !== null && nextValue > 0) onChange(nextValue);
  };

  return (
    <label className="field custom-size-field">
      <span className="field-head">
        <span>{label}</span>
        <small className={`field-chip ${status}`}>{status === "manual" ? "Manual" : status === "door" ? "Door" : "Driven"}</small>
      </span>
      <input
        type="text"
        inputMode="decimal"
        pattern={`[0-9'" /.-]*`}
        enterKeyHint="done"
        autoComplete="off"
        value={focused ? draft : value === null ? "" : formatNumberInput(value)}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = parseDimensionInput(draft);
          setDraft(parsed === null ? "" : formatNumberInput(parsed));
        }}
        onChange={(event) => {
          applyDraft(event.target.value);
        }}
      />
      <small className="field-note">
        {helperText}
        {status !== "manual" ? ` ${formatInches(resolvedValue)}` : ""}
      </small>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "selected" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CheckboxGroup({
  label,
  selected,
  options,
  onChange
}: {
  label: string;
  selected: string[];
  options: { id: string; label: string }[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <fieldset className="check-group">
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.id}>
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={(event) =>
              onChange(event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))
            }
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeJob(job: Job): Job {
  return {
    ...job,
    status: job.status ?? "active",
    activeElevationId: job.activeElevationId ?? job.elevationIds[0]
  };
}

function toInput(elevation: Elevation): ElevationInput {
  const columns = elevation.columns;
  const normalizedDoorColumn =
    elevation.doorConfig.columnIndex ??
    (elevation.doorConfig.hasDoor ? getDoorColumnIndex(columns, elevation.doorConfig.locationMode ?? "center") : null);
  return normalizeLayoutSizingInput({
    id: elevation.id,
    jobId: elevation.jobId,
    name: elevation.name,
    measurementSet: elevation.measurementSet,
    projectType: elevation.projectType,
    rows: elevation.rows,
    columns,
    rowSizingMode: elevation.rowSizingMode ?? "equal",
    columnSizingMode: elevation.columnSizingMode ?? "equal",
    rowHeights:
      (elevation.rowSizingMode ?? "equal") === "custom"
        ? resizeCustomSizingInputs(elevation.rowHeights ?? [], elevation.rows)
        : buildBlankSizingInputs(elevation.rows),
    columnWidths:
      (elevation.columnSizingMode ?? "equal") === "custom"
        ? resizeCustomSizingInputs(elevation.columnWidths ?? [], columns)
        : buildBlankSizingInputs(columns),
    doorConfig: {
      ...elevation.doorConfig,
      locationMode: elevation.doorConfig.locationMode ?? "center",
      rowPlacement: elevation.doorConfig.rowPlacement ?? "above",
      columnIndex: normalizedDoorColumn
    },
    cornerConfig: normalizeCornerConfig(elevation.cornerConfig),
    finishConfig: elevation.finishConfig,
    glassConfig: elevation.glassConfig,
    systemRulePackId: elevation.systemRulePackId,
    assemblyType: elevation.assemblyType
  });
}

function normalizeCornerConfig(cornerConfig?: Partial<CornerConfig>): CornerConfig {
  const side = cornerConfig?.side === "left" ? "left" : "right";
  const angle = Number.isFinite(cornerConfig?.angle) && cornerConfig?.angle ? Number(cornerConfig.angle) : 90;
  return {
    ...defaultCornerConfig,
    ...cornerConfig,
    hasCorner: Boolean(cornerConfig?.hasCorner),
    side,
    angle,
    linkedElevationId: cornerConfig?.hasCorner ? cornerConfig.linkedElevationId : undefined
  };
}

function getFirstElevationTemplate(job: Job, savedElevations: Elevation[], currentInput: ElevationInput): ElevationInput {
  const firstElevationId = job.elevationIds[0] ?? currentInput.id;
  if (firstElevationId === currentInput.id) return currentInput;
  const savedTemplate = savedElevations.find((item) => item.id === firstElevationId && item.jobId === job.id);
  return savedTemplate ? toInput(savedTemplate) : currentInput;
}

function inheritHorizontalPattern(
  target: ElevationInput,
  template: ElevationInput,
  overrides: Partial<ElevationInput> = {}
): ElevationInput {
  return normalizeLayoutSizingInput({
    ...target,
    rows: template.rows,
    rowSizingMode: template.rowSizingMode,
    rowHeights: resizeCustomSizingInputs(template.rowHeights, template.rows),
    finishConfig: template.finishConfig,
    glassConfig: template.glassConfig,
    systemRulePackId: template.systemRulePackId,
    assemblyType: template.assemblyType,
    doorConfig: {
      ...target.doorConfig,
      rowPlacement: template.doorConfig.rowPlacement
    },
    ...overrides
  });
}

function createCornerReturnElevationInput(
  source: ElevationInput,
  id: string,
  sourceFrameHeight: number,
  storefrontRulePack: StorefrontRulePack
): ElevationInput {
  const sideLabel = source.cornerConfig.side === "left" ? "Left" : "Right";
  const matchingOpeningHeight = roundDimension(
    sourceFrameHeight + storefrontRulePack.perimeterJoints.head + storefrontRulePack.perimeterJoints.sill
  );
  return normalizeLayoutSizingInput({
    ...source,
    id,
    name: `${sideLabel} return elevation`,
    measurementSet: createSquaredMeasurementSet(source.measurementSet.widthCenter, matchingOpeningHeight),
    columnSizingMode: "equal",
    columnWidths: buildBlankSizingInputs(source.columns),
    doorConfig: createNoDoorConfig(source.doorConfig),
    cornerConfig: {
      hasCorner: true,
      side: oppositeCornerSide(source.cornerConfig.side),
      angle: 90,
      linkedElevationId: source.id
    }
  });
}

function createNoDoorConfig(source: DoorConfig): DoorConfig {
  return {
    ...source,
    hasDoor: false,
    doorType: "none",
    columnIndex: null,
    hardwareNoteIds: [],
    doorSetCount: 0,
    doorSets: []
  };
}

function oppositeCornerSide(side: CornerSide): CornerSide {
  return side === "left" ? "right" : "left";
}

function getCornerMullionSightline(storefrontRulePack: StorefrontRulePack): number {
  return storefrontRulePack.sightlines.cornerMullion ?? storefrontRulePack.nominalFaceWidth * 2;
}

function getCornerPlanContext(
  elevations: Elevation[],
  activeElevation: Elevation,
  storefrontRulePack: StorefrontRulePack
): CornerPlanContext | null {
  const activeCorner = normalizeCornerConfig(activeElevation.cornerConfig);
  if (activeCorner.hasCorner) {
    return {
      primaryElevation: activeElevation,
      returnElevation: activeCorner.linkedElevationId
        ? elevations.find((item) => item.id === activeCorner.linkedElevationId) ?? null
        : null,
      side: activeCorner.side,
      angle: activeCorner.angle,
      cornerSightline: getCornerMullionSightline(storefrontRulePack),
      activeElevationId: activeElevation.id
    };
  }

  const parentElevation = elevations.find((item) => normalizeCornerConfig(item.cornerConfig).linkedElevationId === activeElevation.id);
  if (!parentElevation) return null;
  const parentCorner = normalizeCornerConfig(parentElevation.cornerConfig);
  return {
    primaryElevation: parentElevation,
    returnElevation: activeElevation,
    side: parentCorner.side,
    angle: parentCorner.angle,
    cornerSightline: getCornerMullionSightline(storefrontRulePack),
    activeElevationId: activeElevation.id
  };
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? Date.now()}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function isAdminModeEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === "1" || window.location.hash === "#admin";
}

function parseCountInput(value: string, min: number): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.round(parsed));
}

function parseDimensionInput(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[”"]/g, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");

  if (!normalized) return null;

  const architecturalMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft\b|\-)\s*(.*)$/i);
  if (architecturalMatch) {
    const feet = Number(architecturalMatch[1]);
    const inches = parseInchesPart(architecturalMatch[2].replace(/^-/, "").trim() || "0");
    if (Number.isFinite(feet) && inches !== null) return roundDimension(feet * 12 + inches);
  }

  const inches = parseInchesPart(normalized);
  return inches === null ? null : roundDimension(inches);
}

function parseInchesPart(value: string): number | null {
  const normalized = value.trim().replace(/in\b/i, "").trim();
  if (!normalized) return 0;

  const mixedFraction = normalized.match(/^(\d+(?:\.\d+)?)?\s*(\d+)\/(\d+)$/);
  if (mixedFraction) {
    const whole = mixedFraction[1] ? Number(mixedFraction[1]) : 0;
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (denominator > 0 && denominator <= 32) return whole + numerator / denominator;
    return null;
  }

  const decimal = Number(normalized);
  return Number.isFinite(decimal) ? decimal : null;
}

function roundDimension(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatNumberInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function clampIndex(value: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(value)));
}

function getLocationModeForColumn(columnIndex: number, columns: number): DoorConfig["locationMode"] {
  if (columnIndex <= 0) return "left";
  if (columnIndex >= columns - 1) return "right";
  if (columnIndex === getDoorColumnIndex(columns, "center")) return "center";
  return "custom";
}

function getDoorSetCount(doorConfig: DoorConfig, columns: number): number {
  if (!doorConfig.hasDoor) return 0;
  return clampDoorSetCount(doorConfig.doorSetCount ?? doorConfig.doorSets?.length ?? 1, columns);
}

function clampDoorSetCount(value: number, columns: number): number {
  const columnCount = Math.max(1, Math.round(columns));
  const count = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(columnCount, count));
}

function getDoorSets(doorConfig: DoorConfig, rows: number, columns: number): DoorSetConfig[] {
  return normalizeDoorConfig(doorConfig, rows, columns).doorSets;
}

function normalizeDoorConfig(doorConfig: DoorConfig, rows: number, columns: number): DoorConfig {
  const rowCount = Math.max(1, Math.round(rows));
  const columnCount = Math.max(1, Math.round(columns));

  if (!doorConfig.hasDoor) {
    return {
      ...doorConfig,
      hasDoor: false,
      doorType: "none",
      columnIndex: null,
      doorSetCount: 0,
      doorSets: []
    };
  }

  const count = clampDoorSetCount(doorConfig.doorSetCount ?? doorConfig.doorSets?.length ?? 1, columnCount) || 1;
  const usedColumns = new Set<number>();
  const doorSets = Array.from({ length: count }, (_, index) => {
    const normalized = normalizeDoorSetConfig(doorConfig.doorSets?.[index], index, doorConfig, rowCount, columnCount, usedColumns);
    usedColumns.add(normalized.columnIndex ?? getDoorColumnIndex(columnCount, normalized.locationMode));
    return normalized;
  });
  const primaryDoorSet = doorSets[0];

  return {
    ...doorConfig,
    hasDoor: true,
    doorType: primaryDoorSet.doorType,
    widthPerLeaf: primaryDoorSet.widthPerLeaf,
    height: primaryDoorSet.height,
    locationMode: primaryDoorSet.locationMode,
    columnIndex: primaryDoorSet.columnIndex,
    rowPlacement: doorConfig.rowPlacement ?? "above",
    swing: primaryDoorSet.swing,
    hingeType: primaryDoorSet.hingeType,
    hardwareNoteIds: primaryDoorSet.hardwareNoteIds,
    thresholdNoteId: primaryDoorSet.thresholdNoteId,
    doorSetCount: count,
    doorSets
  };
}

function normalizeDoorSetConfig(
  doorSet: Partial<DoorSetConfig> | undefined,
  index: number,
  doorConfig: DoorConfig,
  rows: number,
  columns: number,
  usedColumns: Set<number>
): DoorSetConfig {
  const fallbackLocationMode = index === 0 ? doorConfig.locationMode : "center";
  const locationMode = doorSet?.locationMode ?? fallbackLocationMode ?? "center";
  const fallbackColumnIndex = index === 0 ? doorConfig.columnIndex : null;
  const preferredColumnIndex = Number.isFinite(doorSet?.columnIndex)
    ? clampIndex(Number(doorSet?.columnIndex), columns)
    : fallbackColumnIndex !== null && Number.isFinite(fallbackColumnIndex)
      ? clampIndex(Number(fallbackColumnIndex), columns)
      : getDoorColumnIndex(columns, locationMode);
  const columnIndex = usedColumns.has(preferredColumnIndex)
    ? getFirstAvailableColumn(usedColumns, columns) ?? preferredColumnIndex
    : preferredColumnIndex;
  const fallbackDoorType = doorConfig.doorType === "pair" ? "pair" : "single";
  const doorType = doorSet?.doorType === "pair" ? "pair" : doorSet?.doorType === "single" ? "single" : fallbackDoorType;

  return {
    id: doorSet?.id || `door-set-${index + 1}`,
    rowIndex: 0,
    doorType,
    widthPerLeaf: sanitizePositiveDimension(doorSet?.widthPerLeaf, doorConfig.widthPerLeaf || 36),
    height: sanitizePositiveDimension(doorSet?.height, doorConfig.height || 84),
    locationMode: columnIndex === getDoorColumnIndex(columns, locationMode) ? locationMode : getLocationModeForColumn(columnIndex, columns),
    columnIndex,
    swing: doorSet?.swing ?? doorConfig.swing ?? "outswing",
    hingeType: doorSet?.hingeType ?? doorConfig.hingeType ?? "butt",
    hardwareNoteIds: doorSet?.hardwareNoteIds ?? doorConfig.hardwareNoteIds ?? [],
    thresholdNoteId: doorSet?.thresholdNoteId ?? doorConfig.thresholdNoteId ?? "standard-threshold"
  };
}

function getFirstAvailableColumn(usedColumns: Set<number>, columns: number): number | null {
  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    if (!usedColumns.has(columnIndex)) return columnIndex;
  }
  return null;
}

function getAvailableDoorColumns(doorSets: DoorSetConfig[], activeIndex: number, columns: number): number[] {
  const usedColumns = new Set(
    doorSets.map((doorSet, index) =>
      index === activeIndex ? null : doorSet.columnIndex ?? getDoorColumnIndex(columns, doorSet.locationMode)
    )
  );
  return Array.from({ length: columns }, (_, columnIndex) => columnIndex).filter((columnIndex) => !usedColumns.has(columnIndex));
}

function getNextAvailableDoorColumn(
  doorSets: DoorSetConfig[],
  activeIndex: number,
  currentColumnIndex: number,
  delta: number,
  columns: number
): number {
  const available = getAvailableDoorColumns(doorSets, activeIndex, columns);
  if (available.length === 0) return currentColumnIndex;
  const direction = delta < 0 ? -1 : 1;
  let nextColumnIndex = clampIndex(currentColumnIndex + direction, columns);

  while (!available.includes(nextColumnIndex) && nextColumnIndex !== currentColumnIndex) {
    const candidate = nextColumnIndex + direction;
    if (candidate < 0 || candidate >= columns) return currentColumnIndex;
    nextColumnIndex = candidate;
  }

  return nextColumnIndex;
}

function getDoorColumnLabel(columnIndex: number, columns: number): string {
  if (columns === 1) return "Bay 1";
  if (columnIndex === 0) return "Bay 1 (Left)";
  if (columnIndex === columns - 1) return `Bay ${columnIndex + 1} (Right)`;
  return `Bay ${columnIndex + 1}`;
}

function sanitizePositiveDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getCustomSizingFieldStates(
  axis: LayoutAxis,
  input: ElevationInput,
  elevation: Elevation,
  doorColumnIndex: number
): CustomSizingFieldState[] {
  const count = axis === "row" ? input.rows : input.columns;
  const values = resizeCustomSizingInputs(axis === "row" ? input.rowHeights : input.columnWidths, count);
  const resolvedValues = axis === "row" ? elevation.computedGeometry.rowHeights : elevation.computedGeometry.columnWidths;
  const lockedIndexes = new Set(getLockedCustomIndexes(axis, input, doorColumnIndex));
  const manualLimit = getCustomManualLimit(axis, input, doorColumnIndex);

  return Array.from({ length: count }, (_, index) => {
    const value = values[index] > 0 ? values[index] : null;
    const isDoorDriven = lockedIndexes.has(index);
    const status: CustomSizingFieldState["status"] = isDoorDriven ? "door" : value !== null ? "manual" : "driven";

    return {
      disabled: isDoorDriven || manualLimit === 0,
      helperText: getCustomSizingFieldHelper(axis, status, index, input, manualLimit),
      index,
      label: getCustomSizingFieldLabel(axis, index, input, doorColumnIndex),
      placeholder: axis === "row" ? "Enter height" : "Enter width",
      resolvedValue: resolvedValues[index] ?? 0,
      status,
      value
    };
  });
}

function getCustomSizingGuidance(
  axis: LayoutAxis,
  manualLimit: number,
  count: number,
  hasDoor: boolean,
  doorRowPlacement: DoorConfig["rowPlacement"] = "above"
): string {
  const axisLabel = axis === "row" ? "row heights" : "column widths";
  const editableLabel = axis === "row" ? "rows" : "columns";

  if (manualLimit <= 0) {
    return axis === "column" && hasDoor
      ? "This layout is fully driven. The door bay and remaining storefront column are automatic."
      : `This layout is fully driven. The ${axisLabel} come from the overall opening.`;
  }

  const remainderCount = Math.max(count - manualLimit, 0);
  const entryLabel = manualLimit === 1 ? axis === "row" ? "row height" : "column width" : axisLabel;
  const remainderLabel = remainderCount === 1 ? editableLabel.slice(0, -1) : editableLabel;
  const remainderVerb = remainderCount === 1 ? "picks" : "pick";

  if (axis === "row" && hasDoor) {
    return doorRowPlacement === "below"
      ? `The transom row stays driven. Enter up to ${manualLimit} row heights below the door line and the remaining row picks up the balance.`
      : `The door line stays fixed. Enter up to ${manualLimit} row heights above the door and the remaining row picks up the balance.`;
  }

  return axis === "column" && hasDoor
    ? `Enter up to ${manualLimit} ${entryLabel}. The door bay stays driven and the remaining ${remainderLabel} ${remainderVerb} up the remainder.`
    : `Enter up to ${manualLimit} ${entryLabel}. The remaining ${remainderLabel} ${remainderVerb} up the remainder automatically.`;
}

function getCustomSizingFieldLabel(
  axis: LayoutAxis,
  index: number,
  input: ElevationInput,
  doorColumnIndex: number
): string {
  if (axis === "row") {
    if (input.doorConfig.hasDoor && input.rows > 1) {
      if (input.doorConfig.rowPlacement === "above" && index === 0) return "Row 1 (Door line)";
      if (input.doorConfig.rowPlacement === "below" && index === input.rows - 1) {
        return `Row ${index + 1} (Top / transom)`;
      }
    }
    if (input.doorConfig.hasDoor && index === 0) return "Row 1 (Bottom / door zone)";
    if (index === 0) return "Row 1 (Bottom)";
    if (index === input.rows - 1) return `Row ${index + 1} (Top)`;
    return `Row ${index + 1}`;
  }

  if (input.doorConfig.hasDoor && index === doorColumnIndex) {
    return `Column ${index + 1} (Door bay)`;
  }
  if (index === 0) return "Column 1 (Left)";
  if (index === input.columns - 1) return `Column ${index + 1} (Right)`;
  return `Column ${index + 1}`;
}

function getCustomSizingFieldHelper(
  axis: LayoutAxis,
  status: CustomSizingFieldState["status"],
  index: number,
  input: ElevationInput,
  manualLimit: number
): string {
  if (status === "door") {
    if (axis === "row" && input.doorConfig.hasDoor && input.rows > 1) {
      return input.doorConfig.rowPlacement === "below" && index === input.rows - 1
        ? "Driven from the remaining height above the door."
        : "Locked to the door height and transom line.";
    }
    return "Driven by the door package.";
  }
  if (status === "manual") return "Manual input.";
  if (manualLimit <= 0) {
    return axis === "row" ? "Driven by the opening height." : "Driven by the opening width.";
  }
  if (axis === "row" && input.doorConfig.hasDoor && input.rows > 1) {
    if (input.doorConfig.rowPlacement === "above" && index === 0) {
      return "Locked to the door height and transom line.";
    }
    if (input.doorConfig.rowPlacement === "below" && index === input.rows - 1) {
      return "Driven from the remaining height above the door.";
    }
  }
  return axis === "row"
    ? "Driven from the remaining opening height."
    : "Driven from the remaining opening width.";
}

function normalizeLayoutSizingInput(
  input: ElevationInput,
  preferredAxis?: LayoutAxis,
  preferredIndex?: number
): ElevationInput {
  const doorConfig = normalizeDoorConfig(input.doorConfig, input.rows, input.columns);
  const cornerConfig = normalizeCornerConfig(input.cornerConfig);
  const columnDoorIndex =
    doorConfig.columnIndex ?? getDoorColumnIndex(Math.max(input.columns, 1), doorConfig.locationMode);
  const normalizedInput = { ...input, doorConfig, cornerConfig };

  return {
    ...normalizedInput,
    rowHeights: normalizeCustomSizingValues(
      "row",
      resizeCustomSizingInputs(input.rowHeights, input.rows),
      normalizedInput,
      columnDoorIndex,
      preferredAxis === "row" ? preferredIndex : undefined
    ),
    columnWidths: normalizeCustomSizingValues(
      "column",
      resizeCustomSizingInputs(input.columnWidths, input.columns),
      normalizedInput,
      columnDoorIndex,
      preferredAxis === "column" ? preferredIndex : undefined
    )
  };
}

function normalizeCustomSizingValues(
  axis: LayoutAxis,
  values: number[],
  input: ElevationInput,
  doorColumnIndex: number,
  preferredIndex?: number
): number[] {
  const count = axis === "row" ? input.rows : input.columns;
  const normalized = resizeCustomSizingInputs(values, count);
  const lockedIndexes = new Set(getLockedCustomIndexes(axis, input, doorColumnIndex));
  lockedIndexes.forEach((index) => {
    normalized[index] = 0;
  });

  const editableIndexes = Array.from({ length: count }, (_, index) => index).filter((index) => !lockedIndexes.has(index));
  const maxManual = Math.max(editableIndexes.length - 1, 0);
  let manualIndexes = editableIndexes.filter((index) => normalized[index] > 0);

  while (manualIndexes.length > maxManual) {
    const removableIndex =
      manualIndexes.filter((index) => index !== preferredIndex).sort((left, right) => left - right)[0] ??
      manualIndexes.sort((left, right) => left - right)[0];
    normalized[removableIndex] = 0;
    manualIndexes = editableIndexes.filter((index) => normalized[index] > 0);
  }

  return normalized;
}

function getLockedCustomIndexes(axis: LayoutAxis, input: ElevationInput, doorColumnIndex: number): number[] {
  if (axis === "column" && input.doorConfig.hasDoor && input.doorConfig.doorType !== "none") {
    return [doorColumnIndex];
  }
  if (axis === "row" && input.doorConfig.hasDoor && input.rows > 1) {
    return [input.doorConfig.rowPlacement === "below" ? input.rows - 1 : 0];
  }
  return [];
}

function getCustomManualLimit(axis: LayoutAxis, input: ElevationInput, doorColumnIndex: number): number {
  const count = axis === "row" ? input.rows : input.columns;
  const lockedCount = getLockedCustomIndexes(axis, input, doorColumnIndex).length;
  return Math.max(count - lockedCount - 1, 0);
}

function resizeCustomSizingInputs(values: number[] | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => sanitizeCustomSizingValue(values?.[index]));
}

function prepareSizingInputsForCustom(values: number[] | undefined, count: number): number[] {
  const normalized = resizeCustomSizingInputs(values, count);
  const hasMeaningfulCustomValue = normalized.some((value) => value > 0) && !normalized.every((value) => value === 1);
  return hasMeaningfulCustomValue ? normalized : buildBlankSizingInputs(count);
}

function buildBlankSizingInputs(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

function sanitizeCustomSizingValue(value: number | null | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}
