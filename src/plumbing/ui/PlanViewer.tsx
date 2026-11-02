import type { PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FixtureMarker, PipeSystem, PlanPoint, PlanRun } from "../domain/types";

export type PlanTool = "select" | "pipe" | "fixture" | "calibrate";

export const SYSTEM_COLORS: Record<PipeSystem, string> = {
  sanitary: "#92400e",
  vent: "#ca8a04",
  cold: "#1d4ed8",
  hot: "#dc2626",
  "hot-return": "#db2777",
  gas: "#a16207",
  storm: "#0f766e",
  condensate: "#7c3aed"
};

type View = { zoom: number; x: number; y: number };

export interface PlanViewerProps {
  page: PDFPageProxy | null;
  widthPt: number;
  heightPt: number;
  runs: PlanRun[];
  markers: FixtureMarker[];
  draft: PlanPoint[];
  draftSystem: PipeSystem;
  calibration: PlanPoint[];
  tool: PlanTool;
  angleSnap: boolean;
  selectedId: string | null;
  fixtureLabels: Map<string, string>;
  feetPerPoint: number | null;
  fitSignal: number;
  onTap: (point: PlanPoint, hit: { runId?: string; markerId?: string }) => void;
  onFinishDraft: () => void;
  onUndoPoint: () => void;
  onCancelDraft: () => void;
}

const SNAP_PX = 14;
const TAP_SLOP_PX = { mouse: 3, pen: 6, touch: 9 } as const;
const MAX_ZOOM = 10;

export function PlanViewer(props: PlanViewerProps) {
  const { page, widthPt, heightPt, runs, markers, draft, tool, angleSnap, selectedId, fitSignal } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 0.3, x: 0, y: 0 });
  const [rendered, setRendered] = useState<View | null>(null);
  const [hover, setHover] = useState<PlanPoint | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Track container size
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h || !widthPt || !heightPt) return;
    const zoom = Math.min(size.w / widthPt, size.h / heightPt) * 0.98;
    setView({ zoom, x: (size.w - widthPt * zoom) / 2, y: (size.h - heightPt * zoom) / 2 });
  }, [size.w, size.h, widthPt, heightPt]);

  // Fit only when a sheet opens or Fit is pressed. Later resizes leave the sheet exactly where it is
  // on screen, so buttons appearing mid-drawing never move it under the user's finger.
  const fittedPage = useRef<PDFPageProxy | null | undefined>(undefined);
  useEffect(() => {
    if (!size.w || !size.h || fittedPage.current === page) return;
    fittedPage.current = page;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, page]);
  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Render the visible part of the page into an offscreen canvas, then swap it in (no flash).
  useEffect(() => {
    if (!page || !size.w || !size.h) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const target = view;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const buffer = document.createElement("canvas");
      buffer.width = Math.round(size.w * dpr);
      buffer.height = Math.round(size.h * dpr);
      const context = buffer.getContext("2d");
      if (!context) return;
      context.fillStyle = "#e2e8f0";
      context.fillRect(0, 0, buffer.width, buffer.height);
      const viewport = page.getViewport({ scale: target.zoom * dpr });
      task = page.render({ canvas: buffer, canvasContext: context, viewport, transform: [1, 0, 0, 1, target.x * dpr, target.y * dpr], background: "#ffffff" });
      try {
        await task.promise;
      } catch {
        return; // cancelled by a newer render
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      canvas.getContext("2d")?.drawImage(buffer, 0, 0);
      setRendered(target);
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [page, view, size.w, size.h]);

  const toPage = useCallback((clientX: number, clientY: number): PlanPoint => {
    const box = containerRef.current!.getBoundingClientRect();
    const current = viewRef.current;
    return { x: (clientX - box.left - current.x) / current.zoom, y: (clientY - box.top - current.y) / current.zoom };
  }, []);

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    setView((current) => {
      const minZoom = Math.min(size.w / (widthPt || 1), size.h / (heightPt || 1)) * 0.4;
      const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return { zoom, x: screenX - (screenX - current.x) * ratio, y: screenY - (screenY - current.y) * ratio };
    });
  }, [size.w, size.h, widthPt, heightPt]);

  // Wheel and trackpad: zoom (pinch arrives as ctrl+wheel), shift+wheel pans
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (event.shiftKey) {
        setView((current) => ({ ...current, x: current.x - event.deltaY, y: current.y - event.deltaX }));
        return;
      }
      const intensity = event.ctrlKey ? 0.012 : 0.0018;
      zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * intensity));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Pointer gestures: one finger/pen/mouse drag pans, a still press taps, two fingers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { type: "single"; startX: number; startY: number; view0: View; moved: boolean; pointerType: string }
    | { type: "pinch"; distance0: number; mid0: { x: number; y: number }; view0: View }
    | null
  >(null);

  const snap = useCallback(
    (raw: PlanPoint): { point: PlanPoint; runId?: string; markerId?: string } => {
      const radius = SNAP_PX / viewRef.current.zoom;
      const sameTool = tool === "pipe" || tool === "calibrate";
      let best: { point: PlanPoint; d: number; runId?: string; markerId?: string } | null = null;
      const consider = (point: PlanPoint, extra: { runId?: string; markerId?: string }) => {
        const d = Math.hypot(point.x - raw.x, point.y - raw.y);
        if (d <= radius && (!best || d < best.d)) best = { point, d, ...extra };
      };
      if (tool !== "fixture") {
        markers.forEach((marker) => consider({ x: marker.x, y: marker.y }, { markerId: marker.id }));
        runs.forEach((run) => run.points.forEach((point) => consider(point, { runId: run.id })));
        if (sameTool && draft.length > 0) consider(draft[0], {});
      }
      if (best) return best;

      if (tool === "pipe" || tool === "select") {
        for (const run of runs) {
          for (let i = 0; i < run.points.length - 1; i += 1) {
            const projection = projectOnSegment(raw, run.points[i], run.points[i + 1]);
            if (projection && Math.hypot(projection.x - raw.x, projection.y - raw.y) <= radius) {
              if (tool === "select") return { point: raw, runId: run.id };
              let point = projection;
              const last = draft[draft.length - 1];
              if (last && angleSnap) point = intersectWithAngleSnap(last, raw, run.points[i], run.points[i + 1]) ?? projection;
              return { point, runId: run.id };
            }
          }
        }
      }

      const last = draft[draft.length - 1];
      if (sameTool && angleSnap && last) return { point: snapAngle(last, raw) };
      return { point: raw };
    },
    [tool, markers, runs, draft, angleSnap]
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    containerRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { type: "single", startX: event.clientX, startY: event.clientY, view0: viewRef.current, moved: false, pointerType: event.pointerType };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        type: "pinch",
        distance0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view0: viewRef.current
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (current?.type === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const box = containerRef.current!.getBoundingClientRect();
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top };
      const mid0 = { x: current.mid0.x - box.left, y: current.mid0.y - box.top };
      const zoom = Math.min(MAX_ZOOM, Math.max(0.02, current.view0.zoom * (distance / current.distance0)));
      const pageX = (mid0.x - current.view0.x) / current.view0.zoom;
      const pageY = (mid0.y - current.view0.y) / current.view0.zoom;
      setView({ zoom, x: mid.x - pageX * zoom, y: mid.y - pageY * zoom });
      return;
    }
    if (current?.type === "single" && pointers.current.has(event.pointerId)) {
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const slop = TAP_SLOP_PX[current.pointerType as keyof typeof TAP_SLOP_PX] ?? 6;
      if (current.moved || Math.hypot(dx, dy) > slop) {
        current.moved = true;
        setView({ ...current.view0, x: current.view0.x + dx, y: current.view0.y + dy });
      }
      return;
    }
    if (event.pointerType === "mouse" && (tool === "pipe" || tool === "calibrate")) setHover(snap(toPage(event.clientX, event.clientY)).point);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (current?.type === "single" && !current.moved && event.type === "pointerup") {
      const hit = snap(toPage(event.clientX, event.clientY));
      props.onTap(hit.point, { runId: hit.runId, markerId: hit.markerId });
    }
    // After a pinch, wait for all fingers to lift before treating anything as a tap.
    gesture.current = pointers.current.size === 0 ? null : { type: "single", startX: 0, startY: 0, view0: viewRef.current, moved: true, pointerType: "touch" };
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") props.onFinishDraft();
    else if (event.key === "Escape") props.onCancelDraft();
    else if (event.key === "Backspace" || event.key === "Delete") props.onUndoPoint();
    else if (event.key === "+" || event.key === "=") zoomAt(size.w / 2, size.h / 2, 1.25);
    else if (event.key === "-") zoomAt(size.w / 2, size.h / 2, 0.8);
    else return;
    event.preventDefault();
  };

  // CSS transform maps the last rendered bitmap onto the current view while a new one renders.
  const canvasTransform = rendered
    ? (() => {
        const scale = view.zoom / rendered.zoom;
        return `translate(${view.x - rendered.x * scale}px, ${view.y - rendered.y * scale}px) scale(${scale})`;
      })()
    : undefined;

  const px = 1 / view.zoom; // one screen pixel in page units
  const draftPreview = useMemo(() => {
    if (!hover || draft.length === 0 || tool !== "pipe") return null;
    return [draft[draft.length - 1], hover];
  }, [hover, draft, tool]);

  const liveFeet =
    props.feetPerPoint && draft.length > 0
      ? polylineLength(draftPreview ? [...draft, draftPreview[1]] : draft) * props.feetPerPoint
      : null;

  return (
    <div
      ref={containerRef}
      className={`pl-plan-viewer tool-${tool}`}
      tabIndex={0}
      role="application"
      aria-label="Plan sheet. Drag to pan, pinch or scroll to zoom, tap to place points."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="pl-plan-canvas" style={{ width: size.w, height: size.h, transform: canvasTransform }} />
      <svg className="pl-plan-overlay" width={size.w} height={size.h}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {runs.map((run) => {
            const selected = run.id === selectedId;
            const color = SYSTEM_COLORS[run.system];
            const points = run.points.map((point) => `${point.x},${point.y}`).join(" ");
            return (
              <g key={run.id} opacity={selectedId && !selected ? 0.75 : 1}>
                {selected && <polyline points={points} fill="none" stroke="#facc15" strokeWidth={11 * px} strokeLinejoin="round" strokeLinecap="round" />}
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth={(selected ? 5 : 3.5) * px}
                  strokeDasharray={run.location === "underground" ? `${10 * px} ${5 * px}` : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {run.points.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r={(index === 0 || index === run.points.length - 1 ? 3.5 : 2.5) * px} fill="#ffffff" stroke={color} strokeWidth={1.5 * px} />
                ))}
              </g>
            );
          })}

          {props.markers.map((marker) => {
            const selected = marker.id === selectedId;
            const label = props.fixtureLabels.get(marker.fixtureTypeId) ?? "FX";
            return (
              <g key={marker.id} transform={`translate(${marker.x} ${marker.y})`}>
                <circle r={13 * px} fill={selected ? "#facc15" : "#ffffff"} stroke="#0f172a" strokeWidth={2 * px} />
                <text y={4 * px} textAnchor="middle" fontSize={10 * px} fontWeight={800} fill="#0f172a">
                  {label}
                </text>
              </g>
            );
          })}

          {draft.length > 0 && (
            <polyline
              points={draft.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={SYSTEM_COLORS[props.draftSystem]}
              strokeWidth={3.5 * px}
              strokeDasharray={`${6 * px} ${4 * px}`}
              strokeLinejoin="round"
            />
          )}
          {draftPreview && (
            <line
              x1={draftPreview[0].x}
              y1={draftPreview[0].y}
              x2={draftPreview[1].x}
              y2={draftPreview[1].y}
              stroke={SYSTEM_COLORS[props.draftSystem]}
              strokeWidth={2 * px}
              strokeDasharray={`${4 * px} ${4 * px}`}
            />
          )}
          {draft.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={4 * px} fill={index === 0 ? "#ffffff" : SYSTEM_COLORS[props.draftSystem]} stroke="#0f172a" strokeWidth={1.2 * px} />
          ))}

          {props.calibration.map((point, index) => (
            <g key={index}>
              <line x1={point.x - 10 * px} y1={point.y} x2={point.x + 10 * px} y2={point.y} stroke="#0f172a" strokeWidth={1.5 * px} />
              <line x1={point.x} y1={point.y - 10 * px} x2={point.x} y2={point.y + 10 * px} stroke="#0f172a" strokeWidth={1.5 * px} />
            </g>
          ))}
          {props.calibration.length === 2 && (
            <line
              x1={props.calibration[0].x}
              y1={props.calibration[0].y}
              x2={props.calibration[1].x}
              y2={props.calibration[1].y}
              stroke="#0f172a"
              strokeWidth={1.5 * px}
              strokeDasharray={`${5 * px} ${3 * px}`}
            />
          )}
        </g>
      </svg>
      {!page && <div className="pl-plan-loading">Loading sheet...</div>}
      {liveFeet !== null && (
        <div className="pl-plan-readout" aria-live="polite">
          {liveFeet.toFixed(1)} ft drawn
        </div>
      )}
      <div className="pl-plan-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.4)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.4)}>
          -
        </button>
        <button type="button" aria-label="Fit sheet" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}

function projectOnSegment(point: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (!lengthSq) return null;
  const t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq;
  if (t <= 0 || t >= 1) return null;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Keeps the new segment on a 45-degree direction from the last point, same length. */
function snapAngle(from: PlanPoint, to: PlanPoint): PlanPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** Where a 45-degree ray from `from` crosses segment a-b, so a branch lands square on the main. */
function intersectWithAngleSnap(from: PlanPoint, raw: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint | null {
  const target = snapAngle(from, raw);
  const rx = target.x - from.x;
  const ry = target.y - from.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((a.x - from.x) * sy - (a.y - from.y) * sx) / denominator;
  const u = ((a.x - from.x) * ry - (a.y - from.y) * rx) / denominator;
  if (t <= 0 || u <= 0 || u >= 1) return null;
  return { x: from.x + rx * t, y: from.y + ry * t };
}

function polylineLength(points: PlanPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}
