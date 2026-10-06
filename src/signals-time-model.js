// Lesson 1 (pure): y(t) = x(at - b) and the point-to-point map tau -> t = (tau + b) / a.
// Course convention: x(at-b) is taught as x(a(t-b/a)): scale first, then shift by b/a, reversal (a < 0) last.
import { affineSignal } from './signals-course-model.js';
import { formatNumber } from './signals-util.js';
import { choiceControl } from './signals-axis.js';

export const TIME_FAMILIES = [
  { value: 'tri', label: '비대칭 삼각 (연속)' },
  { value: 'rect', label: '직사각 (연속)' },
  { value: 'exp', label: '감쇠 지수 (연속)' },
  { value: 'steps', label: '계단 3단 · x(2t−5) (Ex 1.3a)' },
  { value: 'steps-r', label: '계단 3단 · x(−4t+2) (Ex 1.3b)' },
  { value: 'seq', label: '이산 수열 · x[an−b] (솎아내기·반전)' },
  { value: 'up', label: '이산 업샘플 · x[n/L] (0 삽입)' },
];

// Ex 1.3 signal: 2 on [-1,2), 1 on [2,3), -0.5 on [3,6], 0 elsewhere (the lecture's closed/open ends).
const STEPS = [[-1, 2], [2, 1], [3, -0.5]];
const STEPS_END = 6;
export const isSteps = (family) => family === 'steps' || family === 'steps-r';
export const STAGE_OPTIONS = [{ value: 0, label: '결과만' }, { value: 1, label: '단계 (스케일→이동→반전)' }];

// Asymmetric "shark fin": slow rise, fast fall, so reversal is visible at a glance.
const FIN = [[-1, 0], [1, 1], [1.4, 0]];
export const TIME_SEQUENCE = { start: -1, values: [1, 2, 3, 2.5, 1, -1] };
export const TIME_AXIS = { lo: -5, hi: 5 };
const MIN_SCALE = 0.1;

export const isDiscrete = (family) => family === 'seq' || family === 'up';

// Plot axis and value range of the CT families (the Ex 1.3 signal lives on -1..6, so its axis is wider).
export const timeAxisOf = (family) => (isSteps(family) ? { lo: -3, hi: 8 } : TIME_AXIS);
export const valueRangeOf = (family) => (isSteps(family) ? [-1.2, 2.7] : [-0.3, 1.45]);

export function baseSignal(family, u) {
  if (family === 'tri') {
    for (let i = 0; i < FIN.length - 1; i++) {
      const [x0, y0] = FIN[i];
      const [x1, y1] = FIN[i + 1];
      if (u >= x0 && u <= x1) return y0 + ((y1 - y0) * (u - x0)) / (x1 - x0);
    }
    return 0;
  }
  if (family === 'rect' || family === 'exp') return affineSignal(family, u, 1, 0);
  if (isSteps(family)) {
    if (u < STEPS[0][0] || u > STEPS_END) return 0;
    let value = 0;
    for (const [from, v] of STEPS) if (u >= from) value = v;
    return value;
  }
  throw new RangeError('연속 시간 신호족이 아닙니다.');
}

export function baseEdges(family) {
  if (family === 'tri') return FIN.map(([x]) => x);
  if (family === 'rect') return [0, 1];
  if (family === 'exp') return [0];
  if (isSteps(family)) return [...STEPS.map(([x]) => x), STEPS_END];
  return [];
}

// Support of x(tau) the marker may travel on: [min, max].
export function markerDomain(family) {
  if (family === 'tri') return { min: -1, max: 1.4, step: 0.02 };
  if (family === 'rect') return { min: 0, max: 1, step: 0.02 };
  if (family === 'exp') return { min: 0, max: 3, step: 0.03 };
  if (isSteps(family)) return { min: -1, max: STEPS_END, step: 0.05 };
  const { start, values } = TIME_SEQUENCE;
  return { min: start, max: start + values.length - 1, step: 1 };
}

// CT marker exactly on a jump of x(t) whose value the lecture leaves undefined (the step family is defined by its intervals).
export function isJumpMarker(family, tau) {
  if (isDiscrete(family) || isSteps(family)) return false;
  return baseEdges(family).some((edge) => Math.abs(edge - tau) < 1e-9 && Math.abs(baseSignal(family, edge - 1e-7) - baseSignal(family, edge + 1e-7)) > 1e-3);
}

export const defaultMarker = (family) => ({ tri: 0.4, rect: 0.3, exp: 0.5, steps: 0.5, 'steps-r': 0.5, seq: 1, up: 1 })[family];

// a=0 is not a valid scale: clamp to +-MIN_SCALE (CT) or 1 (DT).
export function normalizeScale(a, discrete) {
  if (discrete) {
    const n = Math.round(a);
    return n === 0 ? 1 : n;
  }
  if (Math.abs(a) >= MIN_SCALE) return a;
  return a < 0 ? -MIN_SCALE : MIN_SCALE;
}

// Slider values -> the values the plot really uses, plus a note when a (nearly) zero scale had to be moved.
// The controller writes the normalized values back into the slider state so the thumb jumps to what is drawn.
export function normalizeTimeParams(family, params) {
  if (family === 'up') {
    const L = Math.max(1, Math.round(params.L ?? 2));
    return { params: { ...params, L, b: Math.round(params.b ?? 0) }, note: '' };
  }
  const discrete = isDiscrete(family);
  const a = normalizeScale(params.a, discrete);
  const b = discrete ? Math.round(params.b) : params.b;
  const zero = discrete ? Math.round(params.a) === 0 : Math.abs(params.a) < MIN_SCALE;
  const note = zero ? `${params.a === 0 ? 'a=0' : 'a≈0'}은 정의되지 않음 → a=${formatNumber(a)}로 보정` : '';
  return { params: { ...params, a, b }, note };
}

export const timeImage = (tau, a, b) => (tau + b) / a;
export const transformedSignal = (family, a, b, t) => baseSignal(family, a * t - b);

// The (a, b) of y = x(a t - b) a state draws. The DT upsample y[n] = x[(n-b)/L] is the same map with a = 1/L, b -> b/L.
export function timeMap(family, params) {
  if (family === 'up') {
    const { L, b } = normalizeTimeParams(family, params).params;
    return { a: 1 / L, b: b / L, L, shift: b };
  }
  const { a, b } = normalizeTimeParams(family, params).params;
  return { a, b };
}

// Intermediate signals of x(a t - b) = x(a (t - b/a)): scale |a| first, then shift by b/|a|, then (a < 0) reverse last.
export function stageSignals(family, a, b) {
  const s = Math.abs(a);
  return {
    scaled: (t) => baseSignal(family, s * t),
    shifted: (t) => baseSignal(family, s * t - b),
    shiftBy: b / s,
    final: (t) => baseSignal(family, a * t - b),
  };
}

// Edge positions of y(t) in the t axis: a*t-b = edge.
export const transformedEdges = (family, a, b) => baseEdges(family).map((edge) => (edge + b) / a);

// Samples x[k] that survive y[n] = x[a n - b]: n = (k + b) / a must be an integer.
export function sequenceTransform(x, start, a, b) {
  const integers = [start, a, b].every(Number.isSafeInteger);
  if (!Array.isArray(x) || !x.length || x.length > 64 || !x.every(Number.isFinite) || !integers || !a) {
    throw new RangeError('이산 시간축에는 정수 인덱스와 0이 아닌 정수 배율이 필요합니다.');
  }
  return x
    .map((value, i) => ({ k: start + i, n: (start + i + b) / a + 0, value })) // + 0 turns -0 into 0
    .filter((point) => Number.isInteger(point.n))
    .sort((p, q) => p.n - q.n);
}

// Upsample: y[n] = x[(n-b)/L] where (n-b) is a multiple of L, otherwise 0 (zeros are inserted).
export function sequenceUpsample(x, start, L, b) {
  if (!Array.isArray(x) || !x.length || !Number.isSafeInteger(L) || L < 1 || !Number.isSafeInteger(b) || !Number.isSafeInteger(start)) {
    throw new RangeError('업샘플에는 정수 L≥1과 정수 이동이 필요합니다.');
  }
  const points = [];
  const lastN = L * (start + x.length - 1) + b;
  for (let n = L * start + b; n <= lastN; n++) {
    const q = n - b;
    points.push({ n, value: q % L === 0 ? x[q / L - start] : 0, inserted: q % L !== 0 });
  }
  return points;
}

// x(a t - b) written the textbook way and as the grouped form x(a(t - b/a)).
export function affineText(a, b, v = 't') {
  const coef = a === 1 ? '' : a === -1 ? '−' : formatNumber(a);
  const offset = b === 0 ? '' : b > 0 ? `−${formatNumber(b)}` : `+${formatNumber(-b)}`;
  if (b === 0) return { plain: `x(${coef}${v})`, grouped: `x(${coef}${v})` };
  const group = `${v}${b / a > 0 ? '−' : '+'}${formatNumber(Math.abs(b / a))}`;
  return { plain: `x(${coef}${v}${offset})`, grouped: `x(${coef}(${group}))` };
}

// Live sentence for the readout under the plot.
export function describeTimeMap({ family, a, b, tau, L }) {
  if (family === 'up') {
    return `k=${tau} → n=L k+b=${L * tau + b} · 표본 사이에 0을 ${L - 1}개씩 삽입 (폭 ×${L})`;
  }
  const discrete = isDiscrete(family);
  const image = timeImage(tau, a, b);
  const parts = [];
  parts.push(a < 0 ? '좌우 반전' : '방향 유지');
  if (Math.abs(a) !== 1) parts.push(Math.abs(a) > 1 ? `폭 ×1/${formatNumber(Math.abs(a))} 압축` : `폭 ×${formatNumber(1 / Math.abs(a))} 확대`);
  if (b !== 0) parts.push(`${formatNumber(Math.abs(b / a))}만큼 ${b / a > 0 ? '오른쪽' : '왼쪽'}`);
  if (discrete && !Number.isInteger(image)) {
    return `k=${tau} → n=${formatNumber(image)} 정수가 아니므로 이 표본은 사라집니다. (${parts.join(' · ')})`;
  }
  const symbol = discrete ? ['k', 'n'] : ['τ', 't'];
  return `${symbol[0]}=${formatNumber(tau)} → ${symbol[1]}=(${symbol[0]}+b)/a=${formatNumber(image)} · ${parts.join(' · ')}`;
}

// ---- lesson description consumed by the controller -------------------------------------------

export const timeLesson = {
  id: 'time',
  families: TIME_FAMILIES,
  initialFamily: 'tri',
  controls(family) {
    if (family === 'up') {
      return [
        { key: 'L', label: 'L 업샘플 배수', min: 1, max: 4, step: 1, initial: 2, unit: '', integer: true },
        { key: 'b', label: 'b 이동 (n)', min: -4, max: 4, step: 1, initial: 0, unit: '', integer: true },
      ];
    }
    const discrete = isDiscrete(family);
    const step = discrete ? 1 : 0.05;
    const initial = family === 'steps' ? { a: 2, b: 5 } : family === 'steps-r' ? { a: -4, b: -2 } : { a: 2, b: 1 };
    const list = [
      { key: 'a', label: 'a 배율', min: -4, max: 4, step, initial: initial.a, unit: '' },
      { key: 'b', label: 'b 이동', min: -5, max: 5, step, initial: initial.b, unit: '' },
    ];
    if (!discrete) list.push(choiceControl('stage', '변환 순서', STAGE_OPTIONS, 0));
    return list;
  },
  cursor(family) {
    const domain = markerDomain(family);
    return { ...domain, initial: defaultMarker(family), symbol: isDiscrete(family) ? 'k' : 'τ', discrete: isDiscrete(family) };
  },
  scrub: false,
  normalize: normalizeTimeParams,
  describe: ({ family, params, cursor }) => {
    const discrete = isDiscrete(family);
    const map = timeMap(family, params);
    const text = describeTimeMap({ family, a: map.a, b: map.shift ?? map.b, L: map.L, tau: discrete ? Math.round(cursor) : cursor });
    return isJumpMarker(family, cursor) ? `${text} · 점프 위치라 x(τ)는 미정의 — 좌·우 극한만 있습니다` : text;
  },
  read(family, params = {}) {
    if (family === 'up') return 'g[n]=x[n/L]: L의 배수 자리에만 x가 놓이고 나머지 n에는 0이 들어갑니다. 정수 L, b만 허용합니다.';
    if (family === 'seq') return '정수 a, b만 허용합니다. n=(k+b)/a가 정수인 표본만 y[n]에 남고 |a|>1이면 일부를 건너뜁니다.';
    const { a, b } = normalizeTimeParams(family, { a: 2, b: 1, ...params }).params;
    const text = affineText(a, b);
    const order = a < 0 ? '스케일→이동→반전' : '스케일→이동';
    const circles = isSteps(family) ? '채운 원은 구간 식이 값을 정한 끝, 열린 원은 그 반대쪽 극한입니다.' : '점프의 열린 원은 CT에서 u(0)처럼 그 점의 값을 정하지 않는다는 뜻입니다.';
    return `${text.plain} = ${text.grouped} (${order}). ${circles}`;
  },
  formula(family, { a = 2, b = 1 } = {}) {
    if (family === 'up') return 'g[n]=x[n/L], n=Lk; g[n]=0, n≠Lk; y[n]=g[n−b]';
    const [v, w] = isDiscrete(family) ? ['n', 'k'] : ['t', 'τ'];
    const [open, close] = isDiscrete(family) ? ['[', ']'] : ['(', ')'];
    return [
      `y${open}${v}${close}=x${open}a ${v}−b${close}=x${open}a(${v}−b/a)${close}`,
      `${w}=a ${v}−b; ${v}=(${w}+b)/a`,
    ].join('; ');
  },
};
