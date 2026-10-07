import { midpointRect } from './signals-util.js';

// Pure textbook-style numerics for the signals lessons (no DOM, no expression evaluation).
// These are supported families, not a general symbolic algebra engine.

// Order follows the course: Ch 1 signals (weeks 2-3), Ch 2 CT systems (3-5), Ch 4 Fourier (5-6). `later` lessons are ahead of the
// material covered so far and stay as reference.
export const SIGNALS_LESSONS = [
  { id: 'time', tab: '시간축', title: '시간축 변환 x(at−b)' },
  { id: 'ops', tab: '신호 연산', title: '신호 연산 · 진폭 · 합곱 · 짝홀 · 에너지/전력' },
  { id: 'lti', tab: 'LTI 응답', title: 'LTI 시스템 응답 · h=ds/dt · 인과/안정' },
  { id: 'convolution', tab: '컨볼루션', title: 'LTI 컨볼루션' },
  { id: 'series', tab: '푸리에 급수', title: '푸리에 급수 · 회전 페이저' },
  { id: 'fourier', tab: '푸리에 변환', title: '푸리에 변환 · 시간 ↔ 주파수' },
  { id: 'freq', tab: '주파수 응답', title: '주파수 응답 H(ω) · 정상상태 응답' },
  { id: 'roc', tab: 'Laplace / Z (참고)', short: 'Laplace / Z', title: '극점과 수렴영역(ROC) · 이후 진도(참고)', later: true },
  { id: 'sampling', tab: '표본화 (참고)', short: '표본화', title: '표본화와 aliasing · 이후 진도(참고)', later: true },
];

// The tab row: the lessons of the course, then ONE tab "참고 ▾" that stands for the `later` lessons (picked with a select inside the lesson).
// Lesson ids, states and the registry are unchanged; only the way they are reached differs.
export const SIGNALS_REFERENCE = { id: 'reference', tab: '참고 ▾', title: '이후 진도(참고): Laplace / Z, 표본화', lessons: SIGNALS_LESSONS.filter((l) => l.later).map((l) => l.id) };
export const SIGNALS_TABS = [...SIGNALS_LESSONS.filter((l) => !l.later).map((l) => ({ id: l.id, tab: l.tab, title: l.title })), { id: SIGNALS_REFERENCE.id, tab: SIGNALS_REFERENCE.tab, title: SIGNALS_REFERENCE.title, group: true }];

// ---------------------------------------------------------------- input parsing

export function parseSignalsNumber(text, { min = -1e6, max = 1e6, integer = false } = {}) {
  const t = String(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) throw new RangeError('유한한 숫자를 입력하세요.');
  const n = Number(t);
  const underflow = n === 0 && /[1-9]/.test(t.split(/e/i)[0]);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isSafeInteger(n)) || underflow) {
    throw new RangeError('숫자가 지원 범위를 벗어났습니다.');
  }
  return n;
}

export function parseSignalsSequence(text) {
  const parts = String(text).trim().split(',');
  if (parts.length > 64 || !String(text).trim()) throw new RangeError('쉼표로 구분한 1~64개 표본을 입력하세요.');
  return parts.map((part) => parseSignalsNumber(part, { min: -1000, max: 1000 }));
}

// ---------------------------------------------------------------- convolution

export function rectangleConvolution(t, T1, T2, A = 1, B = 1) {
  for (const n of [t, T1, T2, A, B]) {
    if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new RangeError('유한한 지원값이 필요합니다.');
  }
  if (T1 <= 0 || T2 <= 0) throw new RangeError('폭은 양수입니다.');
  const lower = Math.max(0, t - T2);
  const upper = Math.min(T1, t);
  const width = Math.max(0, upper - lower);
  return { lower, upper, width, y: A * B * width };
}

export function exponentialConvolution(t, a, b) {
  for (const n of [t, a, b]) {
    if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new RangeError('지원값 범위를 확인하세요.');
  }
  if (a <= 0 || b <= 0) throw new RangeError('감쇠율은 양수입니다.');
  if (t < 0) return 0;
  const d = Math.abs(b - a);
  const m = Math.min(a, b);
  return d === 0 ? t * Math.exp(-a * t) : (Math.exp(-m * t) * -Math.expm1(-d * t)) / d;
}

export function discreteConvolution(x, h, xStart = 0, hStart = 0) {
  const finite = (list) => list.every((n) => Number.isFinite(n) && Math.abs(n) <= 1000);
  const validList = (list) => Array.isArray(list) && list.length > 0 && list.length <= 64;
  const validIndex = (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1000;
  if (!validList(x) || !validList(h) || !finite([...x, ...h]) || !validIndex(xStart) || !validIndex(hStart)) {
    throw new RangeError('유한 수열과 정수 시작 인덱스가 필요합니다.');
  }
  const values = Array(x.length + h.length - 1).fill(0);
  for (let i = 0; i < x.length; i++) for (let j = 0; j < h.length; j++) values[i + j] += x[i] * h[j];
  return { start: xStart + hStart, values };
}

// ---------------------------------------------------------------- Fourier

export function pulseSeriesCoefficient(A, D, k) {
  const bad = !Number.isFinite(A) || Math.abs(A) > 1e6 || !Number.isFinite(D) || D <= 0 || D >= 1 || !Number.isSafeInteger(k) || Math.abs(k) > 1000;
  if (bad) throw new RangeError('A,D,k 조건을 확인하세요.');
  return k === 0 ? A * D : (A * Math.sin(Math.PI * k * D)) / (Math.PI * k);
}

// ---------------------------------------------------------------- time axis, sampling

// x(u) of the unit families used by the time-axis lesson: rect on (0, 1) and e^-u u(u), both with u(0) = 1/2.
export function affineSignal(family, t, a, b) {
  const valid = [t, a, b].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e4) && a !== 0 && ['rect', 'exp'].includes(family);
  if (!valid) throw new RangeError('시간 변환 조건을 확인하세요.');
  const u = a * t - b;
  if (family === 'rect') return midpointRect(u, 0, 1, 0);
  return u < 0 ? 0 : u === 0 ? 0.5 : Math.exp(-u);
}

// Alias of a real tone f [Hz] sampled at fs [Hz]: the wrapped frequency in [-fs/2, fs/2).
export function samplingAlias(f, fs) {
  if (!Number.isFinite(f) || !Number.isFinite(fs) || f < 0 || f > 1e6 || fs < 1e-3 || fs > 1e6) {
    throw new RangeError('f₀≥0, 0.001≤fₛ≤10⁶ 조건입니다.');
  }
  const wrapped = ((((f + fs / 2) % fs) + fs) % fs) - fs / 2;
  const status = f < fs / 2 ? 'alias-free' : f === fs / 2 ? 'nyquist-boundary' : 'aliased';
  return {
    signedHz: wrapped,
    aliasHz: Math.abs(wrapped),
    omega: (2 * Math.PI * wrapped) / fs,
    phaseSign: wrapped < 0 ? -1 : 1,
    status,
  };
}
