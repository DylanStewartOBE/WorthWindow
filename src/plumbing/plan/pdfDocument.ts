import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PlanFile, PlanSheet } from "../domain/types";
import { describePaper, detectScales, detectSheetIdentity, type TextRun } from "./sheetInfo";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | undefined;

/** pdf.js is loaded on first use so the rest of the app does not pay for it. */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

const openDocuments = new Map<string, Promise<PDFDocumentProxy>>();

export async function openPlanDocument(fileId: string, data: Blob): Promise<PDFDocumentProxy> {
  let pending = openDocuments.get(fileId);
  if (!pending) {
    pending = (async () => {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await data.arrayBuffer());
      return pdfjs.getDocument({ data: bytes }).promise;
    })();
    openDocuments.set(fileId, pending);
    pending.catch(() => openDocuments.delete(fileId));
  }
  return pending;
}

export function forgetPlanDocument(fileId: string) {
  const pending = openDocuments.get(fileId);
  openDocuments.delete(fileId);
  pending?.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
}

export type SheetDraft = Omit<PlanSheet, "id" | "areaId" | "fileId">;

/** Reads document info and, for each page, its size, sheet number, title, and printed scales. */
export async function readPlanFile(
  fileId: string,
  file: Blob & { name?: string },
  onProgress?: (done: number, total: number) => void
): Promise<{ planFile: PlanFile; sheets: SheetDraft[] }> {
  const doc = await openPlanDocument(fileId, file);
  const metadata = await doc.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as Record<string, unknown>;
  const labels = await doc.getPageLabels().catch(() => null);
  const sheets: SheetDraft[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    sheets.push(await readSheet(page, labels?.[pageNumber - 1] ?? String(pageNumber)));
    page.cleanup();
    onProgress?.(pageNumber, doc.numPages);
  }

  return {
    planFile: {
      id: fileId,
      name: file.name ?? "plans.pdf",
      sizeBytes: file.size,
      pageCount: doc.numPages,
      uploadedAt: new Date().toISOString(),
      info: {
        title: text(info.Title),
        author: text(info.Author),
        subject: text(info.Subject),
        creator: text(info.Creator),
        producer: text(info.Producer),
        created: pdfDate(info.CreationDate),
        modified: pdfDate(info.ModDate)
      }
    },
    sheets
  };
}

async function readSheet(page: PDFPageProxy, pageLabel: string): Promise<SheetDraft> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent().catch(() => ({ items: [] as unknown[] }));
  const runs: TextRun[] = [];
  (content.items as { str?: string; transform?: number[] }[]).forEach((item) => {
    if (!item.str?.trim() || !item.transform) return;
    const [, , c, d] = item.transform;
    runs.push({ text: item.str, height: Math.hypot(c, d) });
  });

  const joined = runs.map((run) => run.text).join(" ");
  const scales = detectScales(joined);
  const identity = detectSheetIdentity(mergeAdjacent(runs));
  const paper = describePaper(viewport.width, viewport.height);
  const notes: string[] = [`Paper: ${paper.label}`];
  if (paper.reduced && scales.length) notes.push("Small sheet: if this is a reduced print, the printed scale is wrong. Calibrate before measuring.");
  if (scales.length > 1) notes.push(`More than one scale on this sheet (${scales.map((scale) => scale.label).join(", ")}). Check the one in use.`);
  if (runs.length === 0) notes.push("No text layer (scanned sheet). Set or calibrate the scale by hand.");
  if (!identity.isPlumbing) notes.push("Not marked as a plumbing sheet.");

  return {
    pageNumber: page.pageNumber,
    pageLabel,
    sheetNumber: identity.sheetNumber,
    title: identity.title,
    widthPt: viewport.width,
    heightPt: viewport.height,
    detectedScales: scales.map((scale) => scale.label),
    scale: scales[0] ? { feetPerPoint: scales[0].feetPerPoint, label: scales[0].label, source: "detected" } : null,
    notes
  };
}

/** pdf.js splits words into many items; join neighbors of the same height so titles read whole. */
function mergeAdjacent(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  runs.forEach((run) => {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.height - run.height) < 0.5 && last.text.length + run.text.length < 90) {
      last.text = `${last.text}${/\s$/.test(last.text) || /^\s/.test(run.text) ? "" : " "}${run.text}`;
    } else {
      merged.push({ ...run });
    }
  });
  // Keep the single items too, so a sheet number printed alone still matches exactly.
  return [...merged, ...runs];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** PDF dates look like D:20260214093000-05'00'. */
function pdfDate(value: unknown): string {
  const match = text(value).match(/^D:(\d{4})(\d{2})?(\d{2})?/);
  if (!match) return "";
  return [match[1], match[2] ?? "01", match[3] ?? "01"].join("-");
}
