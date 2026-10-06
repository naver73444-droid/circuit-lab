// Lesson 4 (pure): the time signal and its Fourier transform magnitude/phase, in Hz (CT) or rad/sample (DT).
import { controlDefaults, formatNumber, formatQuantity, midpointRect, sampleCurve } from './signals-util.js';

export const TRANSFORM_FAMILIES = [
  { value: 'rect', label: '직사각 → sinc' },
  { value: 'tri', label: '삼각 → sinc²' },
  { value: 'exp', label: '우측 감쇠 지수' },
  { value: 'gauss', label: '가우시안 (자기 자신)' },
  { value: 'dt', label: '이산 구간 수열 · DTFT' },
];

export const TIME_RANGE = { lo: -4, hi: 4 }; // seconds
export const FREQ_RANGE = { lo: -4, hi: 4 }; // Hz
export const DT_INDEX_RANGE = { lo: -10, hi: 25 };
export const DT_OMEGA_RANGE = { lo: -2 * Math.PI, hi: 2 * Math.PI };
const TAU = 2 * Math.PI;

export const isDiscreteTransform = (family) => family === 'dt';

export function transformControls(family) {
  if (family === 'dt') {
    return [
      { key: 'L', label: 'L 길이', min: 1, max: 16, step: 1, initial: 5, unit: '', integer: true },
      { key: 'n0', label: 'n₀ 이동', min: -8, max: 8, step: 1, initial: 0, unit: '', integer: true },
    ];
  }
  const shift = { key: 't0', label: 't₀ 이동', min: -2, max: 2, step: 0.05, initial: 0, unit: 's' };
  if (family === 'rect') return [{ key: 'T', label: 'T 폭', min: 0.25, max: 4, step: 0.05, initial: 1.5, unit: 's' }, shift];
  if (family === 'tri') return [{ key: 'T', label: 'T 밑변', min: 0.25, max: 4, step: 0.05, initial: 2, unit: 's' }, shift];
  if (family === 'exp') return [{ key: 'alpha', label: 'α 감쇠', min: 0.25, max: 4, step: 0.05, initial: 1, unit: '1/s' }, shift];
  return [{ key: 'sigma', label: 'σ 폭', min: 0.1, max: 1.5, step: 0.01, initial: 0.5, unit: 's' }, shift];
}

const complexFromPolar = (magnitude, phase) => ({ re: magnitude * Math.cos(phase), im: magnitude * Math.sin(phase) });
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

export function timeSignal(family, p, t) {
  if (family === 'rect') return midpointRect(t, p.t0 - p.T / 2, p.t0 + p.T / 2);
  if (family === 'tri') return Math.max(0, 1 - (2 * Math.abs(t - p.t0)) / p.T);
  if (family === 'exp') return t < p.t0 ? 0 : t === p.t0 ? 0.5 : Math.exp(-p.alpha * (t - p.t0));
  if (family === 'gauss') return Math.exp(-((t - p.t0) ** 2) / (2 * p.sigma ** 2));
  throw new RangeError('연속 시간 신호가 아닙니다.');
}

const timeEdges = (family, p) => {
  if (family === 'rect') return [p.t0 - p.T / 2, p.t0 + p.T / 2];
  if (family === 'tri') return [p.t0 - p.T / 2, p.t0, p.t0 + p.T / 2];
  if (family === 'exp') return [p.t0];
  return [];
};

// X(f) of the centered/unshifted shape times e^(-j 2 pi f t0).
// DTFT of L ones starting at n0, in closed form: e^(-j*omega*(n0+(L-1)/2)) * sin(omega L/2)/sin(omega/2).
export function dirichletValue(L, n0, omega) {
  const den = Math.sin(omega / 2);
  const k = Math.round(omega / TAU);
  const real = Math.abs(den) < 1e-9 ? (L * Math.cos(Math.PI * k * L)) / Math.cos(Math.PI * k) : Math.sin((omega * L) / 2) / den;
  const rotation = complexFromPolar(real, -omega * (n0 + (L - 1) / 2));
  return { ...rotation, mag: Math.abs(real), phase: Math.atan2(rotation.im, rotation.re) };
}

export function spectrumValue(family, p, f) {
  if (family === 'dt') return dirichletValue(p.L, p.n0, f);
  const shiftPhase = -TAU * f * p.t0;
  let value; // complex value of the unshifted spectrum
  if (family === 'rect') value = { re: p.T * sinc(f * p.T), im: 0 };
  else if (family === 'tri') value = { re: (p.T / 2) * sinc((f * p.T) / 2) ** 2, im: 0 };
  else if (family === 'gauss') value = { re: p.sigma * Math.sqrt(TAU) * Math.exp(-2 * Math.PI ** 2 * p.sigma ** 2 * f * f), im: 0 };
  else if (family === 'exp') {
    const w = TAU * f;
    const den = p.alpha * p.alpha + w * w;
    value = { re: p.alpha / den, im: -w / den };
  } else throw new RangeError('지원하지 않는 신호입니다.');
  const rotation = complexFromPolar(1, shiftPhase);
  const re = value.re * rotation.re - value.im * rotation.im;
  const im = value.re * rotation.im + value.im * rotation.re;
  return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
}

const PHASE_FLOOR = 0.02;

// A phase jump larger than pi between neighbours is a wrap through +-pi: break the polyline there instead of
// drawing a vertical line across the whole plot.
function breakWraps(points) {
  const out = [];
  for (const point of points) {
    const previous = out.at(-1);
    if (previous && previous[1] !== null && point[1] !== null && Math.abs(point[1] - previous[1]) > Math.PI) out.push([(previous[0] + point[0]) / 2, null]);
    out.push(point);
  }
  return out;
}

export function spectrumCurves(family, p, count = 600) {
  const { peak } = transformMetrics(family, p);
  const range = family === 'dt' ? DT_OMEGA_RANGE : FREQ_RANGE;
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

export const timeCurve = (family, p, count = 600) => sampleCurve((t) => timeSignal(family, p, t), TIME_RANGE.lo, TIME_RANGE.hi, count, timeEdges(family, p));

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
const SINC_HALF = bisect((u) => sinc(u) - 0.5, 0, 1);
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
  const value = computeMetrics(family, p);
  memo = { key, value };
  return value;
}

function computeMetrics(family, p) {
  let peak;
  let timeSpan;
  let freqWidth;
  if (family === 'dt') {
    peak = p.L;
    timeSpan = [p.n0 - 0.5, p.n0 + p.L - 0.5];
    freqWidth = 2 * dirichletHalfWidth(p.L);
  } else if (family === 'rect') {
    peak = p.T;
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
  } else if (family === 'gauss') {
    peak = p.sigma * Math.sqrt(TAU);
    const half = p.sigma * Math.sqrt(2 * Math.LN2);
    timeSpan = [p.t0 - half, p.t0 + half];
    freqWidth = Math.sqrt(2 * Math.LN2) / (Math.PI * p.sigma);
  } else throw new RangeError('지원하지 않는 신호입니다.');
  return {
    timeWidth: timeSpan[1] - timeSpan[0],
    freqWidth,
    timeSpan,
    freqSpan: [-freqWidth / 2, freqWidth / 2],
    peak,
    unit: family === 'dt' ? 'rad/sample' : 'Hz',
  };
}

export function describeTransform(family, p) {
  const m = transformMetrics(family, p);
  if (family === 'dt') {
    return `길이 L=${p.L}개 ↔ 반진폭 폭 ${formatQuantity(m.freqWidth, m.unit)} · |X(0)|=${formatNumber(m.peak)}(=표본의 합)`;
  }
  const product = m.timeWidth * m.freqWidth;
  return `시간 폭 ${formatQuantity(m.timeWidth, 's')} ↔ 주파수 폭 ${formatQuantity(m.freqWidth, 'Hz')} · 곱 ${formatNumber(product)} · |X(0)|=${formatNumber(m.peak)}(=면적)`;
}

// ---- lesson description consumed by the controller -------------------------------------------

const FORMULAS = {
  rect: 'X(f)=T sinc(fT) e^(−j2πf t₀); sinc(u)=sin(πu)/(πu)',
  tri: 'X(f)=(T/2) sinc²(fT/2) e^(−j2πf t₀)',
  exp: 'X(f)=e^(−j2πf t₀)/(α+j2πf)',
  gauss: 'X(f)=σ√(2π) e^(−2π²σ²f²) e^(−j2πf t₀)',
  dt: 'X(e^(jΩ))=e^(−jΩ n₀) Σ_{k=0}^{L−1} e^(−jΩk); |X|=|sin(ΩL/2)/sin(Ω/2)|',
};

export const transformLesson = {
  id: 'fourier',
  families: TRANSFORM_FAMILIES,
  initialFamily: 'rect',
  controls: transformControls,
  scrub: false,
  read(family) {
    if (family === 'dt') return 'L을 키우면 시간에서 넓어지고 주 로브는 좁아집니다. DTFT는 2π마다 반복되고, n₀는 위상만 바꿉니다.';
    return '시간에서 좁게 만들수록 주파수에서 넓어지고, 넓게 만들수록 좁아집니다. t₀는 |X|를 그대로 두고 위상만 기울입니다.';
  },
  formula: (family) => `X(f)=∫ x(t) e^(−j2πft) dt; ${FORMULAS[family]}`,
  describe: ({ family, params }) => describeTransform(family, params),
};
