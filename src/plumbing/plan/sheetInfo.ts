// Pure helpers that read plan-sheet facts from PDF text. No pdf.js here, so they are unit tested.

export interface TextRun {
  text: string;
  /** Approximate font height in PDF points. Title-block text is usually the largest. */
  height: number;
}

export interface DetectedScale {
  label: string;
  /** Real-world feet per inch of paper. */
  feetPerInch: number;
  feetPerPoint: number;
}

const POINTS_PER_INCH = 72;

/** Common drawing scales for the manual scale picker. */
export const COMMON_SCALES: { label: string; feetPerInch: number }[] = [
  { label: `1/16" = 1'-0"`, feetPerInch: 16 },
  { label: `3/32" = 1'-0"`, feetPerInch: 32 / 3 },
  { label: `1/8" = 1'-0"`, feetPerInch: 8 },
  { label: `3/16" = 1'-0"`, feetPerInch: 16 / 3 },
  { label: `1/4" = 1'-0"`, feetPerInch: 4 },
  { label: `3/8" = 1'-0"`, feetPerInch: 8 / 3 },
  { label: `1/2" = 1'-0"`, feetPerInch: 2 },
  { label: `3/4" = 1'-0"`, feetPerInch: 4 / 3 },
  { label: `1" = 1'-0"`, feetPerInch: 1 },
  { label: `1" = 10'`, feetPerInch: 10 },
  { label: `1" = 20'`, feetPerInch: 20 },
  { label: `1" = 30'`, feetPerInch: 30 },
  { label: `1" = 40'`, feetPerInch: 40 },
  { label: `1" = 50'`, feetPerInch: 50 }
];

export function scaleFromFeetPerInch(label: string, feetPerInch: number): DetectedScale {
  return { label, feetPerInch, feetPerPoint: feetPerInch / POINTS_PER_INCH };
}

function normalizeQuotes(text: string): string {
  return text
    .replace(/[”″“]/g, '"')
    .replace(/[’′‘]/g, "'")
    .replace(/''/g, '"')
    .replace(/\s+/g, " ");
}

function parseFraction(raw: string): number | null {
  const text = raw.trim().replace(/-/g, " ");
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Finds drawing scales in sheet text, most frequent first.
 * Reads architectural (1/4" = 1'-0"), engineering (1" = 20') and ratio (1:48) notation.
 */
export function detectScales(rawText: string): DetectedScale[] {
  const text = normalizeQuotes(rawText);
  const found = new Map<string, { scale: DetectedScale; count: number }>();
  const add = (label: string, feetPerInch: number) => {
    if (!(feetPerInch > 0) || feetPerInch > 2000) return;
    const key = feetPerInch.toFixed(5);
    const existing = found.get(key);
    if (existing) existing.count += 1;
    else found.set(key, { scale: scaleFromFeetPerInch(label, feetPerInch), count: 1 });
  };

  const architectural = /(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*"\s*=\s*1\s*'\s*-?\s*0?\s*"?/g;
  for (const match of text.matchAll(architectural)) {
    const paperInches = parseFraction(match[1]);
    if (paperInches) add(`${match[1].replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/")}" = 1'-0"`, 1 / paperInches);
  }

  const engineering = /\b1\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'(?!\s*-?\s*\d)/g;
  for (const match of text.matchAll(engineering)) {
    const feet = Number(match[1]);
    if (feet !== 1) add(`1" = ${match[1]}'`, feet);
  }

  const ratio = /\b(?:scale\s*:?\s*)?1\s*:\s*(\d{2,4})\b/gi;
  for (const match of text.matchAll(ratio)) {
    const denominator = Number(match[1]);
    add(`1:${denominator}`, denominator / 12);
  }

  return [...found.values()].sort((a, b) => b.count - a.count).map((entry) => entry.scale);
}

const SHEET_NUMBER = /\b(P|PL|MP|M|A|E|S|C|G|FP)\s?-?\s?(\d{1,3}(?:\.\d{1,2})?[A-Z]?)\b/;

/**
 * Picks the sheet number and title from title-block text. The largest text that looks like a
 * sheet number wins; a plumbing sheet number (P-101) is preferred over others.
 */
export function detectSheetIdentity(runs: TextRun[]): { sheetNumber: string; title: string; isPlumbing: boolean } {
  const candidates = runs
    .map((run) => ({ run, match: run.text.trim().match(new RegExp(`^${SHEET_NUMBER.source}$`)) }))
    .filter((candidate) => candidate.match)
    .map(({ run, match }) => ({ height: run.height, prefix: match![1], value: `${match![1]}-${match![2]}` }));

  const plumbing = candidates.filter((candidate) => candidate.prefix === "P" || candidate.prefix === "PL" || candidate.prefix === "MP");
  const pool = plumbing.length ? plumbing : candidates;
  const sheetNumber = pool.sort((a, b) => b.height - a.height)[0]?.value ?? "";

  const titleRun = runs
    .filter((run) => /\bPLAN\b|\bPLUMBING\b|\bRISER\b|\bISOMETRIC\b|\bSITE\b|\bFLOOR\b/i.test(run.text) && run.text.trim().length <= 80)
    .filter((run) => !/SCALE/i.test(run.text))
    .sort((a, b) => b.height - a.height)[0];

  const allText = runs.map((run) => run.text).join(" ");
  return {
    sheetNumber,
    title: titleRun?.text.trim().replace(/\s+/g, " ") ?? "",
    isPlumbing: sheetNumber.startsWith("P") || sheetNumber.startsWith("MP") || /\bPLUMBING\b/i.test(allText)
  };
}

const PAPER_SIZES: { name: string; w: number; h: number }[] = [
  { name: "ARCH E", w: 36, h: 48 },
  { name: "ARCH E1", w: 30, h: 42 },
  { name: "ARCH D", w: 24, h: 36 },
  { name: "ANSI D", w: 22, h: 34 },
  { name: "ARCH C", w: 18, h: 24 },
  { name: "ANSI C", w: 17, h: 22 },
  { name: "ARCH B", w: 12, h: 18 },
  { name: "Tabloid", w: 11, h: 17 },
  { name: "Letter", w: 8.5, h: 11 }
];

/** Names the paper size and warns when a reduced print would make the printed scale wrong. */
export function describePaper(widthPt: number, heightPt: number): { label: string; reduced: boolean } {
  const w = Math.min(widthPt, heightPt) / POINTS_PER_INCH;
  const h = Math.max(widthPt, heightPt) / POINTS_PER_INCH;
  const match = PAPER_SIZES.find((size) => Math.abs(size.w - w) < 0.3 && Math.abs(size.h - h) < 0.3);
  const dims = `${round1(w)}" x ${round1(h)}"`;
  return {
    label: match ? `${match.name} (${dims})` : dims,
    reduced: h <= 18.5
  };
}

function round1(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
