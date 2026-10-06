// Lesson 4 (pure): the time signal and its Fourier transform magnitude/phase, in f [Hz] or w [rad/s] (CT) or rad/sample (DT).
// Course convention: X(w) = integral x(t) e^{-jwt} dt, x = (1/2pi) integral X e^{jwt} dw; X(f) = X(w) at w = 2 pi f; duality X(t) <-> 2 pi x(-w).
// Models describe a "frame" (curves, spans, arrows) that signals-panes-view draws.
import { breakWraps, formatNumber, formatQuantity, jumpList, midpointRect, niceTicks, sampleCurve } from './signals-util.js';
import { freqAxisControl, isOmega, toAxis, axisSymbol, axisUnit } from './signals-axis.js';

export const TRANSFORM_FAMILIES = [
  { value: 'rect', label: '직사각 AΠ → sinc (Ex 4.12)' },
  { value: 'tri', label: '삼각 → sinc²' },
  { value: 'exp', label: '우측 지수 e^(−αt)u(t) (Ex 4.15)' },
  { value: 'twoexp', label: '양측 지수 e^(−α|t|) (Ex 4.16)' },
  { value: 'gauss', label: '가우시안 (자기 자신)' },
  { value: 'sinc', label: 'sinc → 직사각 · 쌍대성' },
  { value: 'mod', label: '변조 x(t)cos(ω₀t)' },
  { value: 'delta', label: '임펄스 극한 q_a → δ ↔ 1 (Ex 4.14)' },
  { value: 'cos', label: 'cos(ω₀t) ↔ 델타 두 개 (Ex 4.36)' },
  { value: 'psd', label: '정현파 PSD·자기상관 (Ex 4.42)' },
  { value: 'esd', label: '에너지 스펙트럼 ESD (Ex 4.41)' },
  { value: 'dt', label: '이산 구간 수열 · DTFT' },
];

export const TIME_RANGE = { lo: -4, hi: 4 }; // seconds (default)
export const FREQ_RANGE = { lo: -4, hi: 4 }; // Hz (default)
export const DT_INDEX_RANGE = { lo: -10, hi: 25 };
export const DT_OMEGA_RANGE = { lo: -2 * Math.PI, hi: 2 * Math.PI };
const TAU = 2 * Math.PI;

export const isDiscreteTransform = (family) => family === 'dt';
// 'cos' and 'psd' are line spectra (impulses); every other CT family has a continuous |X|.
const isLine = (family) => family === 'cos' || family === 'psd';

export function timeRange(family, p = {}) {
  if (family === 'psd') return { lo: -2 / (p.f0 ?? 100), hi: 2 / (p.f0 ?? 100) };
  if (family === 'esd') return { lo: -8 * (p.T ?? 0.1), hi: 8 * (p.T ?? 0.1) };
  if (family === 'delta') return { lo: -2.5, hi: 2.5 };
  return TIME_RANGE;
}
export function freqRange(family, p = {}) {
  if (family === 'psd') return { lo: -2 * (p.f0 ?? 100), hi: 2 * (p.f0 ?? 100) };
  if (family === 'dt') return DT_OMEGA_RANGE;
  if (family === 'esd') return { lo: -1.6 / (p.T ?? 0.1), hi: 1.6 / (p.T ?? 0.1) };
  if (family === 'mod') return { lo: -8, hi: 8 };
  if (family === 'delta') return { lo: -5, hi: 5 };
  return FREQ_RANGE;
}

export function transformControls(family) {
  if (family === 'dt') {
    return [
      { key: 'L', label: 'L 길이', min: 1, max: 16, step: 1, initial: 5, unit: '', integer: true },
      { key: 'n0', label: 'n₀ 이동', min: -8, max: 8, step: 1, initial: 0, unit: '', integer: true },
    ];
  }
  const shift = { key: 't0', label: 't₀ 이동', min: -2, max: 2, step: 0.05, initial: 0, unit: 's' };
  const axis = freqAxisControl(0);
  if (family === 'rect') {
    return [
      { key: 'T', label: 'τ 폭', min: 0.25, max: 4, step: 0.05, initial: 1.5, unit: 's' },
      { key: 'A', label: 'A 높이', min: 0.25, max: 4, step: 0.25, initial: 1, unit: '' }, shift, axis,
    ];
  }
  if (family === 'tri') return [{ key: 'T', label: 'T 밑변', min: 0.25, max: 4, step: 0.05, initial: 2, unit: 's' }, shift, axis];
  if (family === 'exp' || family === 'twoexp') return [{ key: 'alpha', label: 'α 감쇠', min: 0.25, max: 4, step: 0.05, initial: 1, unit: '1/s' }, shift, axis];
  if (family === 'gauss') return [{ key: 'sigma', label: 'σ 폭', min: 0.1, max: 1.5, step: 0.01, initial: 0.5, unit: 's' }, shift, axis];
  if (family === 'sinc') return [{ key: 'T', label: 'T 폭', min: 0.25, max: 3, step: 0.05, initial: 1, unit: 's' }, shift, axis];
  if (family === 'mod') {
    return [
      { key: 'T', label: 'T 포락선 폭', min: 0.5, max: 4, step: 0.1, initial: 2, unit: 's' },
      { key: 'f0', label: 'f₀ 반송파', min: 0.5, max: 3, step: 0.1, initial: 2, unit: 'Hz' }, axis,
    ];
  }
  if (family === 'delta') return [{ key: 'a', label: 'a 펄스 폭 (면적 1)', min: 0.05, max: 2, step: 0.05, initial: 1, unit: 's' }, axis];
  if (family === 'psd') {
    return [
      { key: 'A', label: 'A 진폭', min: 0.5, max: 5, step: 0.5, initial: 5, unit: '' },
      { key: 'f0', label: 'f₀ 주파수', min: 10, max: 200, step: 10, initial: 100, unit: 'Hz' }, axis,
    ];
  }
  if (family === 'cos') return [{ key: 'f0', label: 'f₀ 주파수 (0이면 상수 1)', min: 0, max: 3, step: 0.1, initial: 1, unit: 'Hz' }, axis];
  return [
    { key: 'T', label: 'T sinc 폭 (sinc(t/T))', min: 0.05, max: 1, step: 0.05, initial: 0.1, unit: 's' },
    { key: 'fB', label: 'f_B 대역', min: 0.5, max: 10, step: 0.5, initial: 3, unit: 'Hz' }, axis,
  ];
}

const complexFromPolar = (magnitude, phase) => ({ re: magnitude * Math.cos(phase), im: magnitude * Math.sin(phase) });
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
const defaults = (p) => ({ t0: 0, A: 1, ...p });

export function timeSignal(family, raw, t) {
  const p = defaults(raw);
  if (family === 'rect') return p.A * midpointRect(t, p.t0 - p.T / 2, p.t0 + p.T / 2);
  if (family === 'tri') return Math.max(0, 1 - (2 * Math.abs(t - p.t0)) / p.T);
  if (family === 'exp') return t < p.t0 ? 0 : t === p.t0 ? 0.5 : Math.exp(-p.alpha * (t - p.t0));
  if (family === 'twoexp') return Math.exp(-p.alpha * Math.abs(t - p.t0));
  if (family === 'gauss') return Math.exp(-((t - p.t0) ** 2) / (2 * p.sigma ** 2));
  if (family === 'sinc') return sinc((t - p.t0) / p.T);
  if (family === 'esd') return sinc(t / p.T);
  if (family === 'mod') return midpointRect(t, -p.T / 2, p.T / 2) * Math.cos(TAU * p.f0 * t);
  if (family === 'delta') return midpointRect(t, -p.a / 2, p.a / 2) / p.a;
  if (family === 'cos') return Math.cos(TAU * p.f0 * t);
  if (family === 'psd') return p.A * Math.cos(TAU * p.f0 * t);
  throw new RangeError('연속 시간 신호가 아닙니다.');
}

const timeEdges = (family, raw) => {
  const p = defaults(raw);
  if (family === 'rect') return [p.t0 - p.T / 2, p.t0 + p.T / 2];
  if (family === 'tri') return [p.t0 - p.T / 2, p.t0, p.t0 + p.T / 2];
  if (family === 'exp') return [p.t0];
  if (family === 'twoexp') return [p.t0];
  if (family === 'mod') return [-p.T / 2, p.T / 2];
  if (family === 'delta') return [-p.a / 2, p.a / 2];
  return [];
};

// DTFT of L ones starting at n0, in closed form: e^(-j*omega*(n0+(L-1)/2)) * sin(omega L/2)/sin(omega/2).
export function dirichletValue(L, n0, omega) {
  const den = Math.sin(omega / 2);
  const k = Math.round(omega / TAU);
  const real = Math.abs(den) < 1e-9 ? (L * Math.cos(Math.PI * k * L)) / Math.cos(Math.PI * k) : Math.sin((omega * L) / 2) / den;
  const rotation = complexFromPolar(real, -omega * (n0 + (L - 1) / 2));
  return { ...rotation, mag: Math.abs(real), phase: Math.atan2(rotation.im, rotation.re) };
}

// X(f) [f in Hz] of the centered/unshifted shape times e^(-j 2 pi f t0).
export function spectrumValue(family, raw, f) {
  const p = defaults(raw);
  if (family === 'dt') return dirichletValue(p.L, p.n0, f);
  const shiftPhase = -TAU * f * p.t0;
  let value; // complex value of the unshifted spectrum
  const w = TAU * f;
  if (family === 'rect') value = { re: p.A * p.T * sinc(f * p.T), im: 0 };
  else if (family === 'tri') value = { re: (p.T / 2) * sinc((f * p.T) / 2) ** 2, im: 0 };
  else if (family === 'gauss') value = { re: p.sigma * Math.sqrt(TAU) * Math.exp(-2 * Math.PI ** 2 * p.sigma ** 2 * f * f), im: 0 };
  else if (family === 'exp') {
    const den = p.alpha * p.alpha + w * w;
    value = { re: p.alpha / den, im: -w / den };
  } else if (family === 'twoexp') value = { re: (2 * p.alpha) / (p.alpha * p.alpha + w * w), im: 0 };
  else if (family === 'sinc' || family === 'esd') value = { re: p.T * midpointRect(f * p.T, -0.5, 0.5, 1e-12), im: 0 };
  else if (family === 'mod') value = { re: 0.5 * p.T * (sinc((f - p.f0) * p.T) + sinc((f + p.f0) * p.T)), im: 0 };
  else if (family === 'delta') value = { re: sinc(f * p.a), im: 0 };
  else if (isLine(family)) return { re: 0, im: 0, mag: 0, phase: 0 };
  else throw new RangeError('지원하지 않는 신호입니다.');
  const rotation = complexFromPolar(1, shiftPhase);
  const re = value.re * rotation.re - value.im * rotation.im;
  const im = value.re * rotation.im + value.im * rotation.re;
  return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

const PHASE_FLOOR = 0.02;

export function spectrumCurves(family, p, count = 600) {
  const { peak } = transformMetrics(family, p);
  const range = freqRange(family, p);
  const magnitude = [];
  const phase = [];
  for (let i = 0; i < count; i++) {
    const f = range.lo + ((range.hi - range.lo) * i) / (count - 1);
    const v = spectrumValue(family, p, f);
    magnitude.push([f, v.mag]);
    // Phase is meaningless where the magnitude vanishes: hide it below 2 % of the peak (same rule for every family).
    phase.push([f, v.mag > PHASE_FLOOR * peak ? v.phase : null]);
  }
  return { magnitude, phase: breakWraps(phase) };
}

export const timeCurve = (family, p, count = 600) => {
  const r = timeRange(family, p);
  return sampleCurve((t) => timeSignal(family, p, t), r.lo, r.hi, count, timeEdges(family, p), { gaps: true });
};

export function sequencePoints(p) {
  return Array.from({ length: p.L }, (_, i) => [p.n0 + i, 1]);
}

// Root of a function that is positive at lo and negative at hi (bisection).
function bisect(fn, lo, hi) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 80; i++) {
    const mid = (a + b) / 2;
    if (fn(mid) > 0) a = mid; else b = mid;
  }
  return (a + b) / 2;
}

// Half-amplitude points of the unit shapes: sinc(u) = 1/2 and sinc(u) = 1/sqrt(2) (for sinc^2 = 1/2).
export const SINC_HALF = bisect((u) => sinc(u) - 0.5, 0, 1);
const SINC_SQUARED_HALF = bisect((u) => sinc(u) - Math.SQRT1_2, 0, 1);

// Half-width of the Dirichlet main lobe: |sin(OL/2)/sin(O/2)| = L/2 (L >= 2). One ones-sequence of length 1 has |X| = 1 everywhere.
function dirichletHalfWidth(L) {
  if (L < 2) return Math.PI;
  const kernel = (omega) => Math.sin((omega * L) / 2) / Math.sin(omega / 2) - L / 2;
  return bisect(kernel, 1e-9, Math.min(Math.PI, TAU / L));
}

// Equal-height widths in closed form: where |x| >= max/2 and where |X| >= max/2 (half amplitude), with their spans.
// Memoized on the last parameters because the readout and the plot ask for the same numbers every frame.
let memo = { key: '', value: null };
export function transformMetrics(family, p) {
  const key = `${family}|${JSON.stringify(p)}`;
  if (memo.key === key) return memo.value;
  const value = computeMetrics(family, defaults(p));
  memo = { key, value };
  return value;
}

function computeMetrics(family, p) {
  let peak;
  let timeSpan;
  let freqWidth;
  let freqCenter = 0;
  if (family === 'dt') {
    peak = p.L;
    timeSpan = [p.n0 - 0.5, p.n0 + p.L - 0.5];
    freqWidth = 2 * dirichletHalfWidth(p.L);
  } else if (family === 'rect') {
    peak = p.A * p.T;
    timeSpan = [p.t0 - p.T / 2, p.t0 + p.T / 2];
    freqWidth = (2 * SINC_HALF) / p.T;
  } else if (family === 'tri') {
    peak = p.T / 2;
    timeSpan = [p.t0 - p.T / 4, p.t0 + p.T / 4];
    freqWidth = (4 * SINC_SQUARED_HALF) / p.T;
  } else if (family === 'exp') {
    peak = 1 / p.alpha;
    timeSpan = [p.t0, p.t0 + Math.LN2 / p.alpha];
    freqWidth = Math.sqrt(3) * p.alpha / Math.PI; // |X| = 1/sqrt(alpha^2 + w^2) = 1/(2 alpha) at w = sqrt(3) alpha
  } else if (family === 'twoexp') {
    peak = 2 / p.alpha;
    timeSpan = [p.t0 - Math.LN2 / p.alpha, p.t0 + Math.LN2 / p.alpha];
    freqWidth = p.alpha / Math.PI; // 2a/(a^2+w^2) = 1/a at w = +-a
  } else if (family === 'gauss') {
    peak = p.sigma * Math.sqrt(TAU);
    const half = p.sigma * Math.sqrt(2 * Math.LN2);
    timeSpan = [p.t0 - half, p.t0 + half];
    freqWidth = Math.sqrt(2 * Math.LN2) / (Math.PI * p.sigma);
  } else if (family === 'sinc' || family === 'esd') {
    peak = p.T;
    const t0 = family === 'esd' ? 0 : p.t0;
    timeSpan = [t0 - SINC_HALF * p.T, t0 + SINC_HALF * p.T];
    freqWidth = 1 / p.T;
  } else if (family === 'mod') {
    peak = spectrumValue('mod', p, p.f0).mag;
    timeSpan = [-p.T / 2, p.T / 2];
    freqWidth = (2 * SINC_HALF) / p.T;
    freqCenter = p.f0;
  } else if (family === 'delta') {
    peak = 1;
    timeSpan = [-p.a / 2, p.a / 2];
    freqWidth = (2 * SINC_HALF) / p.a;
  } else if (family === 'psd') {
    peak = (p.A * p.A) / 4; // PSD line weight |c_1|^2 with c_1 = A/2
    timeSpan = [0, 1 / p.f0];
    freqWidth = 0;
    freqCenter = p.f0;
  } else if (family === 'cos') {
    peak = 0.5;
    timeSpan = [0, p.f0 > 0 ? 1 / p.f0 : 1];
    freqWidth = 0;
    freqCenter = p.f0;
  } else throw new RangeError('지원하지 않는 신호입니다.');
  return {
    timeWidth: timeSpan[1] - timeSpan[0],
    freqWidth,
    timeSpan,
    freqSpan: [freqCenter - freqWidth / 2, freqCenter + freqWidth / 2],
    peak,
    unit: family === 'dt' ? 'rad/sample' : 'Hz',
  };
}

// Total energy of the CT signal in closed form (R = 1 ohm). Infinity for the power signal cos.
export function signalEnergy(family, raw) {
  const p = defaults(raw);
  if (family === 'rect') return p.A * p.A * p.T;
  if (family === 'tri') return p.T / 3;
  if (family === 'exp') return 1 / (2 * p.alpha);
  if (family === 'twoexp') return 1 / p.alpha;
  if (family === 'gauss') return p.sigma * Math.sqrt(Math.PI);
  if (family === 'sinc' || family === 'esd') return p.T;
  if (family === 'mod') return p.f0 > 0 ? p.T / 2 + Math.sin(TAU * p.f0 * p.T) / (4 * Math.PI * p.f0) : p.T;
  if (family === 'delta') return 1 / p.a;
  return Infinity;
}

// Energy of |X(f)|^2 over |f| <= fB (Parseval: E = integral |X(f)|^2 df), by the midpoint rule.
// Autocorrelation of A cos(2 pi f0 t): r(tau) = <x(t) x(t+tau)> = (A^2/2) cos(2 pi f0 tau); its transform is the PSD.
export const cosineAutocorrelation = (A, f0, tau) => ((A * A) / 2) * Math.cos(TAU * f0 * tau);

export function bandEnergy(family, p, fB, n = 4000) {
  let sum = 0;
  const h = (2 * fB) / n;
  for (let i = 0; i < n; i++) {
    const f = -fB + (i + 0.5) * h;
    const m = spectrumValue(family, p, f).mag;
    sum += m * m * h;
  }
  return sum;
}

export function describeTransform(family, p) {
  const m = transformMetrics(family, p);
  const axis = p.axis ?? 0;
  const k = isOmega(axis) ? TAU : 1;
  const unit = isOmega(axis) ? 'rad/s' : 'Hz';
  if (family === 'dt') {
    return `길이 L=${p.L}개 ↔ 반진폭 폭 ${formatQuantity(m.freqWidth, m.unit)} · |X(0)|=${formatNumber(m.peak)}(=표본의 합)`;
  }
  if (family === 'psd') {
    const w = isOmega(axis);
    const power = formatNumber((p.A * p.A) / 2);
    const omegaNote = w ? ` (S(ω)에는 2π가 곱해져 ${formatNumber((Math.PI * p.A * p.A) / 2)})` : '';
    return `T₀=${formatQuantity(1 / p.f0, 's')}: r(τ)=(A²/2)cos(2πf₀τ) → P=r(0)=${power}, S(f)=(A²/4)δ(f∓f₀) 면적 ${formatNumber((p.A * p.A) / 4)}씩${omegaNote} · 합 ${power}`;
  }
  if (family === 'cos') {
    return p.f0 > 0
      ? `cos(2π·${formatNumber(p.f0)}t) ↔ ±${formatNumber(toAxis(p.f0, axis))} ${unit}에 임펄스 두 개, 면적 ${isOmega(axis) ? 'π (X(ω))' : '1/2 (X(f))'} · 전력 신호 P=1/2`
      : `상수 1 ↔ 원점의 임펄스, 면적 ${isOmega(axis) ? '2π (1↔2πδ(ω))' : '1 (1↔δ(f))'} · 시간이 영원히 퍼지면 주파수는 한 점`;
  }
  if (family === 'delta') {
    return `면적 1, 폭 a=${formatQuantity(p.a, 's')} → X=sinc(fa), 첫 영점 ${formatNumber(k / p.a)} ${unit} · a→0 이면 X→1 (δ(t)↔1)`;
  }
  const product = m.timeWidth * m.freqWidth * k;
  const total = signalEnergy(family, p);
  let tail = '';
  if (family === 'esd') {
    const inBand = bandEnergy(family, p, p.fB);
    tail = ` · E=${formatNumber(total)}, |f|<${formatNumber(toAxis(p.fB, axis))} ${unit} 안 에너지 ${formatNumber(inBand)} (${formatNumber((inBand / total) * 100)}%)`;
  } else if (Number.isFinite(total) && family !== 'mod') {
    const half = m.freqWidth / 2;
    const inBand = half > 0 ? bandEnergy(family, p, half, 600) : 0;
    tail = ` · E=${formatNumber(total)}, 반진폭 대역 안 ${formatNumber((inBand / total) * 100)}%`;
  }
  const peakText = family === 'mod' ? `|X(±f₀)|=${formatNumber(m.peak)}(최댓값)` : `|X(0)|=${formatNumber(m.peak)}(=면적)`;
  return `시간 폭 ${formatQuantity(m.timeWidth, 's')} ↔ 주파수 폭 ${formatQuantity(m.freqWidth * k, unit)} · 곱 ${formatNumber(product)} · ${peakText}${tail}`;
}

// ---------------------------------------------------------------- frame for signals-panes-view
const PI_TICKS = [-2, -1, 0, 1, 2].map((m) => ({
  value: m * Math.PI,
  label: m === 0 ? '0' : m === 1 ? 'π' : m === -1 ? '−π' : `${m < 0 ? '−' : ''}${Math.abs(m)}π`,
}));
const PHASE_TICKS = [{ value: -Math.PI, label: '−π' }, { value: 0, label: '0' }, { value: Math.PI, label: 'π' }];

// Room below zero in the time pane (the oscillating signals swing to -1).
const NEG_ROOM = { sinc: 0.3, esd: 0.3, cos: 1.35, mod: 1.35, psd: 1.35 };

function timePeak(family, p) {
  if (family === 'delta') return 1 / p.a;
  if (family === 'rect' || family === 'psd') return p.A;
  return 1;
}

export function transformFrame(family, raw) {
  const p = defaults(raw);
  const discrete = family === 'dt';
  const axis = discrete ? 0 : p.axis ?? 0;
  const m = transformMetrics(family, raw);
  const sym = axisSymbol(axis);
  const unit = axisUnit(axis);
  const k = isOmega(axis) ? TAU : 1;
  const tr = discrete ? DT_INDEX_RANGE : timeRange(family, p);
  const fr = freqRange(family, p);
  const xr = discrete ? [fr.lo, fr.hi] : [toAxis(fr.lo, axis), toAxis(fr.hi, axis)];
  const xTicks = discrete ? PI_TICKS : niceTicks(xr[0], xr[1], 4);
  const top = timePeak(family, p);
  const timePane = discrete
    ? {
      title: 'x[n] (L개 표본) · n', x: [tr.lo, tr.hi], y: [-0.25, 1.35], xTicks: [-10, -5, 0, 5, 10, 15, 20, 25], yTicks: [0, 1],
      stems: [{ cls: 'c1', pts: sequencePoints(p) }],
      segments: [], texts: [{ cls: 'c4', x: p.n0 + p.L / 2 - 0.5, y: 1.2, text: `L=${p.L}`, dy: -6 }],
    }
    : (() => {
      const curve = timeCurve(family, p);
      const edges = timeEdges(family, p);
      const xFn = (t) => timeSignal(family, p, t);
      const [lo, hi] = m.timeSpan;
      const pane = {
        title: `x(t) · t [s]`, x: [tr.lo, tr.hi], y: [-(NEG_ROOM[family] ?? 0.25) * top, 1.35 * top], xTicks: niceTicks(tr.lo, tr.hi, 4),
        yTicks: NEG_ROOM[family] > 1 ? [-top, 0, top] : [0, Number(top.toPrecision(3))],
        areas: isLine(family) ? [] : [{ cls: 'c1', pts: curve }], lines: [{ cls: 'c1', pts: curve }],
        jumps: [{ cls: 'c1', list: jumpList(xFn, edges, tr.lo, tr.hi) }],
      };
      if (family === 'delta') {
        pane.segments = [{ cls: 'cm dash', x1: 0, y1: 0, x2: 0, y2: top * 1.25 }];
      }
      if (!isLine(family)) {
        pane.segments = [...(pane.segments ?? []), { cls: 'c4', x1: lo, y1: top / 2, x2: hi, y2: top / 2 }];
        pane.texts = [{ cls: 'c4', x: (lo + hi) / 2, y: top / 2, text: `Δt ${formatQuantity(m.timeWidth, 's')}`, dy: -6 }];
      }
      return pane;
    })();

  let magPane;
  let phasePane;
  if (family === 'psd') {
    const weight = (p.A * p.A) / 4;
    const label = isOmega(axis) ? formatNumber((Math.PI * p.A * p.A) / 2) : formatNumber(weight);
    const top2 = isOmega(axis) ? (Math.PI * p.A * p.A) / 2 : weight;
    magPane = {
      title: `PSD S(${sym}) (화살표 = 면적 ${label}) · ${sym} [${unit}]`, x: xr, y: [-0.2 * top2, top2 * 1.55], xTicks, yTicks: [0, Number(top2.toPrecision(3))],
      segments: [-p.f0, p.f0].map((f) => ({ cls: 'c2', x1: toAxis(f, axis), y1: 0, x2: toAxis(f, axis), y2: top2 * 1.2 })),
      texts: [-p.f0, p.f0].map((f) => ({ cls: 'c2', x: toAxis(f, axis), y: top2 * 1.2, text: label, dy: -6 })),
    };
    const r = (tau) => cosineAutocorrelation(p.A, p.f0, tau);
    const half = (p.A * p.A) / 2;
    phasePane = {
      title: 'r_xx(τ)=⟨x(t)x(t+τ)⟩=(A²/2)cos(2πf₀τ) · S=F{r} · τ [s]', x: [tr.lo, tr.hi], y: [-half * 1.3, half * 1.3], xTicks: niceTicks(tr.lo, tr.hi, 4),
      yTicks: [-half, 0, half], lines: [{ cls: 'c3', pts: sampleCurve(r, tr.lo, tr.hi, 400) }], hlines: [{ cls: 'c4 dash', y: half }],
    };
  } else if (family === 'cos') {
    const w = isOmega(axis) ? Math.PI : 0.5;
    const weight = p.f0 > 0 ? w : isOmega(axis) ? TAU : 1;
    const label = isOmega(axis) ? (p.f0 > 0 ? 'π' : '2π') : p.f0 > 0 ? '1/2' : '1';
    const at = p.f0 > 0 ? [-p.f0, p.f0] : [0];
    magPane = {
      title: `X(${sym}) — 임펄스 (화살표 = 면적 ${label}) · ${sym} [${unit}]`, x: xr, y: [-0.2 * weight, weight * 1.55], xTicks, yTicks: [0, weight],
      segments: at.map((f) => ({ cls: 'c2', x1: toAxis(f, axis), y1: 0, x2: toAxis(f, axis), y2: weight * 1.2 })),
      texts: at.map((f) => ({ cls: 'c2', x: toAxis(f, axis), y: weight * 1.2, text: label, dy: -6 })),
    };
    phasePane = { title: `∠X(${sym}) = 0 (실수 스펙트럼)`, x: xr, y: [-Math.PI * 1.1, Math.PI * 1.1], xTicks, yTicks: PHASE_TICKS, lines: [{ cls: 'c3 thin', pts: [[xr[0], 0], [xr[1], 0]] }] };
  } else {
    const { magnitude, phase } = spectrumCurves(family, raw);
    const esd = family === 'esd';
    const toX = ([f, v]) => [discrete ? f : toAxis(f, axis), esd ? v * v : v];
    const peak = esd ? m.peak * m.peak : m.peak;
    const mag = magnitude.map(toX);
    const [flo, fhi] = m.freqSpan;
    const magPaneBase = {
      title: discrete ? '|X(e^{jΩ})| · Ω [rad/sample], 2π 주기' : esd ? `ESD G(${sym})=|X(${sym})|² · ${sym} [${unit}]` : `|X(${sym})| · ${sym} [${unit}]`,
      x: xr, y: [-peak * 0.08, peak * 1.28], xTicks, yTicks: [0, Number(peak.toPrecision(2))], areas: [{ cls: 'c2', pts: mag }], lines: [{ cls: 'c2', pts: mag }],
    };
    if (esd) {
      const band = mag.filter(([x]) => Math.abs(x) <= toAxis(p.fB, axis));
      magPaneBase.areas = [{ cls: 'c2', pts: mag }, { cls: 'c4 strong', pts: band }];
      magPaneBase.texts = [{ cls: 'c4', x: 0, y: peak * 0.5, text: `|${sym}|<${formatNumber(toAxis(p.fB, axis))}: ${formatNumber((bandEnergy(family, p, p.fB) / signalEnergy(family, p)) * 100)}% 에너지`, dy: 0 }];
    } else if (m.freqWidth > 0) {
      const lo = discrete ? flo : toAxis(flo, axis);
      const hi = discrete ? fhi : toAxis(fhi, axis);
      magPaneBase.segments = [{ cls: 'c4', x1: lo, y1: peak / 2, x2: hi, y2: peak / 2 }];
      magPaneBase.texts = [{ cls: 'c4', x: (lo + hi) / 2, y: peak / 2, text: `Δ ${formatQuantity(m.freqWidth * (discrete ? 1 : k), discrete ? m.unit : unit)}`, dy: -6 }];
    }
    if (family === 'delta') magPaneBase.hlines = [{ cls: 'cm dash', y: 1 }];
    magPane = magPaneBase;
    phasePane = {
      title: discrete ? '∠X(e^{jΩ}) [rad] · 시간 이동은 위상만 기울임' : `∠X(${sym}) [rad] · 시간 이동은 위상만 기울임`, x: xr, y: [-Math.PI * 1.1, Math.PI * 1.1], xTicks,
      yTicks: PHASE_TICKS, lines: [{ cls: 'c3 thin', pts: phase.map(([f, v]) => [discrete ? f : toAxis(f, axis), v]) }],
    };
  }
  let named;
  if (discrete) named = ['x[n] 시간 신호', '|X(e^{jΩ})| 크기', '∠X(e^{jΩ}) 위상'];
  else if (family === 'psd') named = ['x(t) 시간 신호', `PSD S(${sym})`, '자기상관 r(τ)'];
  else named = ['x(t) 시간 신호', family === 'esd' ? 'G=|X|² 에너지 밀도' : `|X(${sym})| 크기`, `∠X(${sym}) 위상`];
  return {
    split: true,
    panes: [timePane, magPane, phasePane],
    legend: [{ cls: 'c1', text: named[0] }, { cls: 'c2', text: named[1] }, { cls: 'c3', text: named[2] }, { cls: 'c4 mk', text: isLine(family) ? '임펄스 면적' : '반진폭 폭 (Δ)' }],
  };
}

// ---- lesson description consumed by the controller -------------------------------------------

const FORMULAS_F = {
  rect: 'X(f)=A T sinc(fT) e^(−j2πf t₀); sinc(u)=sin(πu)/(πu)',
  tri: 'X(f)=(T/2) sinc²(fT/2) e^(−j2πf t₀)',
  exp: 'X(f)=e^(−j2πf t₀)/(α+j2πf)',
  twoexp: 'X(f)=2α/(α²+(2πf)²) e^(−j2πf t₀)',
  gauss: 'X(f)=σ√(2π) e^(−2π²σ²f²) e^(−j2πf t₀)',
  sinc: 'x(t)=sinc(t/T)↔X(f)=T Π(fT); Π(t)↔sinc(f)⇒sinc(t)↔Π(f)',
  mod: 'x(t)cos(2πf₀t)↔[X(f−f₀)+X(f+f₀)]/2',
  delta: 'q_a(t)=(1/a)Π(t/a)↔sinc(fa); a→0: δ(t)↔1',
  cos: 'cos(2πf₀t)↔[δ(f−f₀)+δ(f+f₀)]/2; 1↔δ(f)',
  psd: 'r(τ)=(A²/2)cos(2πf₀τ); S_x(f)=F{r}=(A²/4)[δ(f−f₀)+δ(f+f₀)]; P=r(0)=A²/2',
  esd: 'E_x=∫|x|²dt=∫|X(f)|²df; G_x(f)=|X(f)|²',
  dt: 'X(e^(jΩ))=e^(−jΩ n₀) Σ_{k=0}^{L−1} e^(−jΩk); |X|=|sin(ΩL/2)/sin(Ω/2)|',
};
const FORMULAS_W = {
  rect: 'X(ω)=A T sinc(ωT/2π) e^(−jω t₀); sinc(u)=sin(πu)/(πu)',
  tri: 'X(ω)=(T/2) sinc²(ωT/4π) e^(−jω t₀)',
  exp: 'X(ω)=e^(−jω t₀)/(α+jω)',
  twoexp: 'X(ω)=2α/(α²+ω²) e^(−jω t₀)',
  gauss: 'X(ω)=σ√(2π) e^(−σ²ω²/2) e^(−jω t₀)',
  sinc: 'x(t)=sinc(t/T)↔X(ω)=T Π(ωT/2π); x(t)↔X(ω)⇒X(t)↔2πx(−ω)',
  mod: 'x(t)cos(ω₀t)↔[X(ω−ω₀)+X(ω+ω₀)]/2',
  delta: 'q_a(t)=(1/a)Π(t/a)↔sinc(ωa/2π); a→0: δ(t)↔1',
  cos: 'cos(ω₀t)↔πδ(ω−ω₀)+πδ(ω+ω₀); 1↔2πδ(ω); e^(jω₀t)↔2πδ(ω−ω₀)',
  psd: 'r(τ)=(A²/2)cos(ω₀τ); S_x(ω)=F{r}=(πA²/2)[δ(ω−ω₀)+δ(ω+ω₀)]; P=r(0)=A²/2',
  esd: 'E_x=∫|x|²dt=(1/2π)∫|X(ω)|²dω; G_x(ω)=|X(ω)|²',
  dt: FORMULAS_F.dt,
};

const READS = {
  dt: 'L을 키우면 시간에서 넓어지고 주 로브는 좁아집니다. DTFT는 2π마다 반복되고, n₀는 위상만 바꿉니다.',
  rect: '시간에서 좁게 만들수록 주파수에서 넓어지고, 높이를 키우면 |X(0)|=면적이 커집니다. t₀는 |X|를 그대로 두고 위상만 기울입니다.',
  twoexp: '좌우 대칭(우함수) 신호의 FT는 순실수입니다 (위상 0). α가 크면 시간에서 좁고 주파수에서 넓습니다.',
  sinc: '쌍대성: Π(t)↔sinc이면 sinc↔Π(직사각)입니다. ω 형태는 X(t)↔2πx(−ω). sinc가 넓을수록 직사각 대역은 좁아집니다.',
  mod: '변조: x(t)cos(ω₀t)의 스펙트럼은 X(ω)를 ±ω₀로 옮기고 절반으로 줄인 복사본 두 개입니다.',
  delta: '폭 a를 줄이면 높이 1/a로 면적 1을 유지한 채 스펙트럼이 평평해져 δ(t)↔1에 가까워집니다 (첫 영점 1/a).',
  psd: '전력 신호는 PSD로 봅니다. 자기상관 r(τ)의 푸리에 변환이 S(f)이고, 두 선의 면적을 더하면 전력 r(0)=A²/2입니다.',
  cos: '주기 신호의 FT는 임펄스 열입니다: cos↔두 임펄스(면적 π, ω 형태), 상수 1↔2πδ(ω). f₀→0 이면 한 점으로 모입니다.',
  esd: 'ESD G=|X|²의 전체 면적이 에너지이고(Parseval) 음영 대역 안의 면적이 그 대역의 에너지입니다. 대역을 넓혀 보세요.',
};

export const transformLesson = {
  id: 'fourier',
  families: TRANSFORM_FAMILIES,
  initialFamily: 'rect',
  controls: transformControls,
  scrub: false,
  read(family) {
    return READS[family] ?? '시간에서 좁게 만들수록 주파수에서 넓어지고, 넓게 만들수록 좁아집니다. t₀는 |X|를 그대로 두고 위상만 기울입니다.';
  },
  formula: (family, params = {}) => `X(ω)=∫ x(t) e^(−jωt) dt; x(t)=(1/2π)∫ X(ω) e^(jωt) dω; X(f)=X(2πf); ${(isOmega(params.axis ?? 0) ? FORMULAS_W : FORMULAS_F)[family]}`,
  describe: ({ family, params }) => describeTransform(family, params),
};
