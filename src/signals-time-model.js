// Lesson 1 (pure): y(t) = x(at - b) and the point-to-point map tau -> t = (tau + b) / a.
import { affineSignal } from './signals-course-model.js';
import { formatNumber } from './signals-util.js';

export const TIME_FAMILIES = [
  { value: 'tri', label: '비대칭 삼각 (연속)' },
  { value: 'rect', label: '직사각 (연속)' },
  { value: 'exp', label: '감쇠 지수 (연속)' },
  { value: 'seq', label: '이산 수열 x[k]' },
];

// Asymmetric "shark fin": slow rise, fast fall, so reversal is visible at a glance.
const FIN = [[-1, 0], [1, 1], [1.4, 0]];
export const TIME_SEQUENCE = { start: -1, values: [1, 2, 3, 2.5, 1, -1] };
export const TIME_AXIS = { lo: -5, hi: 5 };
const MIN_SCALE = 0.1;

export const isDiscrete = (family) => family === 'seq';

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
  throw new RangeError('연속 시간 신호족이 아닙니다.');
}

export function baseEdges(family) {
  if (family === 'tri') return FIN.map(([x]) => x);
  if (family === 'rect') return [0, 1];
  if (family === 'exp') return [0];
  return [];
}

// Support of x(tau) the marker may travel on: [min, max].
export function markerDomain(family) {
  if (family === 'tri') return { min: -1, max: 1.4, step: 0.02 };
  if (family === 'rect') return { min: 0, max: 1, step: 0.02 };
  if (family === 'exp') return { min: 0, max: 3, step: 0.03 };
  const { start, values } = TIME_SEQUENCE;
  return { min: start, max: start + values.length - 1, step: 1 };
}

export const defaultMarker = (family) => ({ tri: 0.4, rect: 0.3, exp: 0.5, seq: 1 })[family];

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
  const discrete = isDiscrete(family);
  const a = normalizeScale(params.a, discrete);
  const b = discrete ? Math.round(params.b) : params.b;
  const zero = discrete ? Math.round(params.a) === 0 : Math.abs(params.a) < MIN_SCALE;
  const note = zero ? `${params.a === 0 ? 'a=0' : 'a≈0'}은 정의되지 않음 → a=${formatNumber(a)}로 보정` : '';
  return { params: { ...params, a, b }, note };
}

export const timeImage = (tau, a, b) => (tau + b) / a;
export const transformedSignal = (family, a, b, t) => baseSignal(family, a * t - b);

// Edge positions of y(t) in the t axis: a*t-b = edge.
export const transformedEdges = (family, a, b) => baseEdges(family).map((edge) => (edge + b) / a);

// Samples x[k] that survive y[n] = x[a n - b]: n = (k + b) / a must be an integer.
export function sequenceTransform(x, start, a, b) {
  const integers = [start, a, b].every(Number.isSafeInteger);
  if (!Array.isArray(x) || !x.length || x.length > 64 || !x.every(Number.isFinite) || !integers || !a) {
    throw new RangeError('이산 시간축에는 정수 인덱스와 0이 아닌 정수 배율이 필요합니다.');
  }
  return x
    .map((value, i) => ({ k: start + i, n: (start + i + b) / a, value }))
    .filter((point) => Number.isInteger(point.n))
    .sort((p, q) => p.n - q.n);
}

// Live sentence for the readout under the plot.
export function describeTimeMap({ family, a, b, tau }) {
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
    const discrete = isDiscrete(family);
    const step = discrete ? 1 : 0.05;
    return [
      { key: 'a', label: 'a 배율', min: -3, max: 3, step, initial: 2, unit: '' },
      { key: 'b', label: 'b 이동', min: -3, max: 3, step, initial: 1, unit: '' },
    ];
  },
  cursor(family) {
    const domain = markerDomain(family);
    return { ...domain, initial: defaultMarker(family), symbol: isDiscrete(family) ? 'k' : 'τ', discrete: isDiscrete(family) };
  },
  scrub: false,
  normalize: normalizeTimeParams,
  describe: ({ family, params, cursor }) => {
    const discrete = isDiscrete(family);
    const { a, b } = normalizeTimeParams(family, params).params;
    return describeTimeMap({ family, a, b, tau: discrete ? Math.round(cursor) : cursor });
  },
  read(family) {
    return isDiscrete(family)
      ? '정수 a, b만 허용합니다. n=(k+b)/a가 정수인 표본만 y[n]에 남고 |a|>1이면 일부 표본을 건너뜁니다.'
      : '점 하나를 끌어 보세요. a<0이면 좌우로 뒤집히고, |a|가 클수록 압축되며, b/a만큼 평행이동합니다.';
  },
  formula(family, { a = 2, b = 1 } = {}) {
    const [v, w] = isDiscrete(family) ? ['n', 'k'] : ['t', 'τ'];
    const [open, close] = isDiscrete(family) ? ['[', ']'] : ['(', ')'];
    return [
      `y${open}${v}${close}=x${open}a ${v}−b${close}=x${open}a(${v}−b/a)${close}`,
      `${w}=a ${v}−b; ${v}=(${w}+b)/a`,
    ].join('; ');
  },
};
