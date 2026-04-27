export function roundToSixteenth(value: number): number {
  return Math.round(value * 16) / 16;
}

export function roundToPrecision(value: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatInches(value: number): string {
  const rounded = roundToSixteenth(value);
  const whole = Math.trunc(rounded);
  const fraction = Math.round((rounded - whole) * 16);
  if (fraction === 0) return `${whole}"`;

  const divisor = gcd(fraction, 16);
  const numerator = fraction / divisor;
  const denominator = 16 / divisor;
  if (whole === 0) return `${numerator}/${denominator}"`;
  return `${whole} ${numerator}/${denominator}"`;
}

export function formatFeetInches(value: number): string {
  const rounded = roundToSixteenth(value);
  const feet = Math.floor(rounded / 12);
  const inches = rounded - feet * 12;
  if (feet === 0) return formatInches(inches);
  return `${feet}'-${formatInches(inches)}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

