/** Pure display mathematics. This module never edits the circuit or solver samples. */
export const X_DIVISIONS = 10;
export const Y_DIVISIONS = 8;

export function niceCeiling(value) {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const step = [1, 2, 5, 10].find((candidate) => candidate >= fraction * (1 - 1e-12));
  return step * power;
}

export function step125(value, direction) {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].map((step) => step * power);
  const next = direction > 0
    ? candidates.find((candidate) => candidate > value * (1 + 1e-10))
    : candidates.findLast((candidate) => candidate < value * (1 - 1e-10));
  return Math.max(1e-300, Math.min(1e300, next ?? value));
}

export function engineering(value, unit = "", precision = 4) {
  if (value === Number.NEGATIVE_INFINITY && ["dBV", "dBA"].includes(unit)) return `−∞ ${unit}`;
  if (!Number.isFinite(value)) return `— ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  if (["dBV", "dBA", "dB", "°", "dec"].includes(unit)) return `${Number(value.toPrecision(precision))} ${unit}`;
  const prefixes = new Map([[-15, "f"], [-12, "p"], [-9, "n"], [-6, "µ"], [-3, "m"], [0, ""], [3, "k"], [6, "M"], [9, "G"], [12, "T"]]);
  const exponent = Math.max(-15, Math.min(12, 3 * Math.floor(Math.log10(Math.abs(value)) / 3 + 1e-12)));
  return `${Number((value / 10 ** exponent).toPrecision(precision))} ${prefixes.get(exponent)}${unit}`.trim();
}

export function fittedAxis(values, { divisions = Y_DIVISIONS, includeZero = true } = {}) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!Number.isFinite(minimum)) return { minimum: -2, maximum: 2, division: 0.5, automatic: true };
  const absolute = Math.max(Math.abs(minimum), Math.abs(maximum));
  if (absolute > 1e300 || (absolute > 0 && absolute < 1e-300)) throw new RangeError("표시 가능한 수치 범위(10⁻³⁰⁰~10³⁰⁰)를 벗어났습니다.");
  if (includeZero) { minimum = Math.min(0, minimum); maximum = Math.max(0, maximum); }
  if (maximum === minimum) {
    const padding = Math.abs(maximum) * 0.15 || 1;
    minimum -= padding;
    maximum += padding;
  }
  let division = niceCeiling((maximum - minimum) * 1.1 / divisions);
  let center = Math.round((minimum + maximum) / 2 / division) * division;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (center - division * divisions / 2 <= minimum && center + division * divisions / 2 >= maximum) break;
    const next = step125(division, 1);
    if (!(next > division) || !Number.isFinite(next)) throw new RangeError("눈금을 안전하게 맞출 수 없습니다.");
    division = next;
    center = Math.round((minimum + maximum) / 2 / division) * division;
    if (attempt === 15) throw new RangeError("눈금 맞춤 반복 한도를 초과했습니다.");
  }
  return { minimum: center - division * divisions / 2, maximum: center + division * divisions / 2, division, automatic: true };
}

export function fittedXAxis(xValues, logarithmic = false) {
  const first = logarithmic ? Math.log10(xValues[0]) : xValues[0];
  const last = logarithmic ? Math.log10(xValues.at(-1)) : xValues.at(-1);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { minimum: 0, maximum: 1, division: .1, automatic: true };
  const division = niceCeiling((last - first || 1) / X_DIVISIONS);
  return { minimum: first, maximum: first + division * X_DIVISIONS, division, automatic: true };
}

export function zoomAxis(axis, direction, fraction = .5, divisions = Y_DIVISIONS) {
  const division = step125(axis.division, direction);
  fraction = Math.max(0, Math.min(1, fraction));
  const anchor = axis.minimum + fraction * (axis.maximum - axis.minimum);
  const minimum = anchor - fraction * divisions * division;
  const maximum = minimum + divisions * division;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || !(maximum > minimum)) return { ...axis };
  return { minimum, maximum, division, automatic: false };
}

/** Binary search on actual sample coordinates, not an assumed uniformly-spaced index. */
export function nearestSampleIndex(xValues, target) {
  if (!xValues.length || !Number.isFinite(target)) return null;
  let low = 0;
  let high = xValues.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (xValues[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low > 0 && Math.abs(xValues[low - 1] - target) <= Math.abs(xValues[low] - target) ? low - 1 : low;
}

/** Keep first/last/min/max per pixel bucket so display reduction does not hide narrow peaks. */
export function extremaIndices(xValues, yValues, minimum, maximum, pixels = 900) {
  const selected = [];
  let bucket = null;
  const flush = () => {
    if (!bucket) return;
    selected.push(...[...new Set([bucket.first, bucket.low, bucket.high, bucket.last])].sort((a, b) => a - b));
  };
  for (let index = 0; index < xValues.length; index += 1) {
    if (xValues[index] < minimum || xValues[index] > maximum) continue;
    // A non-finite sample must create a gap, not a line across missing data.
    if (!Number.isFinite(yValues[index]) || yValues[index] === null) {
      flush(); selected.push(index); bucket = null; continue;
    }
    const column = Math.floor((xValues[index] - minimum) / (maximum - minimum) * pixels);
    if (!bucket || column !== bucket.column) {
      flush(); bucket = { column, first: index, last: index, low: index, high: index };
    } else {
      bucket.last = index;
      if (yValues[index] < yValues[bucket.low]) bucket.low = index;
      if (yValues[index] > yValues[bucket.high]) bucket.high = index;
    }
  }
  flush();
  return selected;
}

/** One SI prefix for every tick of a physical axis, including the zero tick. */
export function axisDisplayUnit(axis, quantity) {
  if (!["V", "A"].includes(quantity)) return { scale: 1, unit: quantity };
  const peak = Math.max(Math.abs(axis.minimum), Math.abs(axis.maximum), axis.division);
  const exponent = peak > 0 && Number.isFinite(peak) ? Math.max(-15, Math.min(12, 3 * Math.floor(Math.log10(peak) / 3 + 1e-12))) : 0;
  const prefixes = { [-15]: "f", [-12]: "p", [-9]: "n", [-6]: "µ", [-3]: "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T" };
  return { scale: 10 ** -exponent, unit: `${prefixes[exponent]}${quantity}` };
}
