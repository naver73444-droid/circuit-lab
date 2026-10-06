// Pure helpers shared by the signals lessons: clamping, number formatting, ticks, curve sampling.
export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

const MINUS = '−';

// Coordinate rounding for SVG attributes: one decimal.
export const r1 = (value) => Math.round(value * 10) / 10;

// Initial slider values of a controls list: {key: initial}.
export const controlDefaults = (controls) => Object.fromEntries(controls.map((c) => [c.key, c.initial]));

// Rectangle on (lo, hi): 1 inside, the midpoint 1/2 on the edges (course convention), 0 outside.
export function midpointRect(x, lo, hi, eps = 1e-12) {
  if (Math.abs(x - lo) <= eps || Math.abs(x - hi) <= eps) return 0.5;
  return x > lo && x < hi ? 1 : 0;
}

// At most `digits` significant digits, no trailing zeros, typographic minus.
export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return '0';
  const abs = Math.abs(value);
  let text;
  if (abs >= 1e5 || abs < 1e-3) {
    const [mantissa, exponent] = value.toExponential(digits - 1).split('e');
    text = `${Number(mantissa)}×10^${Number(exponent)}`;
  } else {
    text = String(Number(value.toPrecision(digits)));
  }
  return text.replace(/-/g, MINUS);
}

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];

// SI formatting with a prefix chosen so the mantissa is in [1, 1000): 0.25 s -> "250 ms".
export function formatSI(value, unit = '', digits = 3) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-12) return unit ? `0 ${unit}` : '0';
  const abs = Math.abs(value);
  let index = PREFIXES.findIndex(([factor]) => abs >= factor * 0.9995);
  if (index < 0) index = PREFIXES.length - 1;
  let [factor, prefix] = PREFIXES[index];
  // 999.9 rounds to "1000": promote to the next prefix instead.
  if (Math.abs(Number((value / factor).toPrecision(digits))) >= 1000 && index > 0) {
    [factor, prefix] = PREFIXES[index - 1];
  }
  const text = formatNumber(value / factor, digits);
  return `${text} ${prefix}${unit}`.trim();
}

// "Nice" tick values (1-2-5 steps) inside [min, max].
export function niceTicks(min, max, target = 5) {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
  const raw = (max - min) / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * power;
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return ticks;
}

// Uniform samples of fn on [lo, hi]. Each interior discontinuity/kink in `edges` gets
// three points (just before, at, just after) so polylines draw vertical jumps and sharp corners.
export function sampleCurve(fn, lo, hi, count = 400, edges = []) {
  const eps = Math.max(1e-12, (hi - lo) * 1e-9);
  const inside = edges.filter((edge) => edge > lo + eps && edge < hi - eps);
  const points = [];
  for (let i = 0; i < count; i++) {
    const x = lo + ((hi - lo) * i) / (count - 1);
    if (!inside.some((edge) => Math.abs(x - edge) < eps * 4)) points.push([x, fn(x)]);
  }
  for (const edge of inside) points.push([edge, fn(edge - eps)], [edge, fn(edge)], [edge, fn(edge + eps)]);
  return points.sort((p, q) => p[0] - q[0]);
}

// Slider/readout text: seconds get SI prefixes ("250 ms"); other units stay plain ("0.5 Hz", "2 1/s").
export function formatQuantity(value, unit = '') {
  if (unit === 's') return formatSI(value, 's');
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}
