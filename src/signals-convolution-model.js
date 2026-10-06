// Lesson 2 (pure): convolution families, the three panes' curves at a given t, and DT frames.
import { rectangleConvolution, exponentialConvolution, discreteConvolution } from './signals-course-model.js';
import { customConvolutionAt, windowSignal } from './signals-expression.js';
import { controlDefaults, formatNumber, midpointRect, sampleCurve } from './signals-util.js';

export const CONVOLUTION_FAMILIES = [
  { value: 'rect-rect', label: '직사각 ∗ 직사각' },
  { value: 'exp-rect', label: '지수 ∗ 직사각' },
  { value: 'tri-rect', label: '삼각 ∗ 직사각' },
  { value: 'exp-exp', label: '지수 ∗ 지수' },
  { value: 'dt-basic', label: '이산 [1,2,1] ∗ [1,1]' },
  { value: 'dt-diff', label: '이산 차분 [1,−1]' },
  { value: 'dt-avg', label: '이산 3점 평균' },
  { value: 'custom', label: '직접 입력 · 연속식 (고급)' },
  { value: 'custom-dt', label: '직접 입력 · 이산수열 (고급)' },
];

export const DT_PRESETS = {
  'dt-basic': { x: [1, 2, 1], h: [1, 1], xStart: 0, hStart: 0 },
  'dt-diff': { x: [1, 2, 1], h: [1, -1], xStart: 0, hStart: 0 },
  'dt-avg': { x: [1, 3, 2, 4, 2, 1], h: [1 / 3, 1 / 3, 1 / 3], xStart: 0, hStart: 0 },
};

export const isDiscreteFamily = (family) => family.startsWith('dt-') || family === 'custom-dt';
export const isCustomFamily = (family) => family === 'custom' || family === 'custom-dt';

// ---- continuous building blocks (value at a jump = midpoint, as in the rest of the course)
const rect = (t, T) => midpointRect(t, 0, T);
const triangle = (t, T) => (t <= 0 || t >= T ? 0 : t <= T / 2 ? (2 * t) / T : 2 * (1 - t / T));
const expRight = (t, a) => (t < 0 ? 0 : t === 0 ? 0.5 : Math.exp(-a * t));

// Integral of the triangle (base T, peak 1) from 0 to s.
export function triangleCumulative(s, T) {
  if (s <= 0) return 0;
  if (s <= T / 2) return (s * s) / T;
  if (s <= T) return T / 2 - ((T - s) * (T - s)) / T;
  return T / 2;
}

// Exact y for exp(-a t)u(t) * rect(0..T2).
export function expRectConvolution(t, a, T2) {
  if (t <= 0) return 0;
  return (Math.exp(-a * Math.max(0, t - T2)) - Math.exp(-a * t)) / a;
}

function convolutionControls(family) {
  const width = (key, label, initial) => ({ key, label, min: 0.25, max: 4, step: 0.05, initial, unit: 's' });
  const decay = (key, label, initial) => ({ key, label, min: 0.25, max: 4, step: 0.05, initial, unit: '1/s' });
  if (family === 'rect-rect') return [width('T1', 'T₁ x 폭', 2), width('T2', 'T₂ h 폭', 1)];
  if (family === 'tri-rect') return [width('T1', 'T₁ x 폭', 2), width('T2', 'T₂ h 폭', 1)];
  if (family === 'exp-rect') return [decay('alpha', 'α x 감쇠', 1), width('T2', 'T₂ h 폭', 1)];
  if (family === 'exp-exp') return [decay('alpha', 'α x 감쇠', 1), decay('beta', 'β h 감쇠', 2)];
  return [];
}

function continuousSetup(family, p) {
  let x;
  let h;
  let y;
  let xEdges;
  let hEdges;
  let end;
  if (family === 'rect-rect') {
    x = (t) => rect(t, p.T1);
    h = (t) => rect(t, p.T2);
    y = (t) => rectangleConvolution(t, p.T1, p.T2).y;
    xEdges = [0, p.T1];
    hEdges = [0, p.T2];
    end = p.T1 + p.T2;
  } else if (family === 'tri-rect') {
    x = (t) => triangle(t, p.T1);
    h = (t) => rect(t, p.T2);
    y = (t) => triangleCumulative(t, p.T1) - triangleCumulative(t - p.T2, p.T1);
    xEdges = [0, p.T1 / 2, p.T1];
    hEdges = [0, p.T2];
    end = p.T1 + p.T2;
  } else if (family === 'exp-rect') {
    x = (t) => expRight(t, p.alpha);
    h = (t) => rect(t, p.T2);
    y = (t) => expRectConvolution(t, p.alpha, p.T2);
    xEdges = [0];
    hEdges = [0, p.T2];
    end = p.T2 + 5 / p.alpha;
  } else {
    x = (t) => expRight(t, p.alpha);
    h = (t) => expRight(t, p.beta);
    y = (t) => exponentialConvolution(t, p.alpha, p.beta);
    xEdges = [0];
    hEdges = [0];
    end = 8 / Math.min(p.alpha, p.beta);
  }
  const cursor0 = family === 'exp-exp' ? 1 / Math.min(p.alpha, p.beta) : family === 'exp-rect' ? p.T2 : Math.min(p.T1, p.T2);
  return {
    discrete: false,
    family,
    x,
    h,
    y,
    xEdges,
    hEdges,
    domain: { min: -0.1 * end, max: 1.1 * end, step: end / 200, unit: 's' },
    axis: { lo: -0.2 * end, hi: 1.2 * end },
    cursor0,
  };
}

function customContinuousSetup(prepared) {
  const T = prepared.T;
  const clampT = (t) => Math.max(-2 * T, Math.min(2 * T, t));
  return {
    discrete: false,
    family: 'custom',
    custom: prepared,
    x: (t) => windowSignal(prepared.xAst, t, T),
    h: (t) => windowSignal(prepared.hAst, t, T),
    y: (t) => customConvolutionAt(prepared, clampT(t)),
    curve: prepared.output,
    xEdges: [],
    hEdges: [],
    domain: { min: -2 * T, max: 2 * T, step: prepared.dt, unit: 's' },
    axis: { lo: -2 * T, hi: 2 * T },
    cursor0: 0,
  };
}

function discreteSetup(family, spec) {
  const output = discreteConvolution(spec.x, spec.h, spec.xStart, spec.hStart);
  const domain = { min: output.start - 1, max: output.start + output.values.length, step: 1, unit: 'n' };
  const lo = Math.min(spec.xStart, domain.min - spec.hStart - spec.h.length + 1, domain.min) - 1;
  const hi = Math.max(spec.xStart + spec.x.length - 1, domain.max - spec.hStart, domain.max) + 1;
  return { discrete: true, family, ...spec, output, domain, axis: { lo, hi }, cursor0: output.start + 1 };
}

// `custom`: prepared continuous input (signals-expression) or a validated DT spec {x,h,xStart,hStart}.
export function convolutionSetup(family, params = {}, custom = null) {
  if (family === 'custom') return customContinuousSetup(custom);
  if (family === 'custom-dt') return discreteSetup(family, custom);
  if (DT_PRESETS[family]) return discreteSetup(family, DT_PRESETS[family]);
  return continuousSetup(family, { ...controlDefaults(convolutionControls(family)), ...params });
}

// Single-entry memo: the controller and the view ask for the same setup every frame.
let memo = { key: null, custom: undefined, setup: null };
export function cachedSetup(family, params, custom = null) {
  const key = family + '|' + JSON.stringify(params);
  if (memo.key === key && memo.custom === custom) return memo.setup;
  const setup = convolutionSetup(family, params, custom);
  memo = { key, custom, setup };
  return setup;
}

// Output samples over the cursor domain (the faint full curve in the last pane).
export function outputCurve(setup, count = 301) {
  if (setup.discrete) return setup.output.values.map((value, i) => [setup.output.start + i, value]);
  if (setup.curve) return setup.curve;
  const kinks = [0, ...setup.xEdges, ...setup.hEdges];
  return sampleCurve(setup.y, setup.domain.min, setup.domain.max, count, kinks);
}

// Curves of the CT panes at cursor t, over the shared axis.
export function continuousFrame(setup, t, count = 400) {
  const { lo, hi } = setup.axis;
  const movedEdges = setup.hEdges.map((edge) => t - edge);
  return {
    // h(t - tau): the flipped, shifted impulse response
    moving: sampleCurve((tau) => setup.h(t - tau), lo, hi, count, movedEdges),
    // h(-tau): where the flipped copy starts (t = 0)
    flipped: sampleCurve((tau) => setup.h(-tau), lo, hi, count, setup.hEdges.map((edge) => -edge)),
    product: sampleCurve((tau) => setup.x(tau) * setup.h(t - tau), lo, hi, count, [...setup.xEdges, ...movedEdges]),
    y: setup.y(t),
  };
}

// DT terms x[k] h[n-k] at observation n.
export function convolutionFrame(x, h, xStart, hStart, n) {
  const output = discreteConvolution(x, h, xStart, hStart);
  if (!Number.isSafeInteger(n)) throw new RangeError('관측 n은 정수입니다.');
  const terms = x.map((value, i) => {
    const k = xStart + i;
    const j = n - k - hStart;
    const shifted = j >= 0 && j < h.length ? h[j] : 0;
    return { k, x: value, h: shifted, product: value * shifted };
  });
  return { terms, sum: terms.reduce((sum, p) => sum + p.product, 0), output };
}

// The flipped copy h[n-k] as (index, value) pairs.
export const flippedImpulse = (h, hStart, n) => h.map((value, j) => [n - hStart - j, value]);

export function describeConvolution(setup, t) {
  if (setup.discrete) {
    const n = Math.round(t);
    const frame = convolutionFrame(setup.x, setup.h, setup.xStart, setup.hStart, n);
    const used = frame.terms.filter((term) => term.product !== 0).map((term) => formatNumber(term.product));
    return `n=${n}: ${used.length ? used.join(' + ') : '0'} = y[${n}] = ${formatNumber(frame.sum)}`;
  }
  return `t=${formatNumber(t)} s: 겹친 곱의 면적 y(t)=${formatNumber(setup.y(t))}`;
}

// ---- lesson description consumed by the controller -------------------------------------------

const FORMULAS = {
  'rect-rect': 'y(t)=max(0, min(T₁,t)−max(0,t−T₂))',
  'tri-rect': 'y(t)=F(t)−F(t−T₂); F(s)=∫₀ˢ x(τ)dτ',
  'exp-rect': 'y(t)=[e^(−α max(0,t−T₂))−e^(−αt)]/α, t>0',
  'exp-exp': 'y(t)=[e^(−αt)−e^(−βt)]/(β−α)·u(t), α≠β',
};

export const convolutionLesson = {
  id: 'convolution',
  families: CONVOLUTION_FAMILIES,
  initialFamily: 'rect-rect',
  controls: convolutionControls,
  scrub: true,
  // The scrubber range follows the setup; `extra.custom` holds prepared advanced input.
  cursor(family, params, extra) {
    if (isCustomFamily(family) && !extra?.custom) return null;
    const setup = cachedSetup(family, params, extra?.custom ?? null);
    return { ...setup.domain, initial: setup.cursor0, discrete: setup.discrete, symbol: setup.discrete ? 'n' : 't' };
  },
  describe({ family, params, cursor, extra }) {
    if (isCustomFamily(family) && !extra?.custom) return '';
    return describeConvolution(cachedSetup(family, params, extra?.custom ?? null), cursor);
  },
  read(family) {
    if (family === 'custom') return '입력한 식의 유한창 근사입니다. x와 h는 ±T 창 밖에서 0, 적분은 중점 합입니다.';
    if (family === 'custom-dt') return '직접 입력한 유한 수열의 합성곱입니다. 지지 밖 표본은 0입니다.';
    if (isDiscreteFamily(family)) return 'h를 뒤집어 n만큼 옮긴 뒤 겹친 표본끼리 곱해 더한 값이 y[n]입니다.';
    return 'h(t−τ)가 x(τ) 위를 지나가며, 곱의 면적이 아래 y(t)의 높이가 됩니다. 겹침이 없으면 0입니다.';
  },
  formula(family) {
    if (isDiscreteFamily(family)) return 'y[n]=Σₖ x[k] h[n−k]';
    return `y(t)=∫ x(τ) h(t−τ) dτ${FORMULAS[family] ? `; ${FORMULAS[family]}` : ''}`;
  },
};
