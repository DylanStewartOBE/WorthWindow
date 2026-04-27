import { jsPDF } from "jspdf";
import { getDoorLeafVisuals } from "../domain/door";
import {
  DEFAULT_QUARTER_INCH_GLASS_WEIGHT_LBS_PER_SQFT,
  getDoorGlassCalloutMap,
  getGlassItemSquareFeet,
  getGlassItemWeightPounds,
  getTotalGlassSquareFeet,
  getTotalGlassWeightPounds
} from "../domain/glass";
import { formatFeetInches, formatInches } from "../domain/format";
import { calculateQuoteSummary } from "../domain/quote";
import type { BrandingConfig, Elevation, Job, Lite, ValidationFlag } from "../domain/types";

const LETTER_LANDSCAPE = {
  width: 792,
  height: 612
};

type PdfGenerationOptions = {
  showAssemblyNumbers?: boolean;
};

export function generateElevationPdf(elevation: Elevation, job: Job, branding: BrandingConfig, options: PdfGenerationOptions = {}): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "ELEVATION", "A-1", elevation, job, branding);
  drawElevation(doc, elevation, 42, 86, 500, 360, options);
  drawElevationNotes(doc, elevation, 560, 86, 190);
  return doc.output("blob");
}

export function generateGlassTakeoffPdf(elevation: Elevation, job: Job, branding: BrandingConfig): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "GLASS TAKEOFF", "G-1", elevation, job, branding);
  drawGlassTable(doc, elevation, 42, 96, 710);
  return doc.output("blob");
}

export function generateDrawingPackagePdf(elevation: Elevation, job: Job, branding: BrandingConfig, options: PdfGenerationOptions = {}): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "ELEVATION", "A-1", elevation, job, branding);
  drawElevation(doc, elevation, 42, 86, 500, 360, options);
  drawElevationNotes(doc, elevation, 560, 86, 190);

  doc.addPage("letter", "landscape");
  drawSheetChrome(doc, "GLASS TAKEOFF", "G-1", elevation, job, branding);
  drawGlassTable(doc, elevation, 42, 96, 710);

  return doc.output("blob");
}

export function generateQuotePdf(elevation: Elevation, job: Job, branding: BrandingConfig): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "CUSTOMER QUOTE", "Q-1", elevation, job, branding);
  drawQuoteSheet(doc, elevation, job, 54, 104, 684);
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  return url;
}

export function pdfFileName(job: Job, elevation: Elevation, type: "elevation" | "glass-takeoff" | "package" | "quote"): string {
  const safeJob = sanitize(job.number || job.name || "job");
  const safeElevation = sanitize(elevation.name || elevation.id);
  return `${safeJob}-${safeElevation}-${type}-rev-${job.activeRevision || "A"}.pdf`;
}

function drawSheetChrome(
  doc: jsPDF,
  title: string,
  sheetNumber: string,
  elevation: Elevation,
  job: Job,
  branding: BrandingConfig
) {
  doc.setProperties({
    title: `${job.number} ${elevation.name} ${title}`,
    subject: "FG-2000 field measure drawing package",
    author: job.createdBy || branding.companyName
  });

  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(1);
  doc.rect(24, 24, LETTER_LANDSCAPE.width - 48, LETTER_LANDSCAPE.height - 48);

  doc.setFillColor(...hexToRgb(branding.accentColor, [72, 101, 47]));
  doc.rect(24, 24, 54, 54, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(branding.logoText, 51, 57, { align: "center" });

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(18);
  doc.text(title, 96, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("FG-2000 field measure drawing package", 96, 63);

  drawTitleBlock(doc, elevation, job, branding, sheetNumber);
}

function drawTitleBlock(
  doc: jsPDF,
  elevation: Elevation,
  job: Job,
  branding: BrandingConfig,
  sheetNumber: string
) {
  const x = 520;
  const y = 472;
  const w = 248;
  const h = 116;
  doc.setDrawColor(17, 24, 39);
  doc.rect(x, y, w, h);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(branding.companyName, x + 10, y + 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(branding.addressLine, x + 10, y + 30);
  if (branding.phone) doc.text(branding.phone, x + 10, y + 40);

  const rows = [
    ["JOB NO.", job.number || "-"],
    ["JOB NAME", job.name || "-"],
    ["CUSTOMER", job.customer || "-"],
    ["ELEVATION", elevation.name],
    ["REVISION", job.activeRevision || "A"],
    ["SHEET", sheetNumber],
    ["CREATED BY", job.createdBy || "-"],
    ["DATE", new Date().toLocaleDateString()]
  ];

  rows.forEach(([label, value], index) => {
    const rowY = y + 48 + index * 8;
    doc.setFont("helvetica", "bold");
    doc.text(label, x + 10, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value).slice(0, 34), x + 72, rowY);
  });
}

function drawElevation(
  doc: jsPDF,
  elevation: Elevation,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  options: PdfGenerationOptions = {}
) {
  const geometry = elevation.computedGeometry;
  const doorGlassCallouts = getDoorGlassCalloutMap(elevation.computedGlass.items);
  const scale = Math.min(maxWidth / geometry.frameWidth, maxHeight / geometry.frameHeight);
  const drawingWidth = geometry.frameWidth * scale;
  const drawingHeight = geometry.frameHeight * scale;
  const originX = x + (maxWidth - drawingWidth) / 2;
  const originY = y + 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(elevation.name, x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `Opening ${formatFeetInches(elevation.governingWidth)} W x ${formatFeetInches(elevation.governingHeight)} H`,
    x,
    y + 14
  );

  doc.setLineWidth(1.2);
  doc.setDrawColor(17, 24, 39);
  doc.rect(originX, originY, drawingWidth, drawingHeight);

  geometry.members.forEach((member) => {
    const px = originX + member.x * scale;
    const py = originY + (geometry.frameHeight - member.y - member.height) * scale;
    const pw = member.width * scale;
    const ph = member.height * scale;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(member.role.includes("jamb") ? 1.1 : 0.85);
    doc.rect(px, py, pw, ph, "FD");
  });

  geometry.lites.forEach((lite) => {
    const px = originX + lite.dloX * scale;
    const py = originY + (geometry.frameHeight - lite.dloY - lite.dloHeight) * scale;
    const pw = lite.dloWidth * scale;
    const ph = lite.dloHeight * scale;
    if (lite.type === "transom") {
      doc.setFillColor(204, 251, 241);
    } else {
      doc.setFillColor(219, 234, 254);
    }
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.8);
    doc.rect(px, py, pw, ph, "FD");
  });

  geometry.doorOpenings.forEach((door, doorIndex) => {
    const px = originX + door.x * scale;
    const py = originY + (geometry.frameHeight - door.y - door.height) * scale;
    const pw = door.width * scale;
    const ph = door.height * scale;
    drawDoorLeafDetails(doc, px, py, pw, ph, door.leafCount, scale);
    drawDoorGlassMarks(doc, door, doorIndex, doorGlassCallouts, originX, originY, geometry.frameHeight, scale);
  });

  geometry.lites.forEach((lite) => drawLiteMark(doc, elevation, lite, originX, originY, scale));
  geometry.assemblyCallouts
    .filter((callout) => shouldShowAssemblyCallout(callout, options.showAssemblyNumbers ?? false))
    .forEach((callout) => drawAssemblyCallout(doc, elevation, callout, originX, originY, scale));

  doc.setDrawColor(75, 85, 99);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Frame width: ${formatFeetInches(geometry.frameWidth)}`, originX, originY + drawingHeight + 18);
  doc.text(`Frame height: ${formatFeetInches(geometry.frameHeight)}`, originX + 150, originY + drawingHeight + 18);
  if (geometry.doorOpenings[0]) {
    const door = geometry.doorOpenings[0];
    doc.text(
      `Door: ${door.leafCount === 2 ? "pair" : "single"} ${formatInches(door.widthPerLeaf)} x ${formatInches(door.height)}`,
      originX + 300,
      originY + drawingHeight + 18
    );
  }
}

function shouldShowAssemblyCallout(
  callout: Elevation["computedGeometry"]["assemblyCallouts"][number],
  showAssemblyNumbers: boolean
): boolean {
  return callout.level === "assembly" || showAssemblyNumbers;
}

function drawDoorLeafDetails(doc: jsPDF, x: number, y: number, w: number, h: number, leafCount: number, scale: number) {
  const leafVisuals = getDoorLeafVisuals({ width: w / scale, height: h / scale, leafCount });

  leafVisuals.forEach((leaf) => {
    const innerX = x + leaf.glassX * scale;
    const innerY = y + leaf.glassY * scale;
    const innerWidth = leaf.glassWidth * scale;
    const innerHeight = leaf.glassHeight * scale;
    const guideStartTopX = x + leaf.guideStartTop.x * scale;
    const guideStartTopY = y + leaf.guideStartTop.y * scale;
    const guideStartBottomX = x + leaf.guideStartBottom.x * scale;
    const guideStartBottomY = y + leaf.guideStartBottom.y * scale;
    const guideEndX = x + leaf.guideEnd.x * scale;
    const guideEndY = y + leaf.guideEnd.y * scale;

    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.9);
    doc.setFillColor(255, 255, 255);
    leaf.members.forEach((member) => {
      doc.rect(
        x + member.x * scale,
        y + member.y * scale,
        member.width * scale,
        member.height * scale,
        "FD"
      );
    });
    doc.setFillColor(219, 234, 254);
    doc.rect(innerX, innerY, innerWidth, innerHeight, "FD");
    doc.setLineDashPattern([3, 2], 0);
    doc.setDrawColor(71, 85, 105);
    doc.line(guideStartTopX, guideStartTopY, guideEndX, guideEndY);
    doc.line(guideStartBottomX, guideStartBottomY, guideEndX, guideEndY);
    doc.setLineDashPattern([], 0);
  });
}

function drawDoorGlassMarks(
  doc: jsPDF,
  door: Elevation["computedGeometry"]["doorOpenings"][number],
  doorIndex: number,
  callouts: ReturnType<typeof getDoorGlassCalloutMap>,
  originX: number,
  originY: number,
  frameHeight: number,
  scale: number
) {
  getDoorLeafVisuals(door).forEach((leaf) => {
    const callout = callouts[`D${doorIndex + 1}L${leaf.leafIndex + 1}`];
    if (!callout) return;

    const cx = originX + (door.x + leaf.glassX + leaf.glassWidth / 2) * scale;
    const cy = originY + (frameHeight - door.y - leaf.glassY - leaf.glassHeight / 2) * scale;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(7);
    doc.text(callout.mark, cx, cy - 3, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.text(`${formatInches(callout.width)} x ${formatInches(callout.height)}`, cx, cy + 7, { align: "center" });
  });
}

function drawLiteMark(doc: jsPDF, elevation: Elevation, lite: Lite, originX: number, originY: number, scale: number) {
  const cx = originX + (lite.dloX + lite.dloWidth / 2) * scale;
  const cy = originY + (elevation.computedGeometry.frameHeight - lite.dloY - lite.dloHeight / 2) * scale;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(7);
  doc.text(lite.mark, cx, cy - 3, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.text(`${formatInches(lite.glassWidth)} x ${formatInches(lite.glassHeight)}`, cx, cy + 7, { align: "center" });
}

function drawAssemblyCallout(
  doc: jsPDF,
  elevation: Elevation,
  callout: Elevation["computedGeometry"]["assemblyCallouts"][number],
  originX: number,
  originY: number,
  scale: number
) {
  const x = originX + callout.x * scale;
  const y = originY + (elevation.computedGeometry.frameHeight - callout.y) * scale;
  const isSubassembly = callout.level === "subassembly";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(isSubassembly ? 5.5 : 8);
  doc.setTextColor(isSubassembly ? 51 : 15, isSubassembly ? 65 : 118, isSubassembly ? 85 : 110);
  doc.text(callout.mark, x, y, {
    align: callout.type === "lite" || callout.type === "transom" ? "left" : "center"
  });
  doc.setTextColor(17, 24, 39);
}

function drawElevationNotes(doc: jsPDF, elevation: Elevation, x: number, y: number, width: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Summary", x, y);

  const summary = [
    `Governing width: ${formatFeetInches(elevation.governingWidth)}`,
    `Governing height: ${formatFeetInches(elevation.governingHeight)}`,
    `Finish: ${elevation.finishConfig.finishLabel}`,
    `Glass: ${elevation.glassConfig.glassTypeLabel}`,
    `Subsill: ${elevation.computedGeometry.subsillType}`,
    `Mullion height: ${formatInches(elevation.computedGeometry.memberCalcs.mullionHeight)}`
  ];

  drawWrappedList(doc, summary, x, y + 16, width, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Notes", x, y + 92);
  drawWrappedList(doc, elevation.computedGeometry.notes.slice(0, 8), x, y + 108, width, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Validation", x, y + 250);
  drawValidationList(doc, elevation.validationFlags, x, y + 266, width);
}

function drawGlassTable(doc: jsPDF, elevation: Elevation, x: number, y: number, width: number) {
  const headers = ["Pic", "Mark", "Location", "Qty", "Width", "Height", "Sq Ft", "Wt/Pc", "Glass", "Safety"];
  const widths = [50, 38, 104, 30, 56, 56, 46, 58, 214, 48];
  const rowHeight = 30;
  const totalSquareFeet = getTotalGlassSquareFeet(elevation.computedGlass.items);
  const totalWeight = getTotalGlassWeightPounds(elevation.computedGlass.items);
  let currentY = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(elevation.name, x, currentY - 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    `Glass size shown as final order size from DLO plus documented FG-2000 bite. Weight uses ${DEFAULT_QUARTER_INCH_GLASS_WEIGHT_LBS_PER_SQFT} lb/sq ft.`,
    x,
    currentY - 9
  );
  doc.setFont("helvetica", "bold");
  doc.text(`Total glass: ${formatSquareFeet(totalSquareFeet)} sq ft / ${formatWeight(totalWeight)} lb`, x + width - 4, currentY - 9, {
    align: "right"
  });

  doc.setFillColor(229, 231, 235);
  doc.rect(x, currentY, width, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  let currentX = x + 6;
  headers.forEach((header, index) => {
    doc.text(header, currentX, currentY + 14);
    currentX += widths[index];
  });
  currentY += 22;

  doc.setFont("helvetica", "normal");
  elevation.computedGlass.items.forEach((item, index) => {
    const representativeLite = item.sourceType === "storefront-lite"
      ? elevation.computedGeometry.lites.find((lite) => lite.id === item.liteId)
      : undefined;

    if (index % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x, currentY, width, rowHeight, "F");
    }
    const values = [
      item.mark,
      item.location,
      String(item.qty),
      formatInches(item.width),
      formatInches(item.height),
      formatSquareFeet(getGlassItemSquareFeet(item)),
      `${formatWeight(getGlassItemWeightPounds(item))} lb`,
      item.glassType,
      item.safetyGlazingLikely ? "Likely" : "-"
    ];
    currentX = x + 6;
    drawGlassPictorial(doc, item.sourceType, representativeLite, currentX - 2, currentY + 4, widths[0] - 12, rowHeight - 8);
    currentX += widths[0];
    values.forEach((value, valueIndex) => {
      const limit = valueIndex === 7 ? 34 : valueIndex === 6 ? 14 : valueIndex === 5 ? 10 : 18;
      doc.text(value.slice(0, limit), currentX, currentY + 18);
      currentX += widths[valueIndex + 1];
    });
    currentY += rowHeight;
  });

  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.8);
  doc.line(x, currentY, x + width, currentY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("TOTALS", x + width - widths[9] - widths[8] - widths[7] - widths[6] + 8, currentY + 15);
  doc.text(`${formatSquareFeet(totalSquareFeet)} sq ft`, x + width - widths[9] - widths[8] - 8, currentY + 15, { align: "right" });
  doc.text(`${formatWeight(totalWeight)} lb`, x + width - widths[9] - widths[8] + widths[7] - 8, currentY + 15, { align: "right" });
}

function drawQuoteSheet(doc: jsPDF, elevation: Elevation, job: Job, x: number, y: number, width: number) {
  const quote = calculateQuoteSummary(elevation);
  const rows = [
    ["Job", `${job.number || "-"} ${job.name || ""}`.trim()],
    ["Customer", job.customer || "-"],
    ["Elevation", elevation.name],
    ["Opening area", `${formatSquareFeet(quote.openingSquareFeet)} sq ft @ ${formatCurrency(quote.installedRatePerSquareFoot)} / sq ft`],
    ["Installed storefront", formatCurrency(quote.installedCost)],
    ["Single doors", `${quote.singleDoorCount} @ ${formatCurrency(quote.singleDoorPrice)}`],
    ["Pair doors", `${quote.pairDoorCount} @ ${formatCurrency(quote.pairDoorPrice)}`],
    ["Door total", formatCurrency(quote.doorCost)]
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Customer Quote", x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Budgetary field quote based on measured opening area plus standard entrance adders.", x, y + 16);

  let currentY = y + 42;
  doc.setDrawColor(17, 24, 39);
  rows.forEach(([label, value], index) => {
    if (index % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x, currentY - 14, width, 24, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label, x + 10, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(value, x + 190, currentY);
    currentY += 24;
  });

  doc.setFillColor(72, 101, 47);
  doc.rect(x, currentY + 10, width, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Estimated Total", x + 12, currentY + 35);
  doc.text(formatCurrency(quote.total), x + width - 12, currentY + 35, { align: "right" });
  doc.setTextColor(17, 24, 39);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("Quote excludes engineering, structural review, taxes, permit fees, special hardware, and field conditions not captured in this v1 estimator.", x, currentY + 68);
}

function drawWrappedList(doc: jsPDF, items: string[], x: number, y: number, width: number, lineHeight: number) {
  let currentY = y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  items.forEach((item) => {
    const lines = doc.splitTextToSize(`- ${item}`, width);
    lines.forEach((line: string) => {
      doc.text(line, x, currentY);
      currentY += lineHeight;
    });
  });
}

function drawValidationList(doc: jsPDF, flags: ValidationFlag[], x: number, y: number, width: number) {
  const items = flags.length
    ? flags.slice(0, 8).map((flag) => `${flag.severity.toUpperCase()}: ${flag.message}`)
    : ["No validation warnings."];
  drawWrappedList(doc, items, x, y, width, 8);
}

function drawGlassPictorial(
  doc: jsPDF,
  sourceType: "storefront-lite" | "door-lite",
  lite: Lite | undefined,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number
) {
  if (sourceType === "door-lite") {
    const glassWidth = 28;
    const glassHeight = 70;
    const scale = Math.min(maxWidth / glassWidth, maxHeight / glassHeight);
    const sketchWidth = glassWidth * scale;
    const sketchHeight = glassHeight * scale;
    const originX = x + (maxWidth - sketchWidth) / 2;
    const originY = y + (maxHeight - sketchHeight) / 2;
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.8);
    doc.setFillColor(219, 234, 254);
    doc.rect(originX, originY, sketchWidth, sketchHeight, "FD");
    return;
  }

  const width = Math.max(lite?.glassWidth ?? 24, 1);
  const height = Math.max(lite?.glassHeight ?? 24, 1);
  const scale = Math.min(maxWidth / width, maxHeight / height);
  const sketchWidth = Math.max(width * scale, 8);
  const sketchHeight = Math.max(height * scale, 8);
  const originX = x + (maxWidth - sketchWidth) / 2;
  const originY = y + (maxHeight - sketchHeight) / 2;

  if (lite?.type === "transom") {
    doc.setFillColor(204, 251, 241);
  } else if (lite?.safetyGlazingLikely) {
    doc.setFillColor(219, 234, 254);
  } else {
    doc.setFillColor(255, 255, 255);
  }

  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.8);
  doc.rect(originX, originY, sketchWidth, sketchHeight, "FD");

  if (lite?.safetyGlazingLikely) {
    doc.setDrawColor(14, 116, 144);
    doc.line(originX + 3, originY + sketchHeight - 3, originX + sketchWidth - 3, originY + 3);
  }

  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.text(lite?.mark ?? "-", originX + sketchWidth / 2, originY + sketchHeight / 2 + 2, { align: "center" });
}

function formatSquareFeet(value: number): string {
  return value.toFixed(2);
}

function formatWeight(value: number): string {
  return value.toFixed(1);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
}
