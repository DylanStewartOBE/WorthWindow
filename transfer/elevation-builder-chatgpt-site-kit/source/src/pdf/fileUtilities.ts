import type { Elevation, Job } from "../domain/types";

export type PdfType = "elevation" | "glass-takeoff" | "package" | "quote";

export function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  return url;
}

export function pdfFileName(job: Job, elevation: Elevation | null, type: PdfType): string {
  const safeCompany = "worth-construction";
  const safeJob = sanitize(job.number || job.name || "job");
  const safeSubject =
    elevation && (type === "elevation" || type === "glass-takeoff")
      ? sanitize(elevation.name || elevation.id)
      : "all-elevations";
  const safeType = sanitize(type === "package" ? "drawing-package" : type === "quote" ? "customer-quote" : type);
  return `${safeCompany}_${safeJob}_${safeSubject}_${safeType}_rev-${sanitize(job.activeRevision || "A")}.pdf`;
}

export function backupFileName(date = new Date()): string {
  return `worth-field-backup_${date.toISOString().slice(0, 10)}.json`;
}

function sanitize(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}
