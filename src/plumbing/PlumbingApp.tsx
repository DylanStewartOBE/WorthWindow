import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Droplets,
  FileDown,
  FileSpreadsheet,
  FileText,
  History,
  ListChecks,
  Plus,
  Map as MapIcon,
  Save,
  Settings,
  ShoppingCart,
  Share2,
  Trash2,
  Waypoints
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultBranding } from "../config/options";
import { getNextRevisionNumber } from "../domain/revision";
import { defaultPlumbingConfig, pipeSystemOptions, runLocationOptions } from "./config";
import {
  createAllowance,
  createArea,
  createBlankPlumbingJob,
  createFixtureLine,
  createId,
  createPlumbingRevision,
  createRun,
  createSamplePlumbingJob,
  normalizePlumbingJob
} from "./domain/jobs";
import { formatCurrency, formatInchesFraction, formatPipeSize, formatQty } from "./domain/math";
import { calculatePlumbingQuote } from "./domain/quote";
import { buildShoppingList, shoppingListCsv, shoppingListText } from "./domain/shopping";
import { getMissingRoughInChecks } from "./domain/roughIn";
import { buildPlumbingTakeoff, getRunFittingCount, getRunHangerCount, normalizeMultiplier } from "./domain/takeoff";
import type {
  FixtureType,
  PipeRun,
  PipeSystem,
  PlumbingArea,
  PlumbingConfig,
  PlumbingFlag,
  PlumbingJob,
  PlumbingPhase,
  PlumbingQuote,
  PlumbingRevision,
  PlumbingTakeoff
} from "./domain/types";
import { createPlumbingRepository } from "./persistence";
import {
  buildMaterialCsv,
  generatePlumbingQuotePdf,
  generatePlumbingTakeoffPdf,
  generateShoppingListPdf,
  plumbingFileName,
  roughInStatusLabel
} from "./pdf";
import {
  ConfirmButton,
  FeetField,
  InchField,
  Metric,
  MoneyField,
  OptionalCountField,
  Segmented,
  SectionTitle,
  SelectField,
  Stepper,
  TextField
} from "./ui/fields";
import { PlansStep } from "./ui/PlansStep";
import { prepareFileSaving, saveFile } from "./ui/saveFile";
import { ShoppingStep } from "./ui/ShoppingStep";
import "./plumbing.css";

const steps = [
  { id: "job", label: "Job", icon: FileText },
  { id: "plans", label: "Plans", icon: MapIcon },
  { id: "fixtures", label: "Fixtures", icon: Droplets },
  { id: "piping", label: "Piping", icon: Waypoints },
  { id: "field", label: "Field verify", icon: ClipboardCheck },
  { id: "takeoff", label: "Takeoff", icon: ListChecks },
  { id: "shopping", label: "Shopping list", icon: ShoppingCart },
  { id: "quote", label: "Quote", icon: Calculator }
] as const;

type StepId = (typeof steps)[number]["id"];
const stepIndex = (id: StepId) => steps.findIndex((step) => step.id === id);

const PHASE_LABELS: Record<PlumbingPhase, string> = { underground: "Underground", rough: "Rough-in", trim: "Set & trim" };
const CONFIG_STORAGE_KEY = "worth-plumbing-config";

type UpdateJob = (updater: (job: PlumbingJob) => PlumbingJob) => void;
type ExportType = "takeoff" | "quote" | "materials" | "shopping" | "shopping-csv";

export function PlumbingApp({ onBackToProducts }: { onBackToProducts: () => void }) {
  const repository = useMemo(() => createPlumbingRepository(), []);
  const [config, setConfig] = useState<PlumbingConfig>(loadStoredConfig);
  const [jobs, setJobs] = useState<PlumbingJob[]>([]);
  const [job, setJob] = useState<PlumbingJob>(createSamplePlumbingJob);
  const [loaded, setLoaded] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [status, setStatus] = useState("");
  const [revisions, setRevisions] = useState<PlumbingRevision[]>([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const adminMode = useMemo(isAdminModeEnabled, []);
  const stepperRef = useRef<HTMLElement>(null);

  const takeoff = useMemo(() => buildPlumbingTakeoff(job, config), [job, config]);
  const quote = useMemo(() => calculatePlumbingQuote(job, takeoff, config.pricing), [job, takeoff, config.pricing]);
  const shoppingList = useMemo(() => buildShoppingList(takeoff, job, config), [takeoff, job, config]);
  const fixtureMap = useMemo(() => new Map(config.fixtureLibrary.fixtures.map((fixture) => [fixture.id, fixture])), [config]);

  useEffect(prepareFileSaving, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let saved = (await repository.getJobs()).map(normalizePlumbingJob);
        if (saved.length === 0) {
          const sample = createSamplePlumbingJob();
          await repository.saveJob(sample);
          saved = [sample];
        }
        if (cancelled) return;
        const active = saved.filter((candidate) => candidate.status === "active");
        const latest = [...(active.length ? active : saved)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        setJobs(saved);
        setJob(latest);
      } catch (error) {
        setStatus(`Could not open local storage: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Autosave the working copy. Revisions are explicit snapshots on the Quote step.
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      repository
        .saveJob(job)
        .then(() => setJobs((current) => upsert(current, job)))
        .catch((error) => setStatus(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [job, loaded, repository]);

  useEffect(() => {
    if (!loaded) return;
    repository.getRevisions(job.id).then((items) => setRevisions(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  }, [job.id, loaded, repository]);

  useEffect(() => {
    const active = stepperRef.current?.querySelector<HTMLElement>(".step.active");
    active?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeStep]);

  const updateJob: UpdateJob = (updater) =>
    setJob((current) => ({ ...updater(current), updatedAt: new Date().toISOString() }));

  const switchJob = (next: PlumbingJob) => {
    setJob(normalizePlumbingJob(next));
    setStatus(`Opened ${next.name}`);
  };

  const startNewJob = () => {
    const next = createBlankPlumbingJob(job.createdBy);
    setJobs((current) => upsert(current, next));
    setJob(next);
    setActiveStep(0);
    setStatus("Started a new plumbing job");
  };

  const loadSample = () => {
    const sample = { ...createSamplePlumbingJob(), id: createId("pjob"), updatedAt: new Date().toISOString() };
    setJobs((current) => upsert(current, sample));
    setJob(sample);
    setStatus("Loaded the sample fourplex");
  };

  const deleteJob = async () => {
    const deletedId = job.id;
    const remaining = jobs.filter((candidate) => candidate.id !== deletedId);
    // Switch away first so a pending autosave of the deleted job is cancelled.
    setJobs(remaining);
    setJob(remaining.find((candidate) => candidate.status === "active") ?? createBlankPlumbingJob(job.createdBy));
    await repository.deleteJob(deletedId);
    setStatus("Job deleted");
  };

  const saveRevision = async () => {
    const number = revisions.some((revision) => revision.number === job.revision)
      ? getNextRevisionNumber(revisions)
      : job.revision || "A";
    const nextJob = { ...job, revision: number, updatedAt: new Date().toISOString() };
    const revision = createPlumbingRevision(nextJob);
    await repository.saveRevision(revision);
    setJob(nextJob);
    setRevisions((current) => [revision, ...current]);
    setStatus(`Saved revision ${number}`);
  };

  const restoreRevision = (revision: PlumbingRevision) => {
    setJob({ ...normalizePlumbingJob(revision.snapshot), id: job.id, updatedAt: new Date().toISOString() });
    setStatus(`Restored revision ${revision.number}`);
  };

  const exportFile = async (type: ExportType, share = false) => {
    try {
      const fileName = plumbingFileName(job, type);
      const blob =
        type === "takeoff"
          ? generatePlumbingTakeoffPdf(job, takeoff, quote, defaultBranding)
          : type === "quote"
            ? generatePlumbingQuotePdf(job, quote, takeoff, defaultBranding)
            : type === "shopping"
              ? generateShoppingListPdf(job, shoppingList, defaultBranding)
              : type === "shopping-csv"
                ? new Blob([shoppingListCsv(shoppingList)], { type: "text/csv" })
                : new Blob([buildMaterialCsv(takeoff)], { type: "text/csv" });

      if (share) {
        const file = new File([blob], fileName, { type: blob.type || "application/pdf" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: fileName });
          setStatus(`Shared ${fileName}`);
          return;
        }
      }
      const outcome = await saveFile(blob, fileName);
      setStatus(outcome === "saved" ? `Saved ${fileName}` : "Save cancelled");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <main className="app-shell pl-shell">
      <div className="sticky-controls">
        <a className="brand-lockup" href="https://www.worthcon.com" target="_blank" rel="noreferrer" aria-label={`${defaultBranding.companyName} website`}>
          <img className="brand-logo-full" src={defaultBranding.logoPath ?? "/brand/worthcon.svg"} alt={defaultBranding.companyName} />
          <img className="brand-logo-mark" src={defaultBranding.logoMarkPath ?? "/brand/worthcon-w.svg"} alt={defaultBranding.companyName} />
        </a>
        <button type="button" className="product-switch-button" onClick={onBackToProducts}>
          <ChevronLeft size={15} />
          <span>Products</span>
        </button>
        <nav className="stepper" ref={stepperRef} aria-label="Plumbing steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <button
                key={step.label}
                className={index === activeStep ? "step active" : index < activeStep ? "step complete" : "step"}
                aria-current={index === activeStep ? "step" : undefined}
                onClick={() => setActiveStep(index)}
              >
                <Icon size={16} />
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>
        {adminMode && (
          <button className="icon-button" onClick={() => setAdminOpen(true)} aria-label="Open plumbing rule packs">
            <Settings size={20} />
          </button>
        )}
      </div>

      <section className="workspace">
        <div className="work-panel pl-work-panel">
          {steps[activeStep].id === "job" && (
            <JobStep
              job={job}
              jobs={jobs}
              updateJob={updateJob}
              onSwitchJob={switchJob}
              onNewJob={startNewJob}
              onLoadSample={loadSample}
              onDeleteJob={deleteJob}
            />
          )}
          {steps[activeStep].id === "plans" && (
            <PlansStep job={job} updateJob={updateJob} config={config} takeoff={takeoff} repository={repository} onStatus={setStatus} />
          )}
          {steps[activeStep].id === "fixtures" && (
            <FixturesStep job={job} updateJob={updateJob} config={config} takeoff={takeoff} onOpenPlans={() => setActiveStep(stepIndex("plans"))} />
          )}
          {steps[activeStep].id === "piping" && (
            <PipingStep job={job} updateJob={updateJob} config={config} takeoff={takeoff} onOpenPlans={() => setActiveStep(stepIndex("plans"))} />
          )}
          {steps[activeStep].id === "field" && <FieldVerifyStep job={job} updateJob={updateJob} fixtureMap={fixtureMap} takeoff={takeoff} />}
          {steps[activeStep].id === "takeoff" && <TakeoffStep takeoff={takeoff} />}
          {steps[activeStep].id === "shopping" && (
            <ShoppingStep
              job={job}
              updateJob={updateJob}
              config={config}
              takeoff={takeoff}
              list={shoppingList}
              listText={shoppingListText(shoppingList, job)}
              onExport={(type) => exportFile(type)}
              onStatus={setStatus}
            />
          )}
          {steps[activeStep].id === "quote" && (
            <QuoteStep
              job={job}
              updateJob={updateJob}
              quote={quote}
              revisions={revisions}
              onExport={exportFile}
              onSaveRevision={saveRevision}
              onRestoreRevision={restoreRevision}
            />
          )}
        </div>

        <aside className="preview-panel pl-summary-panel">
          <SummaryPanel job={job} takeoff={takeoff} quote={quote} status={status} onOpenStep={setActiveStep} />
        </aside>
      </section>

      <footer className="nav-actions">
        <button className="secondary-button" onClick={() => setActiveStep((step) => Math.max(step - 1, 0))} disabled={activeStep === 0}>
          <ChevronLeft size={18} />
          Back
        </button>
        <button
          className="primary-button"
          onClick={() => setActiveStep((step) => Math.min(step + 1, steps.length - 1))}
          disabled={activeStep === steps.length - 1}
        >
          Next
          <ChevronRight size={18} />
        </button>
      </footer>

      {adminOpen && (
        <PlumbingAdminPanel
          config={config}
          onApply={(next) => {
            setConfig(next);
            storeConfig(next);
            setAdminOpen(false);
            setStatus("Rule packs updated");
          }}
          onReset={() => {
            setConfig(defaultPlumbingConfig);
            storeConfig(null);
            setAdminOpen(false);
            setStatus("Rule packs reset to defaults");
          }}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Summary (right column on desktop, top on phone)
// ---------------------------------------------------------------------------

function SummaryPanel({
  job,
  takeoff,
  quote,
  status,
  onOpenStep
}: {
  job: PlumbingJob;
  takeoff: PlumbingTakeoff;
  quote: PlumbingQuote;
  status: string;
  onOpenStep: (step: number) => void;
}) {
  const { sizing } = takeoff;
  const pipeFeet = takeoff.pipeTotals.reduce((total, line) => total + line.lengthFt, 0);
  const errors = takeoff.flags.filter((flag) => flag.severity === "error").length;
  const warnings = takeoff.flags.filter((flag) => flag.severity === "warning").length;

  return (
    <section className="pl-summary">
      <div className="section-title">
        <p className="eyebrow pl-hide-phone">Plumbing takeoff</p>
        <h2>{job.name || "Untitled job"}</h2>
        <p>
          {[job.number, job.customer, `Rev ${job.revision}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="metric-grid pl-metric-grid">
        <Metric label="Fixtures" value={String(takeoff.fixtureCount)} />
        <Metric label="DFU" value={formatQty(sizing.totalDfu)} />
        <Metric secondary label="Supply FU" value={formatQty(sizing.totalWsfu.total)} />
        <Metric secondary label="Peak demand" value={`${formatQty(sizing.estimatedPeakGpm)} gpm`} />
        <Metric
          secondary
          label="Min. bldg drain"
          value={sizing.minBuildingDrainSize ? formatPipeSize(sizing.minBuildingDrainSize) : "-"}
          tone={takeoff.flags.some((flag) => flag.code === "BUILDING_DRAIN_UNDERSIZED") ? "warning" : undefined}
        />
        <Metric secondary label="Pipe" value={`${formatQty(Math.round(pipeFeet))} ft`} />
        <Metric label="Labor" value={`${formatQty(quote.laborHours)} hr`} compactValue={`${Math.round(quote.laborHours)} hr`} />
        <Metric label="Est. total" value={formatCurrency(quote.total)} compactValue={formatCompactCurrency(quote.total)} />
      </div>
      <button type="button" className={`pl-flag-summary${errors ? " error" : warnings ? " warning" : ""}`} onClick={() => onOpenStep(stepIndex("takeoff"))}>
        {errors + warnings === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <span>
          {errors + warnings === 0
            ? `No warnings${takeoff.flags.length ? ` · ${takeoff.flags.length} note${takeoff.flags.length === 1 ? "" : "s"}` : ""}`
            : `${errors ? `${errors} error${errors === 1 ? "" : "s"} · ` : ""}${warnings} warning${warnings === 1 ? "" : "s"} to review`}
        </span>
        <ChevronRight size={16} />
      </button>
      {status && <p className="pl-status" role="status">{status}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Job
// ---------------------------------------------------------------------------

function JobStep({
  job,
  jobs,
  updateJob,
  onSwitchJob,
  onNewJob,
  onLoadSample,
  onDeleteJob
}: {
  job: PlumbingJob;
  jobs: PlumbingJob[];
  updateJob: UpdateJob;
  onSwitchJob: (job: PlumbingJob) => void;
  onNewJob: () => void;
  onLoadSample: () => void;
  onDeleteJob: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const listed = jobs
    .filter((candidate) => (showArchived ? candidate.status === "archived" : candidate.status === "active"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const set = <K extends keyof PlumbingJob>(key: K, value: PlumbingJob[K]) => updateJob((current) => ({ ...current, [key]: value }));

  return (
    <>
      <section className="step-content">
        <SectionTitle title="Job Setup" subtitle="Who and what this takeoff is for. Changes save automatically on this device." />
        <div className="field-grid compact">
          <TextField label="Job name" value={job.name} onChange={(value) => set("name", value)} />
          <TextField label="Job number" value={job.number} onChange={(value) => set("number", value)} />
          <TextField label="Customer" value={job.customer} onChange={(value) => set("customer", value)} />
          <TextField label="Prepared by" value={job.createdBy} onChange={(value) => set("createdBy", value)} />
        </div>
        <TextField label="Site address" value={job.address} onChange={(value) => set("address", value)} />
        <Segmented
          label="Building use (sets fixture units)"
          value={job.buildingType}
          options={[
            { value: "residential", label: "Residential / private" },
            { value: "commercial", label: "Commercial / public" }
          ]}
          onChange={(value) => set("buildingType", value)}
        />
        <Segmented
          label="Project type"
          value={job.projectType}
          options={[
            { value: "new", label: "New" },
            { value: "remodel", label: "Remodel" },
            { value: "tenant-improvement", label: "Tenant improvement" }
          ]}
          onChange={(value) => set("projectType", value)}
        />
        <label className="config-editor">
          <span>Scope notes</span>
          <textarea className="pl-notes" value={job.notes} onChange={(event) => set("notes", event.target.value)} />
        </label>
      </section>

      <section className="step-content">
        <SectionTitle
          title="Plumbing Jobs"
          subtitle="Jobs are stored on this device until cloud sync is added."
          action={
            <button type="button" className="text-button" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? "Show active" : "Show archived"}
            </button>
          }
        />
        <div className="pl-job-list">
          {listed.length === 0 && <p className="field-note">No {showArchived ? "archived" : "active"} jobs.</p>}
          {listed.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={`elevation-row pl-job-row${candidate.id === job.id ? " selected" : ""}`}
              onClick={() => onSwitchJob(candidate)}
            >
              <span>
                <strong>{candidate.name || "Untitled job"}</strong>
                <small>
                  {[candidate.number, candidate.customer, `Rev ${candidate.revision}`].filter(Boolean).join(" · ")}
                </small>
              </span>
              <small>{new Date(candidate.updatedAt).toLocaleDateString()}</small>
            </button>
          ))}
        </div>
        <div className="pl-button-row">
          <button type="button" className="primary-button" onClick={onNewJob}>
            <Plus size={16} /> New job
          </button>
          <button type="button" className="secondary-button" onClick={onLoadSample}>
            <Copy size={16} /> Load sample
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => set("status", job.status === "active" ? "archived" : "active")}
          >
            {job.status === "active" ? <Archive size={16} /> : <ArchiveRestore size={16} />}
            {job.status === "active" ? "Archive" : "Restore"}
          </button>
          <ConfirmButton className="secondary-button pl-danger" confirmLabel="Tap again to delete" onConfirm={onDeleteJob}>
            <Trash2 size={16} /> Delete job
          </ConfirmButton>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Fixtures
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<FixtureType["category"], string> = {
  fixture: "Fixtures",
  drain: "Drains",
  appliance: "Appliance connections",
  equipment: "Equipment"
};

function FixturesStep({
  job,
  updateJob,
  config,
  takeoff,
  onOpenPlans
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  config: PlumbingConfig;
  takeoff: PlumbingTakeoff;
  onOpenPlans: () => void;
}) {
  const fixtures = config.fixtureLibrary.fixtures;
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  const updateArea = (areaId: string, updater: (area: PlumbingArea) => PlumbingArea) =>
    updateJob((current) => ({ ...current, areas: current.areas.map((area) => (area.id === areaId ? updater(area) : area)) }));

  const addFixture = (areaId: string, fixture: FixtureType) =>
    updateArea(areaId, (area) => {
      const existing = area.fixtures.find((line) => line.fixtureTypeId === fixture.id && line.furnishedBy === fixture.defaultFurnishedBy);
      if (existing) {
        return { ...area, fixtures: area.fixtures.map((line) => (line.id === existing.id ? { ...line, qty: line.qty + 1 } : line)) };
      }
      return { ...area, fixtures: [...area.fixtures, createFixtureLine(fixture)] };
    });

  const duplicateArea = (area: PlumbingArea) =>
    updateJob((current) => {
      const index = current.areas.findIndex((candidate) => candidate.id === area.id);
      const copy: PlumbingArea = {
        ...area,
        id: createId("area"),
        name: `${area.name} copy`,
        fixtures: area.fixtures.map((line) => ({ ...line, id: createId("fx") }))
      };
      const areas = [...current.areas];
      areas.splice(index + 1, 0, copy);
      return { ...current, areas };
    });

  const removeArea = (area: PlumbingArea) => {
    updateJob((current) => ({
      ...current,
      areas: current.areas.filter((candidate) => candidate.id !== area.id),
      runs: current.runs.filter((run) => run.areaId !== area.id),
      fieldChecks: current.fieldChecks.filter((check) => check.areaId !== area.id)
    }));
  };

  const grouped = (Object.keys(CATEGORY_LABELS) as FixtureType["category"][])
    .map((category) => ({ category, items: fixtures.filter((fixture) => fixture.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      <section className="step-content pl-intro">
        <SectionTitle
          title="Fixtures by Area"
          subtitle="Enter a room, unit type, or floor once, then set how many times it repeats. Tap a fixture to add it, tap again to add another."
        />
      </section>

      {job.areas.map((area) => {
        const areaLines = takeoff.fixtureSchedule.filter((line) => line.areaId === area.id);
        const areaDfu = areaLines.reduce((total, line) => total + line.totalDfu, 0);
        const areaWsfu = areaLines.reduce((total, line) => total + line.totalWsfu.total, 0);
        const areaCount = areaLines.reduce((total, line) => total + line.totalQty, 0);
        const multiplier = normalizeMultiplier(area.multiplier);

        return (
          <section className="step-content pl-area" key={area.id}>
            <div className="pl-area-header">
              <div className="field-grid compact">
                <TextField label="Area name" value={area.name} onChange={(name) => updateArea(area.id, (current) => ({ ...current, name }))} />
                <TextField
                  label="Level / unit type"
                  value={area.level}
                  placeholder="e.g. Level 2, Type A"
                  onChange={(level) => updateArea(area.id, (current) => ({ ...current, level }))}
                />
              </div>
              <div className="pl-area-multiplier">
                <span>Repeats</span>
                <Stepper
                  label={`${area.name} repeat count`}
                  value={multiplier}
                  min={1}
                  onChange={(value) => updateArea(area.id, (current) => ({ ...current, multiplier: value }))}
                />
              </div>
            </div>

            <div className="pl-lines">
              {area.fixtures.length === 0 && <p className="field-note">No fixtures yet. Tap one below to add it.</p>}
              {area.fixtures.map((line) => {
                const fixture = fixtureMap.get(line.fixtureTypeId);
                return (
                  <div className="pl-line" key={line.id}>
                    <div className="pl-line-main">
                      <strong>{fixture?.label ?? line.fixtureTypeId}</strong>
                      <small>
                        {fixture ? `${fixture.shortLabel} · ` : ""}
                        {multiplier > 1 ? `${line.qty} x ${multiplier} = ${line.qty * multiplier} total` : `${line.qty} total`}
                      </small>
                    </div>
                    <Stepper
                      label={`${fixture?.label ?? "Fixture"} quantity`}
                      value={line.qty}
                      min={0}
                      onChange={(qty) =>
                        updateArea(area.id, (current) => ({
                          ...current,
                          fixtures: current.fixtures.map((candidate) => (candidate.id === line.id ? { ...candidate, qty } : candidate))
                        }))
                      }
                    />
                    <div className="pl-furnished" role="group" aria-label="Furnished by">
                      {(["worth", "others"] as const).map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={line.furnishedBy === value ? "selected" : ""}
                          aria-pressed={line.furnishedBy === value}
                          onClick={() =>
                            updateArea(area.id, (current) => ({
                              ...current,
                              fixtures: current.fixtures.map((candidate) =>
                                candidate.id === line.id ? { ...candidate, furnishedBy: value } : candidate
                              )
                            }))
                          }
                        >
                          {value === "worth" ? "Worth" : "By others"}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Remove ${fixture?.label ?? "fixture"}`}
                      onClick={() =>
                        updateArea(area.id, (current) => ({
                          ...current,
                          fixtures: current.fixtures.filter((candidate) => candidate.id !== line.id)
                        }))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>

            <PlanFixtureNote lines={areaLines.filter((line) => line.source === "plan")} onOpenPlans={onOpenPlans} />

            <details className="pl-quick-add" open={area.fixtures.length === 0}>
              <summary>
                <Plus size={16} /> Add fixtures
              </summary>
              {grouped.map((group) => (
                <div key={group.category} className="pl-chip-group">
                  <span>{CATEGORY_LABELS[group.category]}</span>
                  <div>
                    {group.items.map((fixture) => (
                      <button type="button" key={fixture.id} className="pl-chip" onClick={() => addFixture(area.id, fixture)}>
                        <Plus size={14} />
                        {fixture.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </details>

            <div className="pl-area-footer">
              <span>
                {areaCount} fixture{areaCount === 1 ? "" : "s"} · {formatQty(areaDfu)} DFU · {formatQty(areaWsfu)} WSFU
              </span>
              <div>
                <button type="button" className="text-button" onClick={() => duplicateArea(area)}>
                  <Copy size={15} /> Duplicate
                </button>
                <ConfirmButton
                  className="text-button pl-danger-text"
                  confirmLabel={
                    job.runs.some((run) => run.areaId === area.id) ? "Tap again: removes its runs too" : "Tap again to remove"
                  }
                  onConfirm={() => removeArea(area)}
                >
                  <Trash2 size={15} /> Remove
                </ConfirmButton>
              </div>
            </div>
          </section>
        );
      })}

      {takeoff.fixtureSchedule.some((line) => line.source === "plan" && !line.areaId) && (
        <section className="step-content">
          <SectionTitle title="Building-wide (from plans)" subtitle="Fixtures tapped on sheets that are not assigned to an area." />
          <PlanFixtureNote lines={takeoff.fixtureSchedule.filter((line) => line.source === "plan" && !line.areaId)} onOpenPlans={onOpenPlans} />
        </section>
      )}

      <button
        type="button"
        className="secondary-button wide pl-add-area"
        onClick={() => updateJob((current) => ({ ...current, areas: [...current.areas, createArea(`Area ${current.areas.length + 1}`)] }))}
      >
        <Plus size={16} /> Add area
      </button>
    </>
  );
}

function PlanFixtureNote({ lines, onOpenPlans }: { lines: PlumbingTakeoff["fixtureSchedule"]; onOpenPlans: () => void }) {
  if (lines.length === 0) return null;
  return (
    <div className="pl-plan-note">
      <MapIcon size={16} />
      <span>
        From plans: {lines.map((line) => `${line.qtyPerArea} ${line.label}${line.furnishedBy === "others" ? " (by others)" : ""}`).join(", ")}
        {lines[0].multiplier > 1 ? `, each x${lines[0].multiplier}` : ""}
      </span>
      <button type="button" className="text-button" onClick={onOpenPlans}>
        Edit on plans
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Piping
// ---------------------------------------------------------------------------

function PipingStep({
  job,
  updateJob,
  config,
  takeoff,
  onOpenPlans
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  config: PlumbingConfig;
  takeoff: PlumbingTakeoff;
  onOpenPlans: () => void;
}) {
  const [areaFilter, setAreaFilter] = useState("all");
  const rules = config.pipingRulePack;
  const materials = rules.pipeMaterials;
  const systemRules = new Map(rules.systems.map((rule) => [rule.system, rule]));
  const areaOptions = [{ value: "", label: "Building-wide" }, ...job.areas.map((area) => ({ value: area.id, label: area.name || "Unnamed area" }))];
  const multiplierFor = (areaId: string) => normalizeMultiplier(job.areas.find((area) => area.id === areaId)?.multiplier);
  const visibleRuns = job.runs.filter((run) => areaFilter === "all" || run.areaId === areaFilter);

  const updateRun = (runId: string, patch: Partial<PipeRun>) =>
    updateJob((current) => ({ ...current, runs: current.runs.map((run) => (run.id === runId ? { ...run, ...patch } : run)) }));

  const changeSystem = (run: PipeRun, system: PipeSystem) => {
    const material = materials.find((candidate) => candidate.id === run.pipeMaterialId);
    if (material?.allowedSystems.includes(system)) {
      updateRun(run.id, { system, insulated: systemRules.get(system)?.insulationMaterialId ? run.insulated : false });
      return;
    }
    const defaults = createRun(system);
    updateRun(run.id, { system, pipeMaterialId: defaults.pipeMaterialId, size: defaults.size, insulated: defaults.insulated });
  };

  const changeMaterial = (run: PipeRun, materialId: string) => {
    const material = materials.find((candidate) => candidate.id === materialId);
    const sizes = material?.sizes.map((spec) => spec.size) ?? [];
    const size = sizes.includes(run.size) || sizes.length === 0 ? run.size : nearest(sizes, run.size);
    updateRun(run.id, { pipeMaterialId: materialId, size });
  };

  const addRun = (system: PipeSystem) =>
    updateJob((current) => ({
      ...current,
      runs: [...current.runs, createRun(system, { areaId: areaFilter === "all" ? "" : areaFilter })]
    }));

  return (
    <>
      <section className="step-content">
        <SectionTitle
          title="Pipe Runs"
          subtitle="Enter lengths by system, size, and material. Leave fittings blank to estimate them from the rule pack. Runs in a repeating area are multiplied."
        />
        <div className="pl-chip-group">
          <span>Add a run</span>
          <div>
            {pipeSystemOptions.map((option) => (
              <button type="button" key={option.value} className="pl-chip" onClick={() => addRun(option.value)}>
                <Plus size={14} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <SelectField
          label="Show runs for"
          value={areaFilter}
          options={[{ value: "all", label: "All areas" }, ...areaOptions]}
          onChange={setAreaFilter}
        />
      </section>

      {visibleRuns.length === 0 && (
        <section className="step-content">
          <p className="field-note">No runs entered by hand here. Add one above, or draw runs on the Plans step.</p>
        </section>
      )}

      {visibleRuns.map((run) => {
        const material = materials.find((candidate) => candidate.id === run.pipeMaterialId);
        const systemRule = systemRules.get(run.system);
        const allowedMaterials = materials.filter((candidate) => candidate.allowedSystems.includes(run.system));
        const materialOptions = (material && !allowedMaterials.includes(material) ? [material, ...allowedMaterials] : allowedMaterials).map(
          (candidate) => ({ value: candidate.id, label: candidate.label })
        );
        const sizeOptions = (material?.sizes ?? []).map((spec) => ({ value: String(spec.size), label: formatPipeSize(spec.size) }));
        if (!sizeOptions.some((option) => option.value === String(run.size))) {
          sizeOptions.unshift({ value: String(run.size), label: `${formatPipeSize(run.size)} (not priced)` });
        }
        const multiplier = run.areaId ? multiplierFor(run.areaId) : 1;
        const estimatedFittings = getRunFittingCount({ ...run, fittingCount: null }, systemRule?.fittingsPer100Ft ?? 0);
        const fittings = getRunFittingCount(run, systemRule?.fittingsPer100Ft ?? 0) * multiplier;
        const hangers = material && run.location !== "underground" ? getRunHangerCount(run, material) * multiplier : 0;

        return (
          <section className={`step-content pl-run pl-system-${run.system}`} key={run.id}>
            <div className="field-grid compact">
              <TextField label="Run label" value={run.label} placeholder="e.g. Building drain" onChange={(label) => updateRun(run.id, { label })} />
              <SelectField label="Area" value={run.areaId} options={areaOptions} onChange={(areaId) => updateRun(run.id, { areaId })} />
            </div>
            <div className="field-grid">
              <SelectField label="System" value={run.system} options={pipeSystemOptions} onChange={(system) => changeSystem(run, system)} />
              <SelectField label="Material" value={run.pipeMaterialId} options={materialOptions} onChange={(id) => changeMaterial(run, id)} />
              <SelectField label="Size" value={String(run.size)} options={sizeOptions} onChange={(size) => updateRun(run.id, { size: Number(size) })} />
            </div>
            <div className="field-grid">
              <FeetField label="Length (ft)" value={run.lengthFt} onChange={(lengthFt) => updateRun(run.id, { lengthFt })} />
              <OptionalCountField
                label="Fittings"
                value={run.fittingCount}
                placeholder={`Auto: ${estimatedFittings}`}
                onChange={(fittingCount) => updateRun(run.id, { fittingCount })}
              />
              {systemRule?.insulationMaterialId ? (
                <label className="pl-check">
                  <input type="checkbox" checked={run.insulated} onChange={(event) => updateRun(run.id, { insulated: event.target.checked })} />
                  <span>Insulated</span>
                </label>
              ) : (
                <span />
              )}
            </div>
            <Segmented label="Location" value={run.location} options={runLocationOptions} onChange={(location) => updateRun(run.id, { location })} />
            <div className="pl-area-footer">
              <span>
                {multiplier > 1 ? `x${multiplier} areas · ` : ""}
                {formatQty(run.lengthFt * multiplier)} ft · {fittings} fittings · {hangers} hangers
              </span>
              <div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    updateJob((current) => {
                      const index = current.runs.findIndex((candidate) => candidate.id === run.id);
                      const runs = [...current.runs];
                      runs.splice(index + 1, 0, { ...run, id: createId("run"), label: run.label ? `${run.label} copy` : "" });
                      return { ...current, runs };
                    })
                  }
                >
                  <Copy size={15} /> Duplicate
                </button>
                <button
                  type="button"
                  className="text-button pl-danger-text"
                  onClick={() => updateJob((current) => ({ ...current, runs: current.runs.filter((candidate) => candidate.id !== run.id) }))}
                >
                  <Trash2 size={15} /> Remove
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {takeoff.planRuns.length > 0 && (
        <section className="step-content">
          <SectionTitle
            title="Drawn on Plans"
            subtitle="Measured from the plan sheets, with fittings counted by type. Edit these on the Plans step."
            action={
              <button type="button" className="text-button" onClick={onOpenPlans}>
                <MapIcon size={15} /> Open plans
              </button>
            }
          />
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th className="num">Total ft</th>
                  <th className="num">Fittings</th>
                </tr>
              </thead>
              <tbody>
                {takeoff.planRuns.map((result) => (
                  <tr key={result.runId}>
                    <td>
                      {result.label}
                      <small>
                        {result.measured
                          ? `${formatQty(result.horizontalFt)} ft on plan + ${formatQty(result.verticalFt)} ft rises/drops${result.trench ? ` · trench ${formatQty(result.trench.excavationCy)} cy` : ""}`
                          : "Sheet has no scale"}
                      </small>
                    </td>
                    <td className="num">{formatQty(result.totalFt)}</td>
                    <td className="num">{result.fittingItems.reduce((total, item) => total + item.qty, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Field verify
// ---------------------------------------------------------------------------

function FieldVerifyStep({
  job,
  updateJob,
  fixtureMap,
  takeoff
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  fixtureMap: Map<string, FixtureType>;
  takeoff: PlumbingTakeoff;
}) {
  const missing = getMissingRoughInChecks(job, fixtureMap);
  const results = new Map(takeoff.roughIn.map((result) => [result.checkId, result]));
  const counts = {
    pass: takeoff.roughIn.filter((result) => result.status === "pass").length,
    out: takeoff.roughIn.filter((result) => result.status === "out-of-range").length,
    open: takeoff.roughIn.filter((result) => result.status === "not-measured").length
  };

  const addMissing = () =>
    updateJob((current) => ({
      ...current,
      fieldChecks: [
        ...current.fieldChecks,
        ...missing.map((item) => ({ id: createId("chk"), ...item, measured: null, note: "" }))
      ]
    }));

  const updateCheck = (checkId: string, patch: { measured?: number | null; note?: string }) =>
    updateJob((current) => ({
      ...current,
      fieldChecks: current.fieldChecks.map((check) => (check.id === checkId ? { ...check, ...patch } : check))
    }));

  return (
    <>
      <section className="step-content">
        <SectionTitle
          title="Rough-In Field Verification"
          subtitle="Tape the stub-outs before walls close. Each reading is checked against the fixture library range; the approved cut sheet still governs."
        />
        <div className="metric-grid pl-metric-grid three">
          <Metric label="In range" value={String(counts.pass)} />
          <Metric label="Out of range" value={String(counts.out)} tone={counts.out ? "warning" : undefined} />
          <Metric label="Not measured" value={String(counts.open)} />
        </div>
        <button type="button" className="primary-button wide" onClick={addMissing} disabled={missing.length === 0}>
          <ListChecks size={16} />
          {missing.length === 0 ? "All entered fixtures have checks" : `Add ${missing.length} check${missing.length === 1 ? "" : "s"} for entered fixtures`}
        </button>
      </section>

      {job.areas.map((area) => {
        const checks = job.fieldChecks.filter((check) => check.areaId === area.id);
        if (checks.length === 0) return null;
        return (
          <section className="step-content" key={area.id}>
            <SectionTitle title={area.name || "Unnamed area"} subtitle={area.level} />
            <div className="pl-checks">
              {checks.map((check) => {
                const fixture = fixtureMap.get(check.fixtureTypeId);
                const spec = fixture?.roughIn.find((dimension) => dimension.id === check.dimensionId);
                const result = results.get(check.id);
                return (
                  <div className={`pl-check-row status-${result?.status ?? "unknown-spec"}`} key={check.id}>
                    <div className="pl-check-head">
                      <strong>
                        {fixture?.shortLabel ?? check.fixtureTypeId} · {spec?.label ?? check.dimensionId}
                      </strong>
                      <span className="pl-status-chip">{result ? roughInStatusLabel(result.status) : "No spec"}</span>
                    </div>
                    {spec && (
                      <small className="field-note">
                        {spec.reference}. Target {formatInchesFraction(spec.target)}, range {formatInchesFraction(spec.min)} to{" "}
                        {formatInchesFraction(spec.max)}.
                      </small>
                    )}
                    <div className="field-grid compact">
                      <InchField
                        label="Measured (in)"
                        value={check.measured}
                        onChange={(measured) => updateCheck(check.id, { measured })}
                        hint={
                          result?.deviation !== null && result?.deviation !== undefined
                            ? `${result.deviation >= 0 ? "+" : ""}${formatInchesFraction(result.deviation)} from target`
                            : undefined
                        }
                      />
                      <TextField label="Note" value={check.note} onChange={(note) => updateCheck(check.id, { note })} />
                    </div>
                    <button
                      type="button"
                      className="text-button pl-danger-text"
                      onClick={() =>
                        updateJob((current) => ({ ...current, fieldChecks: current.fieldChecks.filter((candidate) => candidate.id !== check.id) }))
                      }
                    >
                      <Trash2 size={15} /> Remove check
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Takeoff
// ---------------------------------------------------------------------------

type TakeoffView = "materials" | "fixtures" | "pipe" | "review";

function TakeoffStep({ takeoff }: { takeoff: PlumbingTakeoff }) {
  const [view, setView] = useState<TakeoffView>("materials");
  const { sizing } = takeoff;

  return (
    <section className="step-content">
      <SectionTitle title="Takeoff" subtitle="Calculated from the fixtures, runs, and rule packs. Nothing here is typed in by hand." />
      <Segmented
        label="View"
        value={view}
        options={[
          { value: "materials", label: "Materials" },
          { value: "fixtures", label: "Fixtures" },
          { value: "pipe", label: "Pipe" },
          { value: "review", label: `Review (${takeoff.flags.length})` }
        ]}
        onChange={setView}
      />

      {view === "materials" &&
        (["underground", "rough", "trim"] as PlumbingPhase[]).map((phase) => {
          const lines = takeoff.materials.filter((line) => line.phase === phase);
          if (lines.length === 0) return null;
          return (
            <div key={phase} className="pl-table-block">
              <h3>{PHASE_LABELS[phase]}</h3>
              <div className="pl-table-wrap">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Qty</th>
                      <th className="num">Order</th>
                      <th className="num">Cost</th>
                      <th className="num">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.key}>
                        <td>
                          {line.description}
                          <small>
                            {line.group}
                            {line.orderNote ? ` · ${line.orderNote}` : ""}
                          </small>
                        </td>
                        <td className="num">
                          {formatQty(line.qty)} {line.unit}
                        </td>
                        <td className="num">{line.kind === "labor" ? "-" : formatQty(line.orderQty)}</td>
                        <td className="num">{line.materialCost ? formatCurrency(line.materialCost) : "-"}</td>
                        <td className="num">{line.laborHours ? formatQty(line.laborHours) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Phase total</td>
                      <td />
                      <td />
                      <td className="num">{formatCurrency(lines.reduce((total, line) => total + line.materialCost, 0))}</td>
                      <td className="num">{formatQty(lines.reduce((total, line) => total + line.laborHours, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })}

      {view === "materials" && takeoff.materials.length === 0 && <p className="field-note">Add fixtures or pipe runs to build the takeoff.</p>}

      {view === "fixtures" && (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>Area / fixture</th>
                <th className="num">Total</th>
                <th className="num">DFU</th>
                <th className="num">WSFU C/H/T</th>
              </tr>
            </thead>
            <tbody>
              {takeoff.fixtureSchedule.map((line) => (
                <tr key={`${line.areaId}-${line.fixtureTypeId}-${line.furnishedBy}`}>
                  <td>
                    {line.label}
                    <small>
                      {line.areaName}
                      {line.multiplier > 1 ? ` · ${line.qtyPerArea} x ${line.multiplier}` : ""}
                      {line.furnishedBy === "others" ? " · by others" : ""}
                    </small>
                  </td>
                  <td className="num">{line.totalQty}</td>
                  <td className="num">{formatQty(line.totalDfu)}</td>
                  <td className="num">
                    {formatQty(line.totalWsfu.cold)} / {formatQty(line.totalWsfu.hot)} / {formatQty(line.totalWsfu.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{takeoff.fixtureCount}</td>
                <td className="num">{formatQty(sizing.totalDfu)}</td>
                <td className="num">
                  {formatQty(sizing.totalWsfu.cold)} / {formatQty(sizing.totalWsfu.hot)} / {formatQty(sizing.totalWsfu.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {view === "pipe" && (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>System / material</th>
                <th className="num">Feet</th>
                <th className="num">Fittings</th>
                <th className="num">Hangers</th>
              </tr>
            </thead>
            <tbody>
              {takeoff.pipeTotals.map((line) => (
                <tr key={line.key}>
                  <td>
                    {formatPipeSize(line.size)} {line.materialLabel}
                    <small>
                      {line.systemLabel} · {runLocationOptions.find((option) => option.value === line.location)?.label}
                    </small>
                  </td>
                  <td className="num">{formatQty(line.lengthFt)}</td>
                  <td className="num">{line.fittings}</td>
                  <td className="num">{line.hangers}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {takeoff.pipeTotals.length === 0 && <p className="field-note">No pipe runs entered.</p>}
        </div>
      )}

      {view === "review" && (
        <>
          <div className="metric-grid pl-metric-grid">
            <Metric label="Total DFU" value={formatQty(sizing.totalDfu)} />
            <Metric label="WSFU cold / hot" value={`${formatQty(sizing.totalWsfu.cold)} / ${formatQty(sizing.totalWsfu.hot)}`} />
            <Metric label="Peak demand" value={`${formatQty(sizing.estimatedPeakGpm)} gpm${sizing.hasFlushValves ? " FV" : ""}`} />
            <Metric label="Min. building drain" value={sizing.minBuildingDrainSize ? `${formatPipeSize(sizing.minBuildingDrainSize)} @ 1/4"/ft` : "-"} />
          </div>
          <FlagList flags={takeoff.flags} />
          <p className="field-note">
            Fixture units and sizing are code-default (IPC) references for estimating. They are not an engineered design. Confirm against the
            plans and the adopted code edition.
          </p>
        </>
      )}
    </section>
  );
}

function FlagList({ flags }: { flags: PlumbingFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="validation empty">
        <CheckCircle2 size={18} /> Nothing to review.
      </div>
    );
  }
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <div className="validation-list">
      {[...flags]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((flag) => (
          <article key={flag.id} className={`validation ${flag.severity}`}>
            <AlertTriangle size={18} />
            <div>
              <strong>{flag.code.replace(/_/g, " ")}</strong>
              <p>{flag.message}</p>
              <span>{flag.recommendation}</span>
            </div>
          </article>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Quote & output
// ---------------------------------------------------------------------------

function QuoteStep({
  job,
  updateJob,
  quote,
  revisions,
  onExport,
  onSaveRevision,
  onRestoreRevision
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  quote: PlumbingQuote;
  revisions: PlumbingRevision[];
  onExport: (type: ExportType, share?: boolean) => void;
  onSaveRevision: () => void;
  onRestoreRevision: (revision: PlumbingRevision) => void;
}) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const rows: [string, string, string?][] = [
    ...quote.phases
      .filter((phase) => phase.materialCost > 0 || phase.laborHours > 0)
      .map(
        (phase) =>
          [
            PHASE_LABELS[phase.phase],
            formatCurrency(phase.materialCost + phase.laborCost),
            `${formatCurrency(phase.materialCost)} material + ${formatQty(phase.laborHours)} hr`
          ] as [string, string, string]
      ),
    ["Fixtures & equipment (Worth)", formatCurrency(quote.fixtureCost)],
    [
      "Testing, inspection & mobilization",
      formatCurrency((quote.testAndInspectHours + quote.mobilizationHours) * quote.laborRate),
      `${formatQty(quote.testAndInspectHours + quote.mobilizationHours)} hr`
    ],
    ["Sales tax on materials", formatCurrency(quote.materialTax)],
    ["Allowances", formatCurrency(quote.allowanceTotal)],
    ["Permit", formatCurrency(quote.permitFee)],
    ["Direct cost", formatCurrency(quote.directCost)],
    [`Overhead (${quote.overheadPercent}%)`, formatCurrency(quote.overhead)],
    [`Margin (${quote.marginPercent}%)`, formatCurrency(quote.margin)]
  ];

  return (
    <>
      <section className="step-content">
        <SectionTitle
          title="Quote"
          subtitle={`${quote.pricingName} v${quote.pricingVersion} · labor ${formatCurrency(quote.laborRate)}/hr · ${formatQty(quote.laborHours)} total hours`}
        />
        <dl className="pl-quote-rows">
          {rows.map(([label, value, detail]) => (
            <div key={label}>
              <dt>
                {label}
                {detail && <small>{detail}</small>}
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="pl-quote-total">
          <span>Estimated total</span>
          <strong>{formatCurrency(quote.total)}</strong>
        </div>
      </section>

      <section className="step-content">
        <SectionTitle
          title="Allowances"
          subtitle="Lump sums for scope the takeoff cannot count, such as core drilling, trenching, or fixture upgrades."
          action={
            <button
              type="button"
              className="text-button"
              onClick={() => updateJob((current) => ({ ...current, allowances: [...current.allowances, createAllowance()] }))}
            >
              <Plus size={15} /> Add
            </button>
          }
        />
        {job.allowances.length === 0 && <p className="field-note">No allowances.</p>}
        {job.allowances.map((allowance) => (
          <div className="pl-allowance" key={allowance.id}>
            <TextField
              label="Description"
              value={allowance.label}
              onChange={(label) =>
                updateJob((current) => ({
                  ...current,
                  allowances: current.allowances.map((candidate) => (candidate.id === allowance.id ? { ...candidate, label } : candidate))
                }))
              }
            />
            <MoneyField
              label="Amount ($)"
              value={allowance.amount}
              onChange={(amount) =>
                updateJob((current) => ({
                  ...current,
                  allowances: current.allowances.map((candidate) => (candidate.id === allowance.id ? { ...candidate, amount } : candidate))
                }))
              }
            />
            <button
              type="button"
              className="icon-button danger"
              aria-label={`Remove ${allowance.label}`}
              onClick={() => updateJob((current) => ({ ...current, allowances: current.allowances.filter((candidate) => candidate.id !== allowance.id) }))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </section>

      <section className="step-content">
        <SectionTitle title="Outputs" subtitle="PDFs use the current working copy and revision letter." />
        <div className="pl-output-grid">
          <button type="button" className="primary-button" onClick={() => onExport("takeoff")}>
            <FileDown size={16} /> Takeoff package PDF
          </button>
          <button type="button" className="primary-button" onClick={() => onExport("quote")}>
            <FileText size={16} /> Customer quote PDF
          </button>
          <button type="button" className="secondary-button" onClick={() => onExport("materials")}>
            <FileSpreadsheet size={16} /> Material list CSV
          </button>
          {canShare && (
            <button type="button" className="secondary-button" onClick={() => onExport("quote", true)}>
              <Share2 size={16} /> Share quote
            </button>
          )}
        </div>
      </section>

      <section className="step-content">
        <SectionTitle
          title="Revisions"
          subtitle={`Working copy is Rev ${job.revision}. Saving a revision freezes a snapshot you can restore later.`}
          action={
            <button type="button" className="secondary-button" onClick={onSaveRevision}>
              <Save size={16} /> Save revision
            </button>
          }
        />
        {revisions.length === 0 && <p className="field-note">No saved revisions yet.</p>}
        <div className="pl-job-list">
          {revisions.map((revision) => (
            <div className="elevation-row pl-job-row" key={revision.id}>
              <span>
                <strong>Rev {revision.number}</strong>
                <small>{new Date(revision.createdAt).toLocaleString()}</small>
              </span>
              <ConfirmButton className="text-button" confirmLabel="Tap again to restore" onConfirm={() => onRestoreRevision(revision)}>
                <History size={15} /> Restore
              </ConfirmButton>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin: JSON rule packs (open with ?admin=1 or #admin)
// ---------------------------------------------------------------------------

function PlumbingAdminPanel({
  config,
  onApply,
  onReset,
  onClose
}: {
  config: PlumbingConfig;
  onApply: (config: PlumbingConfig) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    fixtureLibrary: JSON.stringify(config.fixtureLibrary, null, 2),
    materialCatalog: JSON.stringify(config.materialCatalog, null, 2),
    pipingRulePack: JSON.stringify(config.pipingRulePack, null, 2),
    pricing: JSON.stringify(config.pricing, null, 2)
  });
  const [error, setError] = useState("");
  const editors: [keyof typeof draft, string][] = [
    ["pricing", "Pricing (labor rate, tax, overhead, margin)"],
    ["fixtureLibrary", "Fixture library (fixture units, kits, rough-in ranges)"],
    ["materialCatalog", "Material catalog (unit costs)"],
    ["pipingRulePack", "Piping rules (pipe costs, hanger spacing, sizing tables)"]
  ];

  const apply = () => {
    try {
      const next: PlumbingConfig = {
        fixtureLibrary: JSON.parse(draft.fixtureLibrary),
        materialCatalog: JSON.parse(draft.materialCatalog),
        pipingRulePack: JSON.parse(draft.pipingRulePack),
        pricing: JSON.parse(draft.pricing)
      };
      if (!Array.isArray(next.fixtureLibrary.fixtures) || !Array.isArray(next.materialCatalog.materials) || !Array.isArray(next.pipingRulePack.pipeMaterials)) {
        throw new Error("Fixture library, material catalog, and piping rules each need their item arrays.");
      }
      onApply(next);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
    }
  };

  return (
    <div className="admin-backdrop">
      <section className="admin-panel">
        <div className="admin-header">
          <div>
            <p className="eyebrow">Plumbing admin</p>
            <h2>Rule packs</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close rule packs">
            x
          </button>
        </div>
        {editors.map(([key, label]) => (
          <label className="config-editor" key={key}>
            <span>{label}</span>
            <textarea value={draft[key]} spellCheck={false} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
          </label>
        ))}
        {error && <div className="parse-error">{error}</div>}
        <div className="pl-button-row">
          <button className="primary-button" onClick={apply}>
            Apply rule packs
          </button>
          <button className="secondary-button" onClick={onReset}>
            Reset to defaults
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `$${(value / 1000).toFixed(1)}k`;
  return formatCurrency(Math.round(value)).replace(/\.00$/, "");
}

function upsert(jobs: PlumbingJob[], job: PlumbingJob): PlumbingJob[] {
  return [...jobs.filter((candidate) => candidate.id !== job.id), job];
}

function nearest(values: number[], target: number): number {
  return values.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best), values[0]);
}

function isAdminModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === "1" || window.location.hash === "#admin";
}

function loadStoredConfig(): PlumbingConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return defaultPlumbingConfig;
    const parsed = JSON.parse(raw) as Partial<PlumbingConfig>;
    return {
      fixtureLibrary: parsed.fixtureLibrary ?? defaultPlumbingConfig.fixtureLibrary,
      materialCatalog: parsed.materialCatalog ?? defaultPlumbingConfig.materialCatalog,
      pipingRulePack: parsed.pipingRulePack ?? defaultPlumbingConfig.pipingRulePack,
      pricing: parsed.pricing ?? defaultPlumbingConfig.pricing
    };
  } catch {
    return defaultPlumbingConfig;
  }
}

function storeConfig(config: PlumbingConfig | null) {
  try {
    if (config) localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing; the config still applies for this session.
  }
}
