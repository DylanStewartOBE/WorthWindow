import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ArrowLeftRight,
  Check,
  FileUp,
  Hand,
  Maximize2,
  Minimize2,
  MousePointer2,
  Plus,
  Ruler,
  Trash2,
  Undo2,
  Waypoints,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pipeSystemOptions, runLocationOptions } from "../config";
import { createArea, createId, createRun } from "../domain/jobs";
import { formatPipeSize, formatQty, parseFeet } from "../domain/math";
import type {
  FittingType,
  FixtureMarker,
  FurnishedBy,
  PipeSystem,
  PlanPoint,
  PlanRun,
  PlanSheet,
  PlumbingConfig,
  PlumbingJob,
  PlumbingTakeoff,
  RunLocation,
  TrenchMode
} from "../domain/types";
import { sheetLabel } from "../plan/analyze";
import { forgetPlanDocument, openPlanDocument, readPlanFile } from "../plan/pdfDocument";
import { createSamplePlanPdf } from "../plan/samplePlan";
import { COMMON_SCALES, detectScales } from "../plan/sheetInfo";
import type { PlumbingRepository } from "../persistence";
import { ConfirmButton, FeetField, ParsedField, Segmented, SectionTitle, SelectField, TextField } from "./fields";
import { PlanViewer, SYSTEM_COLORS, type PlanTool } from "./PlanViewer";

type UpdateJob = (updater: (job: PlumbingJob) => PlumbingJob) => void;

type DrawSettings = { system: PipeSystem; pipeMaterialId: string; size: number; location: RunLocation };

const TOOLS: { value: PlanTool; label: string; icon: typeof Hand }[] = [
  { value: "select", label: "Select", icon: MousePointer2 },
  { value: "pipe", label: "Pipe", icon: Waypoints },
  { value: "fixture", label: "Fixture", icon: Plus },
  { value: "calibrate", label: "Scale", icon: Ruler }
];

const SLOPE_OPTIONS = [
  { value: "default", label: "Rule default" },
  { value: "0", label: "Level" },
  { value: "0.125", label: `1/8" per ft` },
  { value: "0.25", label: `1/4" per ft` },
  { value: "0.5", label: `1/2" per ft` }
];

export function PlansStep({
  job,
  updateJob,
  config,
  takeoff,
  repository,
  onStatus
}: {
  job: PlumbingJob;
  updateJob: UpdateJob;
  config: PlumbingConfig;
  takeoff: PlumbingTakeoff;
  repository: PlumbingRepository;
  onStatus: (message: string) => void;
}) {
  const plans = job.plans;
  const [activeSheetId, setActiveSheetId] = useState<string | null>(plans.sheets[0]?.id ?? null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [missingFileId, setMissingFileId] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ name: string; done: number; total: number } | null>(null);
  const [tool, setTool] = useState<PlanTool>("select");
  const [angleSnap, setAngleSnap] = useState(true);
  const [draft, setDraft] = useState<PlanPoint[]>([]);
  const [calibration, setCalibration] = useState<PlanPoint[]>([]);
  const [calibrationText, setCalibrationText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fitSignal = 0;
  const [expanded, setExpanded] = useState(false);
  const [showAllSheets, setShowAllSheets] = useState(false);
  const [draw, setDraw] = useState<DrawSettings>(() => {
    const defaults = createRun("sanitary");
    return { system: "sanitary", pipeMaterialId: defaults.pipeMaterialId, size: defaults.size, location: "underground" };
  });
  const [fixtureChoice, setFixtureChoice] = useState<{ fixtureTypeId: string; furnishedBy: FurnishedBy }>({
    fixtureTypeId: "wc-tank",
    furnishedBy: "worth"
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const openSheet = (sheetId: string) => {
    setActiveSheetId(sheetId);
    requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const relinkInput = useRef<HTMLInputElement>(null);

  const sheet = plans.sheets.find((candidate) => candidate.id === activeSheetId) ?? null;
  const fixtures = config.fixtureLibrary.fixtures;
  const fixtureLabels = useMemo(() => new Map(fixtures.map((fixture) => [fixture.id, fixture.shortLabel])), [fixtures]);
  const sheetRuns = plans.runs.filter((run) => run.sheetId === activeSheetId);
  const sheetMarkers = plans.markers.filter((marker) => marker.sheetId === activeSheetId);
  const selectedRun = sheetRuns.find((run) => run.id === selectedId) ?? null;
  const selectedMarker = sheetMarkers.find((marker) => marker.id === selectedId) ?? null;
  const areaOptions = [{ value: "", label: "Building-wide" }, ...job.areas.map((area) => ({ value: area.id, label: area.name || "Unnamed area" }))];
  const sheetArea = job.areas.find((area) => area.id === sheet?.areaId);

  useEffect(() => {
    if (!activeSheetId && plans.sheets.length) setActiveSheetId(plans.sheets[0].id);
  }, [activeSheetId, plans.sheets]);

  // Load the page for the active sheet
  useEffect(() => {
    setPage(null);
    setMissingFileId(null);
    setDraft([]);
    setCalibration([]);
    setSelectedId(null);
    if (!sheet) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await repository.getPlanFile(sheet.fileId);
        if (!stored) {
          if (!cancelled) setMissingFileId(sheet.fileId);
          return;
        }
        const doc = await openPlanDocument(sheet.fileId, stored.data);
        const loaded = await doc.getPage(sheet.pageNumber);
        if (!cancelled) setPage(loaded);
      } catch (error) {
        if (!cancelled) onStatus(`Could not open the sheet: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Reload only when the sheet's file or page changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, sheet?.fileId, sheet?.pageNumber, repository]);

  const updatePlans = (updater: (current: PlumbingJob["plans"]) => PlumbingJob["plans"]) =>
    updateJob((current) => ({ ...current, plans: updater(current.plans) }));

  const updateSheet = (sheetId: string, patch: Partial<PlanSheet>) =>
    updatePlans((current) => ({ ...current, sheets: current.sheets.map((candidate) => (candidate.id === sheetId ? { ...candidate, ...patch } : candidate)) }));

  const updateRun = (runId: string, patch: Partial<PlanRun>) =>
    updatePlans((current) => ({ ...current, runs: current.runs.map((run) => (run.id === runId ? { ...run, ...patch } : run)) }));

  const updateMarker = (markerId: string, patch: Partial<FixtureMarker>) =>
    updatePlans((current) => ({ ...current, markers: current.markers.map((marker) => (marker.id === markerId ? { ...marker, ...patch } : marker)) }));

  const importPdf = async (file: Blob, name: string) => {
    const fileId = createId("pfile");
    setImporting({ name, done: 0, total: 1 });
    try {
      await repository.savePlanFile({ id: fileId, name, data: file });
      const named = Object.assign(file, { name });
      const { planFile, sheets } = await readPlanFile(fileId, named, (done, total) => setImporting({ name, done, total }));
      const newSheets: PlanSheet[] = sheets.map((draftSheet) => ({ ...draftSheet, id: createId("sheet"), fileId, areaId: "" }));
      updatePlans((current) => ({ ...current, files: [...current.files, planFile], sheets: [...current.sheets, ...newSheets] }));
      const first = newSheets.find((candidate) => candidate.notes.every((note) => !note.startsWith("Not marked"))) ?? newSheets[0];
      if (first) openSheet(first.id);
      onStatus(`Read ${planFile.pageCount} sheet${planFile.pageCount === 1 ? "" : "s"} from ${name}`);
    } catch (error) {
      await repository.deletePlanFile(fileId).catch(() => undefined);
      onStatus(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(null);
    }
  };

  const onFilesChosen = async (list: FileList | null) => {
    if (!list) return;
    for (const file of [...list]) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        onStatus(`${file.name} is not a PDF`);
        continue;
      }
      await importPdf(file, file.name);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const relinkFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file || !missingFileId) return;
    await repository.savePlanFile({ id: missingFileId, name: file.name, data: file });
    forgetPlanDocument(missingFileId);
    const id = activeSheetId;
    setActiveSheetId(null);
    setTimeout(() => setActiveSheetId(id), 0);
    onStatus(`Re-attached ${file.name}`);
  };

  const removeFile = async (fileId: string) => {
    const sheetIds = new Set(plans.sheets.filter((candidate) => candidate.fileId === fileId).map((candidate) => candidate.id));
    updatePlans((current) => ({
      files: current.files.filter((file) => file.id !== fileId),
      sheets: current.sheets.filter((candidate) => !sheetIds.has(candidate.id)),
      runs: current.runs.filter((run) => !sheetIds.has(run.sheetId)),
      markers: current.markers.filter((marker) => !sheetIds.has(marker.sheetId))
    }));
    if (activeSheetId && sheetIds.has(activeSheetId)) setActiveSheetId(null);
    forgetPlanDocument(fileId);
    await repository.deletePlanFile(fileId).catch(() => undefined);
    onStatus("Removed the PDF and everything drawn on it");
  };

  const finishDraft = (points = draft) => {
    if (!sheet || points.length < 2) {
      setDraft([]);
      return;
    }
    const run: PlanRun = {
      id: createId("prun"),
      sheetId: sheet.id,
      areaId: sheet.areaId,
      label: "",
      ...draw,
      points,
      extraVerticalFt: 0,
      startDepthFt: null,
      slopeInPerFt: null,
      trench: draw.location === "underground" ? "own" : "none"
    };
    updatePlans((current) => ({ ...current, runs: [...current.runs, run] }));
    setDraft([]);
    setSelectedId(run.id);
  };

  const onTap = (point: PlanPoint, hit: { runId?: string; markerId?: string }) => {
    if (!sheet) return;
    if (tool === "select") {
      setSelectedId(hit.markerId ?? hit.runId ?? null);
      return;
    }
    if (tool === "fixture") {
      const marker: FixtureMarker = { id: createId("pmk"), sheetId: sheet.id, areaId: sheet.areaId, ...fixtureChoice, x: point.x, y: point.y };
      updatePlans((current) => ({ ...current, markers: [...current.markers, marker] }));
      setSelectedId(marker.id);
      return;
    }
    if (tool === "calibrate") {
      setCalibration((current) => (current.length >= 2 ? [point] : [...current, point]));
      return;
    }
    // Pipe tool
    const last = draft[draft.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.01) {
      finishDraft();
      return;
    }
    const next = [...draft, point];
    // Landing on a fixture or another pipe ends the run there.
    if (draft.length >= 1 && (hit.markerId || hit.runId)) finishDraft(next);
    else setDraft(next);
  };

  const applyCalibration = () => {
    if (!sheet || calibration.length !== 2) return;
    const feet = parseFeet(calibrationText);
    const distance = Math.hypot(calibration[1].x - calibration[0].x, calibration[1].y - calibration[0].y);
    if (!feet || !distance) {
      onStatus("Enter the real distance between the two points, for example 15' or 15'-6\"");
      return;
    }
    const feetPerPoint = feet / distance;
    const feetPerInch = feetPerPoint * 72;
    const near = COMMON_SCALES.find((scale) => Math.abs(scale.feetPerInch - feetPerInch) / scale.feetPerInch < 0.015);
    updateSheet(sheet.id, {
      scale: {
        feetPerPoint,
        label: near ? `${near.label} (calibrated)` : `1" = ${formatQty(Math.round(feetPerInch * 100) / 100)}' (calibrated)`,
        source: "calibrated"
      }
    });
    setCalibration([]);
    setCalibrationText("");
    setTool("select");
    onStatus("Scale calibrated");
  };

  const setScaleByLabel = (label: string) => {
    if (!sheet) return;
    if (label === "none") {
      updateSheet(sheet.id, { scale: null });
      return;
    }
    const common = COMMON_SCALES.find((scale) => scale.label === label);
    const detected = detectScales(label)[0];
    const feetPerInch = common?.feetPerInch ?? detected?.feetPerInch;
    if (!feetPerInch) return;
    updateSheet(sheet.id, {
      scale: { feetPerPoint: feetPerInch / 72, label, source: sheet.detectedScales.includes(label) ? "detected" : "manual" }
    });
  };

  const changeDrawSystem = (system: PipeSystem) => {
    const material = config.pipingRulePack.pipeMaterials.find((candidate) => candidate.id === draw.pipeMaterialId);
    if (material?.allowedSystems.includes(system)) setDraw((current) => ({ ...current, system }));
    else {
      const defaults = createRun(system);
      setDraw((current) => ({ ...current, system, pipeMaterialId: defaults.pipeMaterialId, size: defaults.size }));
    }
  };

  const createAreaForSheet = () => {
    if (!sheet) return;
    const area = createArea(sheet.title || sheet.sheetNumber || `Sheet ${sheet.pageNumber}`);
    updateJob((current) => ({
      ...current,
      areas: [...current.areas, area],
      plans: {
        ...current.plans,
        sheets: current.plans.sheets.map((candidate) => (candidate.id === sheet.id ? { ...candidate, areaId: area.id } : candidate)),
        runs: current.plans.runs.map((run) => (run.sheetId === sheet.id && !run.areaId ? { ...run, areaId: area.id } : run)),
        markers: current.plans.markers.map((marker) => (marker.sheetId === sheet.id && !marker.areaId ? { ...marker, areaId: area.id } : marker))
      }
    }));
  };

  const visibleSheets = plans.sheets.filter(
    (candidate) => showAllSheets || candidate.notes.every((note) => !note.startsWith("Not marked")) || candidate.id === activeSheetId
  );
  const hiddenSheets = plans.sheets.length - visibleSheets.length;

  if (plans.files.length === 0) {
    return (
      <section className="step-content">
        <SectionTitle
          title="Plan Takeoff"
          subtitle="Upload the plumbing plans as a PDF. The app reads each sheet's number, title, and printed scale, then you draw pipe and tap fixtures on the sheet."
        />
        <div className="pl-plan-empty">
          <button type="button" className="primary-button" onClick={() => fileInput.current?.click()} disabled={!!importing}>
            <FileUp size={18} /> Upload plan PDF
          </button>
          <button type="button" className="secondary-button" onClick={() => importPdf(createSamplePlanPdf(), "sample-unit-a-plumbing-plan.pdf")} disabled={!!importing}>
            Try a sample plan
          </button>
          {importing && <ImportProgress importing={importing} />}
          <p className="field-note">PDFs stay on this device. Vector PDFs from CAD give the best results; scanned sheets work but need the scale set by hand.</p>
        </div>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => onFilesChosen(event.target.files)} />
      </section>
    );
  }

  const result = selectedRun ? takeoff.planRuns.find((candidate) => candidate.runId === selectedRun.id) : undefined;
  const selectedMaterial = config.pipingRulePack.pipeMaterials.find((material) => material.id === selectedRun?.pipeMaterialId);

  return (
    <>
      <section className="step-content">
        <SectionTitle
          title="Plan Takeoff"
          subtitle="Pick a sheet, check its scale, then draw. Runs and fixtures drawn here go straight into the takeoff."
          action={
            <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={!!importing}>
              <FileUp size={16} /> Add PDF
            </button>
          }
        />
        {importing && <ImportProgress importing={importing} />}
        <div className="pl-sheet-list" role="list">
          {visibleSheets.map((candidate) => {
            const runs = plans.runs.filter((run) => run.sheetId === candidate.id).length;
            const marks = plans.markers.filter((marker) => marker.sheetId === candidate.id).length;
            return (
              <button
                type="button"
                role="listitem"
                key={candidate.id}
                className={`pl-sheet-card${candidate.id === activeSheetId ? " selected" : ""}`}
                onClick={() => openSheet(candidate.id)}
              >
                <strong>{candidate.sheetNumber || `Page ${candidate.pageLabel}`}</strong>
                <span>{candidate.title || "Untitled sheet"}</span>
                <small className={`pl-scale-chip ${candidate.scale ? candidate.scale.source : "missing"}`}>
                  {candidate.scale ? candidate.scale.label : "No scale"}
                </small>
                <small>
                  {runs} run{runs === 1 ? "" : "s"} · {marks} fixture{marks === 1 ? "" : "s"}
                </small>
              </button>
            );
          })}
        </div>
        {hiddenSheets > 0 && (
          <button type="button" className="text-button" onClick={() => setShowAllSheets(true)}>
            Show {hiddenSheets} non-plumbing sheet{hiddenSheets === 1 ? "" : "s"}
          </button>
        )}
      </section>

      {sheet && (
        <section ref={workspaceRef} className={`step-content pl-plan-workspace${expanded ? " expanded" : ""}`}>
          <div className="pl-plan-head">
            <div>
              <h2>{sheetLabel(sheet)}</h2>
              <p className="field-note">
                {sheet.scale ? `Scale ${sheet.scale.label}` : "No scale yet. Set or calibrate it before drawing."}
                {sheetArea ? ` · Counts toward ${sheetArea.name} x${sheetArea.multiplier}` : " · Building-wide"}
              </p>
            </div>
            <button type="button" className="secondary-button pl-expand" onClick={() => setExpanded((value) => !value)}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {expanded ? "Done" : "Full screen"}
            </button>
          </div>

          <div className="pl-plan-toolbar" role="toolbar" aria-label="Plan tools">
            {TOOLS.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                className={tool === value ? "selected" : ""}
                aria-pressed={tool === value}
                onClick={() => {
                  setTool(value);
                  if (value !== "pipe") setDraft([]);
                  if (value !== "calibrate") setCalibration([]);
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
            <label className="pl-toggle">
              <input type="checkbox" checked={angleSnap} onChange={(event) => setAngleSnap(event.target.checked)} />
              <span>45° snap</span>
            </label>
          </div>

          {tool === "pipe" && (
            <div className="pl-plan-settings">
              <SelectField label="System" value={draw.system} options={pipeSystemOptions} onChange={changeDrawSystem} />
              <SelectField
                label="Material"
                value={draw.pipeMaterialId}
                options={config.pipingRulePack.pipeMaterials
                  .filter((material) => material.allowedSystems.includes(draw.system))
                  .map((material) => ({ value: material.id, label: `${material.label}` }))}
                onChange={(pipeMaterialId) => {
                  const sizes = config.pipingRulePack.pipeMaterials.find((material) => material.id === pipeMaterialId)?.sizes.map((spec) => spec.size) ?? [];
                  setDraw((current) => ({ ...current, pipeMaterialId, size: sizes.includes(current.size) ? current.size : sizes[0] ?? current.size }));
                }}
              />
              <SelectField
                label="Size"
                value={String(draw.size)}
                options={(config.pipingRulePack.pipeMaterials.find((material) => material.id === draw.pipeMaterialId)?.sizes ?? []).map((spec) => ({
                  value: String(spec.size),
                  label: formatPipeSize(spec.size)
                }))}
                onChange={(size) => setDraw((current) => ({ ...current, size: Number(size) }))}
              />
              <SelectField label="Location" value={draw.location} options={runLocationOptions} onChange={(location) => setDraw((current) => ({ ...current, location }))} />
            </div>
          )}

          {tool === "fixture" && (
            <div className="pl-plan-settings two">
              <SelectField
                label="Fixture"
                value={fixtureChoice.fixtureTypeId}
                options={fixtures.map((fixture) => ({ value: fixture.id, label: `${fixture.shortLabel} - ${fixture.label}` }))}
                onChange={(fixtureTypeId) =>
                  setFixtureChoice({ fixtureTypeId, furnishedBy: fixtures.find((fixture) => fixture.id === fixtureTypeId)?.defaultFurnishedBy ?? "worth" })
                }
              />
              <SelectField
                label="Furnished by"
                value={fixtureChoice.furnishedBy}
                options={[
                  { value: "worth", label: "Worth" },
                  { value: "others", label: "Others (install only)" }
                ]}
                onChange={(furnishedBy) => setFixtureChoice((current) => ({ ...current, furnishedBy }))}
              />
            </div>
          )}

          <p className="pl-plan-hint">{toolHint(tool, draft.length, calibration.length, !!sheet.scale)}</p>

          <div className="pl-plan-stage">
            {missingFileId ? (
              <div className="pl-plan-missing">
                <p>This PDF is not stored on this device. Re-attach the same file to keep drawing.</p>
                <button type="button" className="primary-button" onClick={() => relinkInput.current?.click()}>
                  <FileUp size={16} /> Re-attach PDF
                </button>
                <input ref={relinkInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => relinkFile(event.target.files)} />
              </div>
            ) : (
              <PlanViewer
                page={page}
                widthPt={sheet.widthPt}
                heightPt={sheet.heightPt}
                runs={sheetRuns}
                markers={sheetMarkers}
                draft={draft}
                draftSystem={draw.system}
                calibration={calibration}
                tool={tool}
                angleSnap={angleSnap}
                selectedId={selectedId}
                fixtureLabels={fixtureLabels}
                feetPerPoint={sheet.scale?.feetPerPoint ?? null}
                fitSignal={fitSignal}
                onTap={onTap}
                onFinishDraft={() => finishDraft()}
                onUndoPoint={() => setDraft((current) => current.slice(0, -1))}
                onCancelDraft={() => setDraft([])}
              />
            )}
          </div>

          {tool === "pipe" && draft.length > 0 && (
            <div className="pl-plan-actions">
              <button type="button" className="secondary-button" onClick={() => setDraft((current) => current.slice(0, -1))}>
                <Undo2 size={16} /> Undo point
              </button>
              <button type="button" className="secondary-button" onClick={() => setDraft([])}>
                <X size={16} /> Cancel
              </button>
              <button type="button" className="primary-button" onClick={() => finishDraft()} disabled={draft.length < 2}>
                <Check size={16} /> Finish run
              </button>
            </div>
          )}

          {tool === "calibrate" && calibration.length === 2 && (
            <div className="pl-plan-actions">
              <TextField
                label="Real distance between the two points"
                value={calibrationText}
                placeholder={`e.g. 15' or 15'-6"`}
                onChange={setCalibrationText}
              />
              <button type="button" className="primary-button" onClick={applyCalibration}>
                <Ruler size={16} /> Set scale
              </button>
            </div>
          )}

          <div className="pl-plan-panels">
            {selectedRun && (
              <div className="pl-plan-panel">
                <div className="pl-panel-head">
                  <span className="pl-swatch" style={{ background: SYSTEM_COLORS[selectedRun.system] }} />
                  <strong>{result?.label ?? "Pipe run"}</strong>
                </div>
                {result?.measured ? (
                  <>
                    <dl className="pl-facts">
                      <div>
                        <dt>Plan length</dt>
                        <dd>{formatQty(result.horizontalFt)} ft</dd>
                      </div>
                      <div>
                        <dt>Rises / drops</dt>
                        <dd>{formatQty(result.verticalFt)} ft</dd>
                      </div>
                      <div>
                        <dt>Total pipe</dt>
                        <dd>{formatQty(result.totalFt)} ft</dd>
                      </div>
                      <div>
                        <dt>Fixtures served</dt>
                        <dd>{result.fixtureConnections}</dd>
                      </div>
                    </dl>
                    <div className="pl-fitting-list">
                      <span>Fittings</span>
                      {result.fittingItems.length === 0 && <small>None</small>}
                      {result.fittingItems.map((item) => (
                        <small key={`${item.type}-${item.size}-${item.branchSize ?? ""}`}>
                          {item.qty} x {item.branchSize ? `${formatPipeSize(item.size)} x ${formatPipeSize(item.branchSize)}` : formatPipeSize(item.size)}{" "}
                          {fittingName(item.type, selectedMaterial?.family ?? "pressure", config)}
                        </small>
                      ))}
                      {result.bends.some((bend) => bend.offAngle) && <small className="pl-warn-text">Some bends are off standard angles.</small>}
                    </div>
                    {result.trench && (
                      <div className="pl-fitting-list">
                        <span>Trench</span>
                        <small>
                          {formatQty(result.trench.lengthFt)} ft long, {formatQty(Math.round(result.trench.widthFt * 12))}" wide, {formatQty(result.trench.startDepthFt)} ft deep at the high end, {formatQty(result.trench.endDepthFt)} ft at the low end
                        </small>
                        <small>
                          Dig {formatQty(result.trench.excavationCy)} cy · bedding {formatQty(result.trench.beddingCy)} cy · backfill {formatQty(result.trench.backfillCy)} cy
                        </small>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="pl-warn-text">Not measured: this sheet has no scale.</p>
                )}
                <div className="field-grid compact">
                  <TextField label="Label" value={selectedRun.label} placeholder="e.g. Bath group waste" onChange={(label) => updateRun(selectedRun.id, { label })} />
                  <SelectField label="Area" value={selectedRun.areaId} options={areaOptions} onChange={(areaId) => updateRun(selectedRun.id, { areaId })} />
                  <SelectField
                    label="System"
                    value={selectedRun.system}
                    options={pipeSystemOptions}
                    onChange={(system) => {
                      const material = config.pipingRulePack.pipeMaterials.find((candidate) => candidate.id === selectedRun.pipeMaterialId);
                      if (material?.allowedSystems.includes(system)) updateRun(selectedRun.id, { system });
                      else {
                        const defaults = createRun(system);
                        updateRun(selectedRun.id, { system, pipeMaterialId: defaults.pipeMaterialId, size: defaults.size });
                      }
                    }}
                  />
                  <SelectField
                    label="Material"
                    value={selectedRun.pipeMaterialId}
                    options={config.pipingRulePack.pipeMaterials
                      .filter((material) => material.allowedSystems.includes(selectedRun.system))
                      .map((material) => ({ value: material.id, label: material.label }))}
                    onChange={(pipeMaterialId) => {
                      const sizes = config.pipingRulePack.pipeMaterials.find((material) => material.id === pipeMaterialId)?.sizes.map((spec) => spec.size) ?? [];
                      updateRun(selectedRun.id, { pipeMaterialId, size: sizes.includes(selectedRun.size) ? selectedRun.size : sizes[0] ?? selectedRun.size });
                    }}
                  />
                  <SelectField
                    label="Size"
                    value={String(selectedRun.size)}
                    options={(selectedMaterial?.sizes ?? []).map((spec) => ({ value: String(spec.size), label: formatPipeSize(spec.size) }))}
                    onChange={(size) => updateRun(selectedRun.id, { size: Number(size) })}
                  />
                  <SelectField
                    label="Location"
                    value={selectedRun.location}
                    options={runLocationOptions}
                    onChange={(location) => updateRun(selectedRun.id, { location, trench: location === "underground" ? "own" : "none" })}
                  />
                  <FeetField label="Extra rises / drops (ft)" value={selectedRun.extraVerticalFt} onChange={(extraVerticalFt) => updateRun(selectedRun.id, { extraVerticalFt })} />
                </div>
                {selectedRun.location === "underground" && (
                  <>
                    <div className="field-grid compact">
                      <ParsedField
                        label="Depth at high end (ft)"
                        value={selectedRun.startDepthFt}
                        format={(value) => formatQty(value)}
                        parse={parseFeet}
                        placeholder={`Default ${config.pipingRulePack.plan.defaultDepthFt[selectedRun.system] ?? 1.5}`}
                        onChange={(startDepthFt) => updateRun(selectedRun.id, { startDepthFt })}
                      />
                      <SelectField
                        label="Slope"
                        value={selectedRun.slopeInPerFt === null ? "default" : String(selectedRun.slopeInPerFt)}
                        options={SLOPE_OPTIONS}
                        onChange={(value) => updateRun(selectedRun.id, { slopeInPerFt: value === "default" ? null : Number(value) })}
                      />
                    </div>
                    <Segmented<TrenchMode>
                      label="Trench"
                      value={selectedRun.trench}
                      options={[
                        { value: "own", label: "Own trench" },
                        { value: "shared", label: "Shares a trench" },
                        { value: "none", label: "No digging" }
                      ]}
                      onChange={(trench) => updateRun(selectedRun.id, { trench })}
                    />
                  </>
                )}
                <div className="pl-button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => updateRun(selectedRun.id, { points: [...selectedRun.points].reverse() })}
                    title="Pipe falls toward the first point drawn"
                  >
                    <ArrowLeftRight size={16} /> Reverse direction
                  </button>
                  <ConfirmButton
                    className="secondary-button pl-danger"
                    confirmLabel="Tap again to delete"
                    onConfirm={() => {
                      updatePlans((current) => ({ ...current, runs: current.runs.filter((run) => run.id !== selectedRun.id) }));
                      setSelectedId(null);
                    }}
                  >
                    <Trash2 size={16} /> Delete run
                  </ConfirmButton>
                </div>
              </div>
            )}

            {selectedMarker && (
              <div className="pl-plan-panel">
                <div className="pl-panel-head">
                  <strong>{fixtures.find((fixture) => fixture.id === selectedMarker.fixtureTypeId)?.label ?? "Fixture"}</strong>
                </div>
                <div className="field-grid compact">
                  <SelectField
                    label="Fixture"
                    value={selectedMarker.fixtureTypeId}
                    options={fixtures.map((fixture) => ({ value: fixture.id, label: `${fixture.shortLabel} - ${fixture.label}` }))}
                    onChange={(fixtureTypeId) => updateMarker(selectedMarker.id, { fixtureTypeId })}
                  />
                  <SelectField label="Area" value={selectedMarker.areaId} options={areaOptions} onChange={(areaId) => updateMarker(selectedMarker.id, { areaId })} />
                </div>
                <Segmented<FurnishedBy>
                  label="Furnished by"
                  value={selectedMarker.furnishedBy}
                  options={[
                    { value: "worth", label: "Worth" },
                    { value: "others", label: "By others" }
                  ]}
                  onChange={(furnishedBy) => updateMarker(selectedMarker.id, { furnishedBy })}
                />
                <ConfirmButton
                  className="secondary-button pl-danger"
                  confirmLabel="Tap again to delete"
                  onConfirm={() => {
                    updatePlans((current) => ({ ...current, markers: current.markers.filter((marker) => marker.id !== selectedMarker.id) }));
                    setSelectedId(null);
                  }}
                >
                  <Trash2 size={16} /> Delete fixture
                </ConfirmButton>
              </div>
            )}

            <div className="pl-plan-panel">
              <div className="pl-panel-head">
                <strong>Sheet</strong>
              </div>
              <div className="field-grid compact">
                <TextField label="Sheet number" value={sheet.sheetNumber} onChange={(sheetNumber) => updateSheet(sheet.id, { sheetNumber })} />
                <TextField label="Title" value={sheet.title} onChange={(title) => updateSheet(sheet.id, { title })} />
                <SelectField
                  label="Scale"
                  value={sheet.scale?.label ?? "none"}
                  options={[
                    { value: "none", label: "No scale" },
                    ...(sheet.scale && !sheet.detectedScales.includes(sheet.scale.label) && !COMMON_SCALES.some((scale) => scale.label === sheet.scale!.label)
                      ? [{ value: sheet.scale.label, label: sheet.scale.label }]
                      : []),
                    ...sheet.detectedScales.map((label) => ({ value: label, label: `${label} (on sheet)` })),
                    ...COMMON_SCALES.filter((scale) => !sheet.detectedScales.includes(scale.label)).map((scale) => ({ value: scale.label, label: scale.label }))
                  ]}
                  onChange={setScaleByLabel}
                />
                <SelectField label="Counts toward area" value={sheet.areaId} options={areaOptions} onChange={(areaId) => updateSheet(sheet.id, { areaId })} />
              </div>
              <div className="pl-button-row">
                <button type="button" className="secondary-button" onClick={() => setTool("calibrate")}>
                  <Ruler size={16} /> Calibrate scale
                </button>
                {!sheet.areaId && (
                  <button type="button" className="secondary-button" onClick={createAreaForSheet}>
                    <Plus size={16} /> Make an area for this sheet
                  </button>
                )}
              </div>
              {sheet.notes.length > 0 && (
                <ul className="pl-notes-list">
                  {sheet.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              {sheetRuns.length > 0 && (
                <div className="pl-run-list">
                  {sheetRuns.map((run) => {
                    const runResult = takeoff.planRuns.find((candidate) => candidate.runId === run.id);
                    return (
                      <button
                        type="button"
                        key={run.id}
                        className={run.id === selectedId ? "selected" : ""}
                        onClick={() => {
                          setTool("select");
                          setSelectedId(run.id);
                        }}
                      >
                        <span className="pl-swatch" style={{ background: SYSTEM_COLORS[run.system] }} />
                        <span>
                          {runResult?.label ?? run.id} · {formatPipeSize(run.size)}
                        </span>
                        <small>{runResult?.measured ? `${formatQty(runResult.totalFt)} ft` : "no scale"}</small>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="step-content">
        <SectionTitle title="Plan Files" subtitle="Document details read from each PDF." />
        <div className="pl-file-list">
          {plans.files.map((file) => (
            <div key={file.id} className="pl-file-row">
              <div>
                <strong>{file.name}</strong>
                <small>
                  {file.pageCount} sheet{file.pageCount === 1 ? "" : "s"} · {formatBytes(file.sizeBytes)}
                  {file.info.title ? ` · ${file.info.title}` : ""}
                </small>
                <small>
                  {[file.info.author && `By ${file.info.author}`, file.info.creator && `Made with ${file.info.creator}`, file.info.created && `Created ${file.info.created}`, file.info.modified && `Modified ${file.info.modified}`]
                    .filter(Boolean)
                    .join(" · ") || "No document details in this PDF"}
                </small>
              </div>
              <ConfirmButton className="text-button pl-danger-text" confirmLabel="Tap again: removes drawings too" onConfirm={() => removeFile(file.id)}>
                <Trash2 size={15} /> Remove
              </ConfirmButton>
            </div>
          ))}
        </div>
      </section>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => onFilesChosen(event.target.files)} />
    </>
  );
}

function ImportProgress({ importing }: { importing: { name: string; done: number; total: number } }) {
  return (
    <div className="pl-import" role="status">
      <span>
        Reading {importing.name}: sheet {importing.done} of {importing.total}
      </span>
      <progress max={importing.total} value={importing.done} />
    </div>
  );
}

function toolHint(tool: PlanTool, draftPoints: number, calibrationPoints: number, hasScale: boolean): string {
  if (!hasScale && tool !== "calibrate") return "Set the scale first: pick it under Sheet, or use Scale and tap both ends of a known dimension.";
  if (tool === "select") return "Tap a run or fixture to edit it. Drag to pan; pinch or scroll to zoom.";
  if (tool === "fixture") return "Tap a fixture symbol to count it. Pipe runs can end on it.";
  if (tool === "calibrate") {
    if (calibrationPoints === 0) return "Tap one end of a dimension you know, like a dimension string or a door width.";
    if (calibrationPoints === 1) return "Now tap the other end.";
    return "Enter the real distance and set the scale.";
  }
  if (draftPoints === 0) return "Tap where the run starts, at the downstream end. Start on a pipe to branch off it.";
  return "Tap each turn. End on a fixture or another pipe, tap the last point again, or press Finish run.";
}

function fittingName(type: FittingType, family: "dwv" | "pressure", config: PlumbingConfig): string {
  const rule = config.pipingRulePack.fittingTypes.find((candidate) => candidate.type === type);
  if (!rule) return type;
  return family === "dwv" ? rule.dwvLabel : rule.pressureLabel;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
