export function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundCurrency(value: number): number {
  return round(value, 2);
}

/** Formats nominal pipe sizes the way the trade writes them: 0.5 -> 1/2", 1.25 -> 1-1/4". */
export function formatPipeSize(size: number): string {
  const whole = Math.floor(size);
  const fraction = size - whole;
  const fractions: [number, string][] = [
    [0.25, "1/4"],
    [0.375, "3/8"],
    [0.5, "1/2"],
    [0.75, "3/4"]
  ];
  const match = fractions.find(([value]) => Math.abs(value - fraction) < 0.001);
  if (fraction < 0.001) return `${whole}"`;
  if (!match) return `${round(size, 3)}"`;
  return whole === 0 ? `${match[1]}"` : `${whole}-${match[1]}"`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : round(value, 2).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Formats inches as a mixed fraction to the nearest 1/16 (e.g. 17-1/2"). */
export function formatInchesFraction(value: number): string {
  const sign = value < 0 ? "-" : "";
  const sixteenths = Math.round(Math.abs(value) * 16);
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  let denominator = 16;
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  if (numerator === 0) return `${sign}${whole}"`;
  if (whole === 0) return `${sign}${numerator}/${denominator}"`;
  return `${sign}${whole}-${numerator}/${denominator}"`;
}

/**
 * Parses field-tape entries into inches: `17.5`, `17 1/2`, `17-1/2`, `1'5-1/2"`, `1' 5"`.
 * Returns null when the text cannot be read as a length.
 */
export function parseInches(raw: string): number | null {
  const text = raw.trim().replace(/[”″"]/g, "").replace(/[’′]/g, "'").replace(/\s+/g, " ");
  if (!text) return null;

  const feetMatch = text.match(/^(\d+(?:\.\d+)?)\s*'\s*-?\s*(.*)$/);
  if (feetMatch) {
    const inches = parseInchPart(feetMatch[2]);
    return inches === null ? null : Number(feetMatch[1]) * 12 + inches;
  }
  return parseInchPart(text);
}

function parseInchPart(raw: string): number | null {
  const text = raw.trim();
  if (!text) return 0;
  const mixed = text.match(/^(\d+(?:\.\d+)?)?[\s-]*(\d+)\/(\d+)$/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return (mixed[1] ? Number(mixed[1]) : 0) + Number(mixed[2]) / denominator;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Parses a pipe length into feet: `42`, `42.5`, `42'6`, `42' 6"`, `510"`. */
export function parseFeet(raw: string): number | null {
  const text = raw.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'");
  if (!text) return null;
  if (/^\d+(?:\.\d+)?\s*"$/.test(text)) return Number(text.replace(/"/g, "").trim()) / 12;
  if (text.includes("'")) {
    const inches = parseInches(text);
    return inches === null ? null : inches / 12;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
