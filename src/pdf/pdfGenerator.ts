import { jsPDF } from "jspdf";
import { getDoorLeafVisuals } from "../domain/door";
import {
  DEFAULT_QUARTER_INCH_GLASS_WEIGHT_LBS_PER_SQFT,
  getDoorGlassCalloutMap,
  getGlassItemSquareFeet,
  getGlassItemWeightPounds,
  getGlassLineSquareFeet,
  getTotalGlassSquareFeet,
  getTotalGlassWeightPounds
} from "../domain/glass";
import { formatFeetInches, formatInches } from "../domain/format";
import { calculateJobQuoteSummary, calculateQuoteSummary } from "../domain/quote";
import type { BrandingConfig, Elevation, GlassItem, Job, Lite, ValidationFlag } from "../domain/types";

const LETTER_LANDSCAPE = {
  width: 792,
  height: 612
};

type PdfGenerationOptions = {
  showAssemblyNumbers?: boolean;
};

type PdfType = "elevation" | "glass-takeoff" | "package" | "quote";

type GlassTakeoffRow = GlassItem & {
  elevationLabel: string;
  elevationName: string;
  representativeLite?: Lite;
};

type JobGlassTakeoff = {
  rows: GlassTakeoffRow[];
  markByKey: Map<string, string>;
};

export function generateElevationPdf(elevation: Elevation, job: Job, branding: BrandingConfig, options: PdfGenerationOptions = {}): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "ELEVATION", "A-1", elevation, job, branding, elevation.name);
  drawElevation(doc, elevation, 42, 126, 500, 320, options);
  drawElevationNotes(doc, elevation, 560, 126, 190);
  return doc.output("blob");
}

export function generateGlassTakeoffPdf(elevation: Elevation, job: Job, branding: BrandingConfig): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "GLASS TAKEOFF", "G-1", elevation, job, branding, elevation.name);
  drawGlassTable(doc, [elevation], 42, 126, 710);
  return doc.output("blob");
}

export function generateDrawingPackagePdf(elevation: Elevation, job: Job, branding: BrandingConfig, options: PdfGenerationOptions = {}): Blob {
  return generateJobDrawingPackagePdf([elevation], job, branding, options);
}

export function generateJobDrawingPackagePdf(elevations: Elevation[], job: Job, branding: BrandingConfig, options: PdfGenerationOptions = {}): Blob {
  const packageElevations = ensureElevations(elevations);
  const jobGlassTakeoff = buildJobGlassTakeoff(packageElevations);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });

  packageElevations.forEach((elevation, index) => {
    if (index > 0) doc.addPage("letter", "landscape");
    drawSheetChrome(doc, "ELEVATION", `A-${index + 1}`, elevation, job, branding, elevation.name);
    drawElevation(doc, elevation, 42, 126, 500, 320, options, jobGlassTakeoff);
    drawElevationNotes(doc, elevation, 560, 126, 190);
  });

  doc.addPage("letter", "landscape");
  drawSheetChrome(doc, "GLASS TAKEOFF", "G-1", packageElevations[0], job, branding, "All elevations");
  drawGlassTable(doc, packageElevations, 42, 126, 710, jobGlassTakeoff);

  return doc.output("blob");
}

export function generateQuotePdf(elevation: Elevation, job: Job, branding: BrandingConfig): Blob {
  return generateJobQuotePdf([elevation], job, branding);
}

export function generateJobQuotePdf(elevations: Elevation[], job: Job, branding: BrandingConfig): Blob {
  const quoteElevations = ensureElevations(elevations);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  drawSheetChrome(doc, "CUSTOMER QUOTE", "Q-1", quoteElevations[0], job, branding, "All elevations");
  drawQuoteSheet(doc, quoteElevations, job, 54, 130, 684);
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

export function pdfFileName(job: Job, elevation: Elevation | null, type: PdfType): string {
  const safeCompany = "worth-construction";
  const safeJob = sanitize(job.number || job.name || "job");
  const safeSubject = elevation && (type === "elevation" || type === "glass-takeoff")
    ? sanitize(elevation.name || elevation.id)
    : "all-elevations";
  const safeType = sanitize(type === "package" ? "drawing-package" : type === "quote" ? "customer-quote" : type);
  return `${safeCompany}_${safeJob}_${safeSubject}_${safeType}_rev-${sanitize(job.activeRevision || "A")}.pdf`;
}

function ensureElevations(elevations: Elevation[]): Elevation[] {
  if (elevations.length === 0) {
    throw new Error("At least one elevation is required to generate a PDF.");
  }
  return elevations;
}

function drawSheetChrome(
  doc: jsPDF,
  title: string,
  sheetNumber: string,
  elevation: Elevation,
  job: Job,
  branding: BrandingConfig,
  elevationLabel = elevation.name
) {
  doc.setProperties({
    title: `${job.number} ${elevationLabel} ${title}`,
    subject: "FG-2000 field measure drawing package",
    author: job.createdBy || branding.companyName
  });

  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(1);
  doc.rect(24, 24, LETTER_LANDSCAPE.width - 48, LETTER_LANDSCAPE.height - 48);

  doc.setFillColor(...hexToRgb(branding.accentColor, [72, 101, 47]));
  doc.rect(24, 24, LETTER_LANDSCAPE.width - 48, 54, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(38, 34, 34, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text(branding.companyName, 90, 47);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("FG-2000 FIELD MEASURE DRAWING PACKAGE", 91, 64);

  doc.setTextColor(...hexToRgb(branding.accentColor, [72, 101, 47]));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(branding.logoText, 55, 57, { align: "center" });

  doc.setTextColor(17, 24, 39);
  doc.setFontSize(15);
  doc.text(title, 42, 102);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(elevationLabel, 42, 116);

  drawTitleBlock(doc, elevation, job, branding, sheetNumber, elevationLabel);
}

function drawTitleBlock(
  doc: jsPDF,
  elevation: Elevation,
  job: Job,
  branding: BrandingConfig,
  sheetNumber: string,
  elevationLabel = elevation.name
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
    ["ELEVATION", elevationLabel],
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
  options: PdfGenerationOptions = {},
  jobGlassTakeoff?: JobGlassTakeoff
) {
  const geometry = elevation.computedGeometry;
  const glassItems = applyJobGlassMarks(elevation.computedGlass.items, jobGlassTakeoff);
  const doorGlassCallouts = getDoorGlassCalloutMap(glassItems);
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

  geometry.lites.forEach((lite) => drawLiteMark(doc, elevation, lite, originX, originY, scale, jobGlassTakeoff));
  geometry.assemblyCallouts
    .filter((callout) => shouldShowAssemblyCallout(callout, options.showAssemblyNumbers ?? false))
    .forEach((callout) => drawAssemblyCallout(doc, elevation, callout, originX, originY, scale));

  drawDimensionLeaders(doc, elevation, originX, originY, scale);

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

function drawDimensionLeaders(doc: jsPDF, elevation: Elevation, originX: number, originY: number, scale: number) {
  const { frameHeight } = elevation.computedGeometry;
  const dimensions = elevation.computedGeometry.dimensions.filter(
    (dimension) => dimension.id.startsWith("overall") || dimension.id.startsWith("column") || dimension.id.startsWith("row") || dimension.id.includes("door")
  );

  doc.setDrawColor(17, 24, 39);
  doc.setTextColor(17, 24, 39);
  doc.setLineWidth(0.45);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);

  dimensions.forEach((dimension) => {
    if (dimension.orientation === "horizontal") {
      const fromX = originX + dimension.from * scale;
      const toX = originX + dimension.to * scale;
      const baselineY = originY + (dimension.offset < 0 ? dimension.offset * 1.8 : frameHeight * scale + dimension.offset * 1.8);
      const extensionTopY = dimension.offset < 0 ? baselineY - 4 : originY + frameHeight * scale;
      const extensionBottomY = dimension.offset < 0 ? originY : baselineY + 4;
      doc.line(fromX, extensionTopY, fromX, extensionBottomY);
      doc.line(toX, extensionTopY, toX, extensionBottomY);
      doc.line(fromX, baselineY, toX, baselineY);
      drawDimensionTick(doc, fromX, baselineY);
      drawDimensionTick(doc, toX, baselineY);
      doc.text(formatFeetInches(dimension.value), (fromX + toX) / 2, baselineY - 2, { align: "center" });
      return;
    }

    const fromY = originY + (frameHeight - dimension.from) * scale;
    const toY = originY + (frameHeight - dimension.to) * scale;
    const baselineX = originX + (dimension.offset < 0 ? dimension.offset * 1.8 : elevation.computedGeometry.frameWidth * scale + dimension.offset * 1.8);
    const extensionLeftX = dimension.offset < 0 ? baselineX - 4 : originX + elevation.computedGeometry.frameWidth * scale;
    const extensionRightX = dimension.offset < 0 ? originX : baselineX + 4;
    doc.line(extensionLeftX, fromY, extensionRightX, fromY);
    doc.line(extensionLeftX, toY, extensionRightX, toY);
    doc.line(baselineX, fromY, baselineX, toY);
    drawDimensionTick(doc, baselineX, fromY);
    drawDimensionTick(doc, baselineX, toY);
    doc.text(formatFeetInches(dimension.value), baselineX - 2, (fromY + toY) / 2, {
      align: "center",
      angle: 90
    });
  });
}

function drawDimensionTick(doc: jsPDF, x: number, y: number) {
  doc.line(x - 2.5, y + 2.5, x + 2.5, y - 2.5);
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

function drawLiteMark(
  doc: jsPDF,
  elevation: Elevation,
  lite: Lite,
  originX: number,
  originY: number,
  scale: number,
  jobGlassTakeoff?: JobGlassTakeoff
) {
  const cx = originX + (lite.dloX + lite.dloWidth / 2) * scale;
  const cy = originY + (elevation.computedGeometry.frameHeight - lite.dloY - lite.dloHeight / 2) * scale;
  const mark =
    jobGlassTakeoff?.markByKey.get(glassKey("storefront-lite", lite.glassWidth, lite.glassHeight, elevation.glassConfig.glassTypeLabel)) ??
    lite.mark;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(7);
  doc.text(mark, cx, cy - 3, { align: "center" });
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

function buildJobGlassTakeoff(elevations: Elevation[]): JobGlassTakeoff {
  const groups = new Map<
    string,
    {
      key: string;
      locations: string[];
      qty: number;
      width: number;
      height: number;
      glassType: string;
      safetyGlazingLikely: boolean;
      sourceType: GlassItem["sourceType"];
      liteId: string;
      elevationLabel: string;
      elevationName: string;
      representativeLite?: Lite;
    }
  >();

  elevations.forEach((elevation, elevationIndex) => {
    const elevationLabel = `E${elevationIndex + 1}`;

    elevation.computedGlass.items.forEach((item) => {
      const representativeLite =
        item.sourceType === "storefront-lite"
          ? elevation.computedGeometry.lites.find((lite) => lite.id === item.liteId)
          : undefined;
      const key = glassKey(item.sourceType, item.width, item.height, item.glassType);
      const location = `${elevationLabel}:${item.location}`;
      const current = groups.get(key);

      if (current) {
        current.qty += item.qty;
        current.locations.push(location);
        current.safetyGlazingLikely = current.safetyGlazingLikely || item.safetyGlazingLikely;
        current.representativeLite = current.representativeLite ?? representativeLite;
        return;
      }

      groups.set(key, {
        key,
        locations: [location],
        qty: item.qty,
        width: item.width,
        height: item.height,
        glassType: item.glassType,
        safetyGlazingLikely: item.safetyGlazingLikely,
        sourceType: item.sourceType,
        liteId: item.liteId,
        elevationLabel,
        elevationName: elevation.name,
        representativeLite
      });
    });
  });

  let storefrontIndex = 1;
  let doorIndex = 1;
  const markByKey = new Map<string, string>();

  const rows = Array.from(groups.values()).map((group) => {
    const mark = group.sourceType === "door-lite" ? `DG${doorIndex++}` : `G${storefrontIndex++}`;
    markByKey.set(group.key, mark);

    return {
      liteId: group.liteId,
      mark,
      location: group.locations.join(", "),
      qty: group.qty,
      width: group.width,
      height: group.height,
      glassType: group.glassType,
      safetyGlazingLikely: group.safetyGlazingLikely,
      sourceType: group.sourceType,
      elevationLabel: group.elevationLabel,
      elevationName: group.elevationName,
      representativeLite: group.representativeLite
    };
  });

  return { rows, markByKey };
}

function drawGlassTable(
  doc: jsPDF,
  elevations: Elevation[],
  x: number,
  y: number,
  width: number,
  jobGlassTakeoff = buildJobGlassTakeoff(elevations)
) {
  const rows = jobGlassTakeoff.rows;
  const headers = ["Pic", "Mark", "Location", "Qty", "Width", "Height", "Sq Ft/Pc", "Wt/Pc", "Line Sq Ft", "Glass", "Safety"];
  const widths = [44, 34, 104, 26, 50, 50, 48, 46, 54, 202, 44];
  const rowHeight = 30;
  const totalSquareFeet = getTotalGlassSquareFeet(rows);
  const totalWeight = getTotalGlassWeightPounds(rows);
  let currentY = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(elevations.length === 1 ? elevations[0].name : "All elevations", x, currentY - 22);
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
  rows.forEach((item, index) => {
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
      formatSquareFeet(getGlassLineSquareFeet(item)),
      item.glassType,
      item.safetyGlazingLikely ? "Likely" : "-"
    ];
    currentX = x + 6;
    drawGlassPictorial(doc, item.sourceType, item.representativeLite, currentX - 2, currentY + 4, widths[0] - 12, rowHeight - 8);
    currentX += widths[0];
    values.forEach((value, valueIndex) => {
      const limit = valueIndex === 8 ? 32 : valueIndex === 7 ? 12 : valueIndex === 6 ? 14 : valueIndex === 5 ? 10 : 18;
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
  doc.text("TOTALS", x + width - widths[10] - widths[9] - widths[8] - widths[7] + 8, currentY + 15);
  doc.text(`${formatSquareFeet(totalSquareFeet)} sq ft`, x + width - widths[10] - widths[9] - 8, currentY + 15, { align: "right" });
  doc.text(`${formatWeight(totalWeight)} lb total`, x + width - widths[10] - widths[9] + widths[8] - 8, currentY + 15, { align: "right" });
}

function applyJobGlassMarks(items: GlassItem[], jobGlassTakeoff?: JobGlassTakeoff): GlassItem[] {
  if (!jobGlassTakeoff) return items;
  return items.map((item) => ({
    ...item,
    mark: jobGlassTakeoff.markByKey.get(glassKey(item.sourceType, item.width, item.height, item.glassType)) ?? item.mark
  }));
}

function glassKey(sourceType: GlassItem["sourceType"], width: number, height: number, glassType: string): string {
  return [sourceType, normalizeGlassDimension(width), normalizeGlassDimension(height), glassType].join("|");
}

function normalizeGlassDimension(value: number): string {
  return String(Math.round(value * 16) / 16);
}

function drawQuoteSheet(doc: jsPDF, elevations: Elevation[], job: Job, x: number, y: number, width: number) {
  const quote = elevations.length === 1 ? calculateQuoteSummary(elevations[0]) : calculateJobQuoteSummary(elevations);
  const rows = [
    ["Job", `${job.number || "-"} ${job.name || ""}`.trim()],
    ["Customer", job.customer || "-"],
    ["Elevations", elevations.map((elevation, index) => `E${index + 1} ${elevation.name}`).join(", ")],
    ["Opening area", `${formatSquareFeet(quote.openingSquareFeet)} sq ft total`],
    ["Glass", `${formatSquareFeet(quote.glassSquareFeet)} sq ft @ ${formatCurrency(quote.glassRatePerSquareFoot)} / sq ft`],
    ["Glass total", formatCurrency(quote.glassCost)],
    ["Aluminum", `${quote.aluminumLinearFeet.toFixed(2)} ln ft @ ${formatCurrency(quote.aluminumRatePerLinearFoot)} / ln ft`],
    ["Aluminum total", formatCurrency(quote.aluminumCost)]
  ];

  if (quote.doorOpeningSquareFeet > 0) {
    rows.splice(4, 0, ["Door opening area", `${formatSquareFeet(quote.doorOpeningSquareFeet)} sq ft noted separately`]);
  }

  if (quote.highHeavyGlassSquareFeet > 0) {
    rows.push([
      "High/heavy glass premium",
      `${formatSquareFeet(quote.highHeavyGlassSquareFeet)} sq ft @ +${formatCurrency(quote.highHeavyGlassPremiumRate)} / sq ft`
    ]);
    rows.push(["Premium total", formatCurrency(quote.highHeavyGlassPremiumCost)]);
  }

  if (quote.lowHeavyGlassSquareFeet > 0) {
    rows.push([
      "Heavy glass handling premium",
      `${formatSquareFeet(quote.lowHeavyGlassSquareFeet)} sq ft under 5'-0" @ +${formatCurrency(quote.lowHeavyGlassPremiumRate)} / sq ft`
    ]);
    rows.push(["Heavy handling total", formatCurrency(quote.lowHeavyGlassPremiumCost)]);
  }

  if (quote.singleDoorCount > 0) {
    rows.push(["Single doors", `${quote.singleDoorCount} @ ${formatCurrency(quote.singleDoorPrice)}`]);
  }

  if (quote.pairDoorCount > 0) {
    rows.push(["Pair doors", `${quote.pairDoorCount} @ ${formatCurrency(quote.pairDoorPrice)}`]);
  }

  if (quote.doorCost > 0) {
    rows.push(["Door total", formatCurrency(quote.doorCost)]);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Customer Quote", x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Budgetary field quote based on job glass, aluminum length, heavy-glass handling, and standard entrance adders.", x, y + 16);

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
