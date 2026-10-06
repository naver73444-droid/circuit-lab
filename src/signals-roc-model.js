// Lesson 5 (pure): poles, region of convergence (ROC), stability and causality for Laplace (s) and Z.
// One pole (real, or a conjugate pair when Im > 0) with a right- or left-sided signal, or two real
// poles with a two-sided signal x = right-sided(p1) + left-sided(p2).
import { clamp, controlDefaults, formatNumber, sampleCurve } from './signals-util.js';

export const ROC_FAMILIES = [
  { value: 's-right', label: 'Laplace · 우측 신호 (인과)' },
  { value: 's-left', label: 'Laplace · 좌측 신호' },
  { value: 's-two', label: 'Laplace · 양측 신호' },
  { value: 'z-right', label: 'Z · 우측 신호 (인과)' },
  { value: 'z-left', label: 'Z · 좌측 신호' },
  { value: 'z-two', label: 'Z · 양측 신호' },
];

export const PLANE_RANGE = { s: 3.5, z: 2 };
export const PREVIEW = { ct: { lo: -4, hi: 4 }, dt: { lo: -8, hi: 8 }, clip: 3 };
const MIN_RADIUS = 0.05;

const domainOf = (family) => family.split('-')[0];
const sideOf = (family) => family.split('-')[1];
export const isZ = (family) => family.startsWith('z');
export const isTwoSided = (family) => family.endsWith('-two');

export function rocControls(family) {
  const z = isZ(family);
  const limit = z ? 1.8 : 3;
  const unit = z ? '' : '1/s';
  const side = sideOf(family);
  if (side === 'two') {
    return [
      { key: 'p1', label: z ? 'a₁ 우측 극점' : 'p₁ 우측 극점', min: -limit, max: limit, step: 0.05, initial: z ? 0.5 : -1, unit },
      { key: 'p2', label: z ? 'a₂ 좌측 극점' : 'p₂ 좌측 극점', min: -limit, max: limit, step: 0.05, initial: z ? 1.5 : 1, unit },
    ];
  }
  const re = side === 'right' ? (z ? 0.6 : -1) : z ? 1.5 : 1;
  return [
    { key: 're', label: z ? 'Re 극점 실수부' : 'σ 극점 실수부', min: -limit, max: limit, step: 0.05, initial: re, unit },
    { key: 'im', label: z ? 'Im 극점 허수부' : 'ω 극점 허수부', min: 0, max: limit, step: 0.05, initial: 0, unit: z ? '' : 'rad/s' },
  ];
}

// A drag on the plane moves one pole. One-pole families: any point, snapped to the real axis near it
// (conjugate partner implied). Two-pole families: real axis only; handle 0 -> p1, handle 1 -> p2.
export function dragPole(family, params, handle, point, { snap = 0.15 } = {}) {
  const controls = rocControls(family);
  const limit = (value, c) => clamp(value, c.min, c.max);
  const quantize = (value, c) => Math.round(value / c.step) * c.step;
  if (isTwoSided(family)) {
    const control = controls[handle === 1 ? 1 : 0];
    return { ...params, [control.key]: Number(limit(quantize(point.re, control), control).toFixed(3)) };
  }
  const [reControl, imControl] = controls;
  const im = Math.abs(point.im) < snap ? 0 : limit(quantize(Math.abs(point.im), imControl), imControl);
  return { ...params, re: Number(limit(quantize(point.re, reControl), reControl).toFixed(3)), im: Number(im.toFixed(3)) };
}

const poleRadius = (re, im) => Math.hypot(re, im);

// A left-sided z signal -a^n u[-n-1] with a = 0 does not exist: a real pole is nudged to +-MIN_RADIUS, the same
// radius the ROC uses (a conjugate pair keeps its real part: its radius |p| = Im already exceeds MIN_RADIUS).
const effectivePole = (z, side, re, im = 0) => (z && side !== 'right' && im === 0 ? Math.max(MIN_RADIUS, Math.abs(re)) * Math.sign(re || 1) : re);

export function rocModel(family, params) {
  const domain = domainOf(family);
  const side = sideOf(family);
  const z = domain === 'z';
  const poles = [];
  const zeros = [];
  const movable = [];
  let lo = -Infinity;
  let hi = Infinity;
  if (side === 'two') {
    const a = params.p1;
    const b = effectivePole(z, 'two', params.p2);
    poles.push({ re: a, im: 0, handle: 0 }, { re: b, im: 0, handle: 1 });
    zeros.push({ re: (a + b) / 2, im: 0 });
    if (z) zeros.push({ re: 0, im: 0 });
    lo = z ? Math.abs(a) : a;
    hi = z ? Math.abs(b) : b;
    movable.push(0, 1);
  } else {
    const re = params.re;
    const im = params.im;
    poles.push({ re, im, handle: 0 });
    if (im > 0) poles.push({ re, im: -im, handle: 0 });
    if (z) zeros.push({ re: 0, im: 0 });
    if (im > 0) zeros.push({ re, im: 0 });
    const bound = z ? Math.max(side === 'left' ? MIN_RADIUS : 0, poleRadius(re, im)) : re;
    if (side === 'right') lo = bound;
    else hi = bound;
    movable.push(0);
  }
  const empty = !(lo < hi);
  const criterion = z ? 1 : 0; // unit circle radius or the jw axis (Re s = 0)
  const stable = !empty && criterion > lo && criterion < hi;
  const causal = side === 'right';
  const kind = empty ? 'empty' : side === 'right' ? 'outside' : side === 'left' ? 'inside' : 'band';
  return {
    domain, side, z, poles, zeros, movable, roc: { kind, lo, hi }, empty, stable, causal,
    inequality: inequality({ z, lo, hi, empty, side }),
    transform: transformText(family, params),
  };
}

function inequality({ z, lo, hi, empty, side }) {
  if (empty) return 'ROC 없음 (변환이 어디서도 수렴하지 않음)';
  const v = z ? '|z|' : 'Re{s}';
  const n = formatNumber;
  if (side === 'right') return `${v} > ${n(lo)}`;
  if (side === 'left') return `${v} < ${n(hi)}`;
  return `${n(lo)} < ${v} < ${n(hi)}`;
}

// Terms of the printed transforms are built from pieces that omit zero coefficients and keep parentheses
// only around compound factors: "s", "s+1", "(s+1)²", never "(s)" or "z(z)".
const signed = (value) => (value < 0 ? `+${formatNumber(-value)}` : value === 0 ? '' : `−${formatNumber(value)}`);
const factor = (v, pole) => `${v}${signed(pole)}`; // v - pole
const linearTerm = (c) => (c === 0 ? '' : `${c < 0 ? '−' : '+'}${Math.abs(c) === 1 ? '' : formatNumber(Math.abs(c))}z`);
const grouped = (text) => (text.length === 1 ? text : `(${text})`);

// Algebraic X(s) / X(z) of the chosen signal (a left-sided signal -e^(pt)u(-t) has the same expression).
function transformText(family, p) {
  const z = isZ(family);
  const side = sideOf(family);
  const v = z ? 'z' : 's';
  const unit = z ? 'z' : '1';
  const single = (pole) => `${unit}/${grouped(factor(v, pole))}`;
  if (side === 'two') return `X(${v})=${single(p.p1)}+${single(effectivePole(z, side, p.p2))}`;
  if (p.im > 0) {
    const mid = grouped(factor(v, p.re));
    if (!z) return `X(s)=2${mid}/(${mid}²+${formatNumber(p.im * p.im)})`;
    const numerator = p.re === 0 ? '2z²' : `2z${mid}`;
    return `X(z)=${numerator}/(z²${linearTerm(-2 * p.re)}+${formatNumber(p.re * p.re + p.im * p.im)})`;
  }
  const pole = effectivePole(z, side, p.re);
  return `X(${v})=${single(pole)}${z && pole === 0 ? '=1' : ''}`;
}

// Time-domain preview of x(t) (CT, u(0)=1/2) or x[n] (DT).
export function previewSignal(family, params) {
  const side = sideOf(family);
  const z = isZ(family);
  if (side === 'two') {
    const a = params.p1;
    const b = effectivePole(z, side, params.p2);
    if (z) return (n) => (n >= 0 ? a ** n : -(b ** n));
    const rightPart = (t) => (t > 0 ? Math.exp(a * t) : t === 0 ? 0.5 : 0);
    const leftPart = (t) => (t < 0 ? Math.exp(b * t) : t === 0 ? 0.5 : 0);
    return (t) => rightPart(t) - leftPart(t);
  }
  const sign = side === 'left' ? -1 : 1;
  const { im } = params;
  const re = effectivePole(z, side, params.re, im);
  if (z) {
    const r = Math.hypot(re, im);
    const theta = Math.atan2(im, re);
    const inSupport = side === 'right' ? (n) => n >= 0 : (n) => n < 0;
    return (n) => (inSupport(n) ? sign * (im > 0 ? 2 * r ** n * Math.cos(theta * n) : re ** n) : 0);
  }
  return (t) => {
    const weight = t === 0 ? 0.5 : (side === 'right' ? t > 0 : t < 0) ? 1 : 0;
    return sign * weight * (im > 0 ? 2 * Math.exp(re * t) * Math.cos(im * t) : Math.exp(re * t)) + 0; // +0 turns -0 into 0
  };
}

export function previewCurve(family, params, count = 480) {
  const fn = previewSignal(family, params);
  const { lo, hi } = isZ(family) ? PREVIEW.dt : PREVIEW.ct;
  if (isZ(family)) {
    const points = [];
    for (let n = lo; n <= hi; n++) points.push([n, fn(n)]);
    return points;
  }
  return sampleCurve(fn, lo, hi, count, [0]);
}

export function describeRoc(model, family) {
  const v = model.z ? '단위원' : 'jω축';
  const stability = model.empty
    ? 'ROC가 없어 안정성을 정할 수 없음'
    : model.stable ? `${v} ⊂ ROC → 안정` : `${v} ⊄ ROC → 불안정`;
  const causality = model.causal ? '인과 (우측 신호)' : sideOf(family) === 'left' ? '비인과 (좌측 신호)' : '비인과 (양측 신호)';
  return `ROC: ${model.inequality} · ${stability} · ${causality}`;
}

// ---- lesson description consumed by the controller -------------------------------------------

const PAIRS = {
  's-right': 'e^(pt)u(t) ↔ 1/(s−p), Re{s} > Re{p}',
  's-left': '−e^(pt)u(−t) ↔ 1/(s−p), Re{s} < Re{p}',
  's-two': 'e^(p₁t)u(t)−e^(p₂t)u(−t) ↔ 1/(s−p₁)+1/(s−p₂), p₁ < Re{s} < p₂',
  'z-right': 'aⁿu[n] ↔ z/(z−a), |z| > |a|',
  'z-left': '−aⁿu[−n−1] ↔ z/(z−a), |z| < |a|',
  'z-two': 'a₁ⁿu[n]−a₂ⁿu[−n−1] ↔ z/(z−a₁)+z/(z−a₂), |a₁| < |z| < |a₂|',
};

export const rocLesson = {
  id: 'roc',
  families: ROC_FAMILIES,
  initialFamily: 's-right',
  controls: rocControls,
  scrub: false,
  read(family) {
    const z = isZ(family);
    const axis = z ? '단위원' : 'jω축';
    const side = sideOf(family);
    if (side === 'two') return 'ROC는 두 극점 사이의 띠(고리)입니다. 극점 순서가 뒤바뀌면 ROC가 사라지고 변환이 존재하지 않습니다.';
    const where = side === 'right' ? '바깥쪽' : '안쪽';
    return `극점을 끌어 보세요. ROC는 극점에서 ${where}이고, ${axis}이 ROC에 들어오면 안정입니다. 같은 식도 ROC에 따라 다른 신호입니다.`;
  },
  formula: (family) => `${isZ(family) ? 'X(z)=Σₙ x[n] z^(−n)' : 'X(s)=∫ x(t) e^(−st) dt'}; ${PAIRS[family]}`,
  describe: ({ family, params }) => describeRoc(rocModel(family, params), family),
};
