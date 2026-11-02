import { jsPDF } from "jspdf";
import type { BrandingConfig } from "../domain/types";
import { formatCurrency, formatInchesFraction, formatPipeSize, formatQty } from "./domain/math";
import type { PlumbingJob, PlumbingPhase, PlumbingQuote, PlumbingTakeoff } from "./domain/types";

const PAGE = { width: 792, height: 612 };
const MARGIN = 36;
const CONTENT_TOP = 112;
const CONTENT_BOTTOM = PAGE.height - 44;
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [100, 116, 139];
const RULE: [number, number, number] = [226, 232, 240];

const PHASE_LABELS: Record<PlumbingPhase, string> = {
  underground: "Underground",
  rough: "Rough-in",
  trim: "Set & trim"
};

type Column<T> = {
  header: string;
  width: number;
  align?: "left" | "right";
  value: (row: T) => string;
};

type Sheet = { title: string; code: string };

class PlumbingPdf {
  readonly doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  private sheetIndex = 0;
  private current: Sheet = { title: "", code: "" };
  y = CONTENT_TOP;

  constructor(
    private job: PlumbingJob,
    private branding: BrandingConfig,
    private packageLabel: string
  ) {
    this.doc.setProperties({
      title: `${job.number} ${job.name} ${packageLabel}`,
      subject: "Worth plumbing takeoff",
      author: job.createdBy || branding.companyName
    });
  }

  startSheet(title: string, code: string) {
    if (this.sheetIndex > 0) this.doc.addPage("letter", "landscape");
    this.sheetIndex += 1;
    this.current = { title, code };
    this.drawChrome();
    this.y = CONTENT_TOP;
  }

  private continueSheet() {
    this.doc.addPage("letter", "landscape");
    this.sheetIndex += 1;
    this.drawChrome(true);
    this.y = CONTENT_TOP;
  }

  ensureSpace(height: number) {
    if (this.y + height > CONTENT_BOTTOM) this.continueSheet();
  }

  private drawChrome(continued = false) {
    const { doc, job, branding } = this;
    const accent = hexToRgb(branding.accentColor, [72, 101, 47]);
    doc.setDrawColor(...INK);
    doc.setLineWidth(1);
    doc.rect(24, 24, PAGE.width - 48, PAGE.height - 48);
    doc.setFillColor(...accent);
    doc.rect(24, 24, PAGE.width - 48, 50, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(branding.companyName, MARGIN, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`PLUMBING ${this.packageLabel.toUpperCase()}`, MARGIN, 64);

    doc.setFontSize(8);
    const right = PAGE.width - MARGIN;
    doc.text(`${job.number || "No job #"}  |  ${job.name}`, right, 44, { align: "right" });
    doc.text(`${job.customer || "Customer not set"}  |  Rev ${job.revision || "A"}  |  ${new Date().toLocaleDateString()}`, right, 56, { align: "right" });
    if (job.address) doc.text(job.address, right, 67, { align: "right" });

    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`${this.current.title}${continued ? " (cont.)" : ""}`, MARGIN, 98);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`Sheet ${this.current.code}  |  Page ${this.sheetIndex}`, right, PAGE.height - 30, { align: "right" });
    doc.text(`${branding.companyName} plumbing takeoff - advisory estimate, field verify before fabrication`, MARGIN, PAGE.height - 30);
    doc.setTextColor(...INK);
  }

  heading(text: string) {
    this.ensureSpace(34);
    this.y += 6;
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.text(text, MARGIN, this.y);
    this.y += 12;
  }

  paragraph(text: string, width = PAGE.width - MARGIN * 2, size = 8) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(size);
    const lines = this.doc.splitTextToSize(text, width) as string[];
    lines.forEach((line) => {
      this.ensureSpace(size + 3);
      this.doc.text(line, MARGIN, this.y);
      this.y += size + 3;
    });
  }

  keyValues(pairs: [string, string][], columns = 3) {
    const width = (PAGE.width - MARGIN * 2) / columns;
    const rowHeight = 26;
    for (let index = 0; index < pairs.length; index += columns) {
      this.ensureSpace(rowHeight);
      pairs.slice(index, index + columns).forEach(([label, value], offset) => {
        const x = MARGIN + offset * width;
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(7);
        this.doc.setTextColor(...MUTED);
        this.doc.text(label.toUpperCase(), x, this.y);
        this.doc.setTextColor(...INK);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(10);
        this.doc.text(value, x, this.y + 12);
      });
      this.y += rowHeight;
    }
  }

  table<T>(columns: Column<T>[], rows: T[], options: { totalRow?: string[] } = {}) {
    const rowHeight = 14;
    const drawHeader = () => {
      this.doc.setFillColor(241, 245, 249);
      this.doc.rect(MARGIN, this.y - 10, tableWidth, rowHeight, "F");
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(7);
      let x = MARGIN;
      columns.forEach((column) => {
        const textX = column.align === "right" ? x + column.width - 4 : x + 4;
        this.doc.text(column.header.toUpperCase(), textX, this.y, { align: column.align === "right" ? "right" : "left" });
        x += column.width;
      });
      this.y += rowHeight;
    };
    const tableWidth = columns.reduce((total, column) => total + column.width, 0);

    this.ensureSpace(rowHeight * 3);
    drawHeader();
    const drawRow = (cells: string[], bold: boolean) => {
      if (this.y + rowHeight > CONTENT_BOTTOM) {
        this.continueSheet();
        drawHeader();
      }
      this.doc.setFont("helvetica", bold ? "bold" : "normal");
      this.doc.setFontSize(7.5);
      let x = MARGIN;
      cells.forEach((cell, index) => {
        const column = columns[index];
        const maxChars = Math.floor(column.width / 3.9);
        const text = cell.length > maxChars ? `${cell.slice(0, maxChars - 1)}...` : cell;
        const textX = column.align === "right" ? x + column.width - 4 : x + 4;
        this.doc.text(text, textX, this.y, { align: column.align === "right" ? "right" : "left" });
        x += column.width;
      });
      this.doc.setDrawColor(...RULE);
      this.doc.setLineWidth(0.4);
      this.doc.line(MARGIN, this.y + 4, MARGIN + tableWidth, this.y + 4);
      this.y += rowHeight;
    };

    if (rows.length === 0) {
      drawRow(columns.map((_, index) => (index === 0 ? "None entered" : "")), false);
    }
    rows.forEach((row) => drawRow(columns.map((column) => column.value(row)), false));
    if (options.totalRow) drawRow(options.totalRow, true);
    this.y += 8;
  }

  output(): Blob {
    return this.doc.output("blob");
  }
}

export function generatePlumbingTakeoffPdf(
  job: PlumbingJob,
  takeoff: PlumbingTakeoff,
  quote: PlumbingQuote,
  branding: BrandingConfig
): Blob {
  const pdf = new PlumbingPdf(job, branding, "Takeoff package");
  const { sizing } = takeoff;

  pdf.startSheet("Takeoff Summary", "PL-0");
  pdf.keyValues([
    ["Building type", job.buildingType === "commercial" ? "Commercial (public use)" : "Residential (private use)"],
    ["Project type", titleCase(job.projectType)],
    ["Fixtures", String(takeoff.fixtureCount)],
    ["Total DFU", formatQty(sizing.totalDfu)],
    ["Total WSFU (cold / hot / total)", `${formatQty(sizing.totalWsfu.cold)} / ${formatQty(sizing.totalWsfu.hot)} / ${formatQty(sizing.totalWsfu.total)}`],
    ["Est. peak demand", `${formatQty(sizing.estimatedPeakGpm)} gpm${sizing.hasFlushValves ? " (flush valve)" : ""}`],
    ["Min. building drain @ 1/4\"/ft", sizing.minBuildingDrainSize ? formatPipeSize(sizing.minBuildingDrainSize) : "-"],
    ["Largest sanitary entered", sizing.largestSanitaryEntered ? formatPipeSize(sizing.largestSanitaryEntered) : "-"],
    ["Labor hours", formatQty(quote.laborHours)],
    ["Material (excl. fixtures)", formatCurrency(quote.materialCost)],
    ["Fixtures furnished by Worth", formatCurrency(quote.fixtureCost)],
    ["Estimated total", formatCurrency(quote.total)]
  ]);
  pdf.heading("Review items");
  if (takeoff.flags.length === 0) pdf.paragraph("No review items.");
  takeoff.flags.forEach((flag) => pdf.paragraph(`[${flag.severity.toUpperCase()}] ${flag.message} ${flag.recommendation}`));
  if (job.notes) {
    pdf.heading("Notes");
    pdf.paragraph(job.notes);
  }
  pdf.heading("Basis");
  pdf.paragraph(
    "Fixture units and sizing are code-default references (IPC) for estimating only. Confirm against the approved plans, fixture cut sheets, and the adopted code edition. Sizing shown here is not an engineered design."
  );

  pdf.startSheet("Fixture Schedule", "PL-1");
  pdf.table(
    [
      { header: "Area", width: 150, value: (row) => row.areaName },
      { header: "Fixture", width: 190, value: (row) => row.label },
      { header: "Qty / area", width: 56, align: "right", value: (row) => String(row.qtyPerArea) },
      { header: "x Areas", width: 46, align: "right", value: (row) => String(row.multiplier) },
      { header: "Total", width: 44, align: "right", value: (row) => String(row.totalQty) },
      { header: "Furnished", width: 64, value: (row) => (row.furnishedBy === "worth" ? "Worth" : "Others") },
      { header: "DFU", width: 50, align: "right", value: (row) => formatQty(row.totalDfu) },
      { header: "WSFU C/H/T", width: 120, align: "right", value: (row) => `${formatQty(row.totalWsfu.cold)} / ${formatQty(row.totalWsfu.hot)} / ${formatQty(row.totalWsfu.total)}` }
    ],
    takeoff.fixtureSchedule,
    {
      totalRow: [
        "Total",
        "",
        "",
        "",
        String(takeoff.fixtureCount),
        "",
        formatQty(sizing.totalDfu),
        `${formatQty(sizing.totalWsfu.cold)} / ${formatQty(sizing.totalWsfu.hot)} / ${formatQty(sizing.totalWsfu.total)}`
      ]
    }
  );

  pdf.startSheet("Material Takeoff", "PL-2");
  (["underground", "rough", "trim"] as PlumbingPhase[]).forEach((phase) => {
    const rows = takeoff.materials.filter((line) => line.phase === phase && line.kind !== "labor");
    if (rows.length === 0) return;
    pdf.heading(PHASE_LABELS[phase]);
    pdf.table(
      [
        { header: "Group", width: 104, value: (row) => row.group },
        { header: "Description", width: 238, value: (row) => row.description },
        { header: "Unit", width: 30, value: (row) => row.unit },
        { header: "Qty", width: 48, align: "right", value: (row) => formatQty(row.qty) },
        { header: "Order", width: 48, align: "right", value: (row) => formatQty(row.orderQty) },
        { header: "Order note", width: 130, value: (row) => row.orderNote },
        { header: "Ext. cost", width: 60, align: "right", value: (row) => formatCurrency(row.materialCost) },
        { header: "Labor hr", width: 62, align: "right", value: (row) => formatQty(row.laborHours) }
      ],
      rows,
      {
        totalRow: [
          `${PHASE_LABELS[phase]} total`,
          "",
          "",
          "",
          "",
          "",
          formatCurrency(rows.reduce((total, row) => total + row.materialCost, 0)),
          formatQty(rows.reduce((total, row) => total + row.laborHours, 0))
        ]
      }
    );
  });
  const laborRows = takeoff.materials.filter((line) => line.kind === "labor");
  if (laborRows.length > 0) {
    pdf.heading("Fixture labor");
    pdf.table(
      [
        { header: "Phase", width: 104, value: (row) => PHASE_LABELS[row.phase] },
        { header: "Description", width: 368, value: (row) => row.description },
        { header: "Qty", width: 48, align: "right", value: (row) => formatQty(row.qty) },
        { header: "Labor hr", width: 62, align: "right", value: (row) => formatQty(row.laborHours) }
      ],
      laborRows
    );
  }

  pdf.startSheet("Pipe Run Summary", "PL-3");
  pdf.table(
    [
      { header: "System", width: 150, value: (row) => row.systemLabel },
      { header: "Material", width: 170, value: (row) => row.materialLabel },
      { header: "Size", width: 56, value: (row) => formatPipeSize(row.size) },
      { header: "Location", width: 90, value: (row) => titleCase(row.location) },
      { header: "Length (ft)", width: 80, align: "right", value: (row) => formatQty(row.lengthFt) },
      { header: "Fittings", width: 80, align: "right", value: (row) => String(row.fittings) },
      { header: "Hangers", width: 94, align: "right", value: (row) => String(row.hangers) }
    ],
    takeoff.pipeTotals
  );

  pdf.startSheet("Rough-In Field Verification", "PL-4");
  pdf.table(
    [
      { header: "Area", width: 120, value: (row) => row.areaName },
      { header: "Fixture", width: 140, value: (row) => row.fixtureLabel },
      { header: "Dimension", width: 150, value: (row) => row.dimensionLabel },
      { header: "Measured", width: 66, align: "right", value: (row) => (row.measured === null ? "-" : formatInchesFraction(row.measured)) },
      { header: "Target", width: 56, align: "right", value: (row) => formatInchesFraction(row.target) },
      { header: "Range", width: 96, align: "right", value: (row) => `${formatInchesFraction(row.min)} - ${formatInchesFraction(row.max)}` },
      { header: "Status", width: 92, value: (row) => roughInStatusLabel(row.status) }
    ],
    takeoff.roughIn
  );
  pdf.paragraph("Ranges are typical rough-in values from the Worth fixture library. The approved fixture cut sheet governs.");

  return pdf.output();
}

export function generatePlumbingQuotePdf(job: PlumbingJob, quote: PlumbingQuote, takeoff: PlumbingTakeoff, branding: BrandingConfig): Blob {
  const pdf = new PlumbingPdf(job, branding, "Customer quote");
  pdf.startSheet("Plumbing Quote", "PQ-1");
  pdf.paragraph(
    `Budgetary plumbing quote for ${job.name}${job.customer ? ` for ${job.customer}` : ""}. Covers ${takeoff.fixtureCount} fixture and equipment connection${
      takeoff.fixtureCount === 1 ? "" : "s"
    } and the piping systems listed in the takeoff.`,
    PAGE.width - MARGIN * 2,
    9
  );
  pdf.y += 6;

  const phaseRows = quote.phases
    .filter((phase) => phase.materialCost > 0 || phase.laborHours > 0)
    .map((phase) => [PHASE_LABELS[phase.phase], formatCurrency(phase.materialCost + phase.laborCost)]);
  const rows: [string, string][] = [
    ...(phaseRows as [string, string][]),
    ["Fixtures & equipment furnished by Worth", formatCurrency(quote.fixtureCost)],
    ["Testing, inspection & mobilization", formatCurrency((quote.testAndInspectHours + quote.mobilizationHours) * quote.laborRate)],
    ["Sales tax on materials", formatCurrency(quote.materialTax)],
    ...quote.allowances.map((allowance) => [allowance.label, formatCurrency(allowance.amount)] as [string, string]),
    ["Permit", formatCurrency(quote.permitFee)],
    ["Overhead & profit", formatCurrency(quote.overhead + quote.margin)]
  ];
  pdf.table(
    [
      { header: "Scope", width: 520, value: (row: [string, string]) => row[0] },
      { header: "Amount", width: 200, align: "right", value: (row: [string, string]) => row[1] }
    ],
    rows,
    { totalRow: ["Estimated total", formatCurrency(quote.total)] }
  );

  pdf.heading("Fixtures included");
  const fixtureTotals = new Map<string, number>();
  takeoff.fixtureSchedule.forEach((line) => {
    const key = `${line.label}${line.furnishedBy === "others" ? " (install only, furnished by others)" : ""}`;
    fixtureTotals.set(key, (fixtureTotals.get(key) ?? 0) + line.totalQty);
  });
  pdf.paragraph([...fixtureTotals.entries()].map(([label, qty]) => `${qty} x ${label}`).join("; ") || "None");

  pdf.heading("Assumptions");
  quote.assumptions.forEach((item) => pdf.paragraph(`- ${item}`));
  pdf.heading("Exclusions");
  quote.exclusions.forEach((item) => pdf.paragraph(`- ${item}`));
  pdf.paragraph(`Pricing: ${quote.pricingName} v${quote.pricingVersion}, effective ${quote.pricingEffectiveDate}.`, PAGE.width - MARGIN * 2, 7);
  return pdf.output();
}

export function plumbingFileName(job: PlumbingJob, type: "takeoff" | "quote" | "materials"): string {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
  const extension = type === "materials" ? "csv" : "pdf";
  return `worth-construction_${safe(job.number || job.name)}_plumbing-${type}_rev-${safe(job.revision || "A")}.${extension}`;
}

/** Material list as CSV for supplier pricing requests and spreadsheets. */
export function buildMaterialCsv(takeoff: PlumbingTakeoff): string {
  const header = ["Phase", "Group", "Description", "Unit", "Qty", "Order qty", "Order note", "Unit cost", "Ext cost", "Labor hours"];
  const rows = takeoff.materials.map((line) => [
    PHASE_LABELS[line.phase],
    line.group,
    line.description,
    line.unit,
    String(line.qty),
    String(line.orderQty),
    line.orderNote,
    line.unitCost.toFixed(2),
    line.materialCost.toFixed(2),
    String(line.laborHours)
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function roughInStatusLabel(status: PlumbingTakeoff["roughIn"][number]["status"]): string {
  if (status === "pass") return "OK";
  if (status === "out-of-range") return "OUT OF RANGE";
  if (status === "not-measured") return "Not measured";
  return "No spec";
}

function titleCase(value: string): string {
  return value.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
