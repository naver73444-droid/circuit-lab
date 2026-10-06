// Lesson "LTI 시스템 응답" (pure): Ch 2 time-domain responses of CT systems.
//  step: RC unit-step response s(t) and h(t)=ds/dt (Ex 2.8, 2.18)   natural: series RLC natural response (Ex 2.14, 2.15)
//  forced: first-order response to A cos(wt) = transient + steady state (Ex 2.16)   bibo: causality and BIBO stability from h(t)
//  test: linearity / time-invariance test (expected vs actual output, Ex 2.1, 2.2)
// Impulse-response examples 2.20-2.22 live in the convolution lesson (same definitions).
import { formatNumber, sampleCurve, jumpList } from './signals-util.js';
import { choiceControl } from './signals-axis.js';

export const LTI_FAMILIES = [
  { value: 'step', label: 'RC 계단응답과 h=ds/dt (Ex 2.8)' },
  { value: 'nat-a', label: 'RLC 자연응답 · 실근 (Ex 2.14)' },
  { value: 'nat-b', label: 'RLC 자연응답 · 복소근 (Ex 2.15a)' },
  { value: 'nat-c', label: 'RLC 자연응답 · 중근 (Ex 2.15b)' },
  { value: 'forced', label: 'RC 정현파 입력 · 과도+정상 (Ex 2.16)' },
  { value: 'bibo', label: '인과성·BIBO · e^(−a(t−d))u(t−d)' },
  { value: 'bibo-osc', label: '인과성·BIBO · e^(−σt) sin(5t) u(t)' },
  { value: 'test', label: '선형성·시불변성 시험 (Ex 2.1, 2.2)' },
];

const num = (v) => formatNumber(v, 4);
const pts = (fn, lo, hi, n = 500, edges = []) => sampleCurve(fn, lo, hi, n, edges, { gaps: true });
const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- step response: first order, tau = RC
export const stepResponse = (tau, t) => (t > 0 ? 1 - Math.exp(-t / tau) : 0);
export const rcImpulse = (tau, t) => (t > 0 ? Math.exp(-t / tau) / tau : 0);
export const stepWindow = (tau) => {
  const hi = Math.max(1.5, 6 * tau);
  return { lo: -hi / 6, hi };
};

// ---------------------------------------------------------------- series RLC natural response (L = 1 H)
// y'' + R y' + (1/C) y = 0, y = capacitor voltage, y(0) = y0, y'(0) = i(0)/C.
export const RLC_PRESETS = {
  'nat-a': { Cinv: 6, y0: 1.5, i0: 2, R: 5 },
  'nat-b': { Cinv: 26, y0: 2, i0: 0.5, R: 2 },
  'nat-c': { Cinv: 9, y0: 2, i0: 0.5, R: 6 },
};
export const criticalR = (Cinv) => 2 * Math.sqrt(Cinv);

export function rlcNatural({ R, Cinv, y0, i0 }) {
  const y1 = i0 * Cinv; // dy/dt at 0 = i(0)/C
  const disc = R * R - 4 * Cinv;
  const eps = 1e-9;
  if (disc > eps) {
    const r = Math.sqrt(disc);
    const [s1, s2] = [(-R + r) / 2, (-R - r) / 2];
    const c1 = (y1 - s2 * y0) / (s1 - s2);
    const c2 = y0 - c1;
    return { kind: 'over', roots: [[s1, 0], [s2, 0]], y1, coeffs: [c1, c2], y: (t) => c1 * Math.exp(s1 * t) + c2 * Math.exp(s2 * t), modes: [s1, s2] };
  }
  if (disc >= -eps) {
    const s = -R / 2;
    const c12 = y1 - s * y0;
    return { kind: 'critical', roots: [[s, 0], [s, 0]], y1, coeffs: [y0, c12], y: (t) => (y0 + c12 * t) * Math.exp(s * t), modes: [s] };
  }
  const sigma = -R / 2;
  const w = Math.sqrt(-disc) / 2;
  const d2 = (y1 - sigma * y0) / w;
  return {
    kind: 'under', roots: [[sigma, w], [sigma, -w]], y1, coeffs: [y0, d2], sigma, omega: w,
    y: (t) => Math.exp(sigma * t) * (y0 * Math.cos(w * t) + d2 * Math.sin(w * t)), modes: [], envelope: Math.hypot(y0, d2),
  };
}

// Root locus of s^2 + R s + Cinv = 0 for R in [0, Rmax]: branches as point lists (re, im).
export function rootLocus(Cinv, Rmax = 14, n = 140) {
  const rc = criticalR(Cinv);
  const upper = []; const lower = []; const real1 = []; const real2 = [];
  for (let i = 0; i <= n; i++) {
    const R = (Rmax * i) / n;
    const disc = R * R - 4 * Cinv;
    if (disc < 0) { upper.push([-R / 2, Math.sqrt(-disc) / 2]); lower.push([-R / 2, -Math.sqrt(-disc) / 2]); } else {
      real1.push([(-R + Math.sqrt(disc)) / 2, 0]); real2.push([(-R - Math.sqrt(disc)) / 2, 0]);
    }
  }
  return { upper, lower, real1, real2, rc };
}

// ---------------------------------------------------------------- first order forced response: y' + a y = A cos(w t)
export const FORCED_A = 20;
export function forcedResponse({ a, omega, y0 }, A = FORCED_A) {
  const k1 = (a * A) / (a * a + omega * omega);
  const k2 = (A * omega) / (a * a + omega * omega);
  const c = y0 - k1;
  return {
    k1, k2, c,
    transient: (t) => c * Math.exp(-a * t),
    steady: (t) => k1 * Math.cos(omega * t) + k2 * Math.sin(omega * t),
    total: (t) => c * Math.exp(-a * t) + k1 * Math.cos(omega * t) + k2 * Math.sin(omega * t),
    amplitude: Math.hypot(k1, k2),
  };
}

// ---------------------------------------------------------------- causality / BIBO
// h(t) = e^{-a (t-d)} u(t-d)
export const hExp = (a, d) => (t) => (t >= d ? Math.exp(-a * (t - d)) : 0);
export const hOsc = (sigma) => (t) => (t > 0 ? Math.exp(-sigma * t) * Math.sin(5 * t) : 0);
// integral of |h| over the whole line (Infinity when it diverges)
export function absIntegral(family, p) {
  if (family === 'bibo') return p.a > 1e-12 ? 1 / p.a : Infinity;
  if (p.sigma <= 1e-12) return Infinity;
  const w = 5;
  return (w / (p.sigma * p.sigma + w * w)) / Math.tanh((Math.PI * p.sigma) / (2 * w));
}
// running integral of |h| from -inf to t
export function absIntegralTo(family, p, t) {
  if (family === 'bibo') {
    if (t <= p.d) return 0;
    const u = t - p.d;
    if (Math.abs(p.a) < 1e-12) return u;
    return p.a > 0 ? (1 - Math.exp(-p.a * u)) / p.a : (Math.exp(-p.a * u) - 1) / -p.a;
  }
  if (t <= 0) return 0;
  const n = Math.max(200, Math.ceil(t * 60));
  const dt = t / n;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(hOsc(p.sigma)((i + 0.5) * dt)) * dt;
  return sum;
}
export const isCausalH = (family, p) => (family === 'bibo' ? p.d >= 0 : true);

// ---------------------------------------------------------------- linearity / time-invariance test
export const TEST_SYSTEMS = [
  { label: 'y=5x(t)', f: (x) => 5 * x },
  { label: 'y=5x(t)+3', f: (x) => 5 * x + 3 },
  { label: 'y=3x²(t)', f: (x) => 3 * x * x },
  { label: 'y=cos(x(t))', f: (x) => Math.cos(x) },
  { label: 'y=3cos(t)·x(t)', f: (x, t) => 3 * Math.cos(t) * x },
];
export const TEST_OPTIONS = TEST_SYSTEMS.map((s, i) => ({ value: i, label: s.label }));
const X1 = (t) => Math.cos(TAU * 5 * t);
const X2 = (t) => Math.exp(-0.5 * t);
const XU = (t) => (t >= 0 ? Math.exp(-0.5 * t) : 0);

export function linearityTest(index, a1, a2, t) {
  const sys = TEST_SYSTEMS[index].f;
  const x = a1 * X1(t) + a2 * X2(t);
  const expected = a1 * sys(X1(t), t) + a2 * sys(X2(t), t);
  const actual = sys(x, t);
  return { x, expected, actual };
}
export function timeInvarianceTest(index, T, t) {
  const sys = TEST_SYSTEMS[index].f;
  const delayedInput = sys(XU(t - T), t); // Sys{x(t-T)}
  const delayedOutput = sys(XU(t - T), t - T); // y(t-T) with the system evaluated at t-T
  return { response: delayedInput, shifted: delayedOutput };
}
export function testErrors(index, a1, a2, T) {
  let lin = 0;
  let ti = 0;
  for (let i = 0; i <= 600; i++) {
    const t = (3 * i) / 600;
    const l = linearityTest(index, a1, a2, t);
    lin = Math.max(lin, Math.abs(l.expected - l.actual));
    const s = timeInvarianceTest(index, T, t + 0);
    ti = Math.max(ti, Math.abs(s.response - s.shifted));
  }
  return { linear: lin < 1e-9, timeInvariant: ti < 1e-9, linearError: lin, timeError: ti };
}

// ---------------------------------------------------------------- frames
const padRange = (values, pad = 0.15) => {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = Math.max(hi - lo, 1e-9);
  return [lo - span * pad, hi + span * pad];
};

function stepFrame({ tau }, cursor) {
  const { lo, hi } = stepWindow(tau);
  const s = (t) => stepResponse(tau, t);
  const h = (t) => rcImpulse(tau, t);
  const t0 = Math.min(Math.max(cursor, 0), hi);
  const slope = h(t0);
  const span = Math.min(hi - t0, tau * 1.6);
  return {
    panes: [
      { title: `s(t)=(1−e^(−t/τ))u(t), τ=RC=${num(tau)} s`, x: [lo, hi], y: [-0.2, 1.3], yTicks: [0, 0.632, 1], xTicks: [0, tau, 2 * tau, 3 * tau].filter((v) => v < hi),
        lines: [{ cls: 'c1', pts: pts(s, lo, hi, 600, [0]) }], hlines: [{ cls: 'cm dash', y: 1 }],
        segments: [{ cls: 'c4', x1: t0 - span * 0.01, y1: s(t0) - slope * span * 0.01, x2: t0 + span, y2: s(t0) + slope * span }],
        dots: [{ cls: 'c4', x: t0, y: s(t0) }, { cls: 'c3', x: tau, y: 1 - Math.exp(-1) }],
        texts: [{ cls: 'c3', x: tau, y: 1 - Math.exp(-1), text: `t=τ: 0.632`, anchor: 'start', dy: 16 }] },
      { title: 'h(t)=ds/dt = (1/τ)e^(−t/τ) u(t)  (기울기 = h)', x: [lo, hi], y: [-0.12 / tau, 1.25 / tau], yTicks: [0, Number((1 / tau).toPrecision(3))],
        lines: [{ cls: 'c2', pts: pts(h, lo, hi, 600, [0]) }], jumps: [{ cls: 'c2', list: jumpList(h, [0], lo, hi) }],
        dots: [{ cls: 'c4', x: t0, y: h(t0) }], vlines: [{ cls: 'c4 dash', x: t0 }] },
    ],
    legend: [{ cls: 'c1', text: 's(t) 계단응답' }, { cls: 'c4', text: `접선: 기울기 ${num(slope)} = h(t)` }, { cls: 'c2', text: 'h(t) 임펄스응답' }],
  };
}

function naturalFrame(family, p) {
  const sol = rlcNatural({ ...RLC_PRESETS[family], R: p.R, y0: p.y0 });
  const hi = sol.kind === 'under' ? Math.min(8, Math.max(3, 4.6 / Math.max(-sol.sigma, 0.3))) : Math.min(8, Math.max(3, 5 / Math.max(Math.min(...sol.modes.map(Math.abs)), 0.3)));
  const samples = Array.from({ length: 60 }, (_, i) => sol.y((hi * i) / 59));
  const [yl, yh] = padRange(samples);
  const lines = [{ cls: 'c1', pts: sampleCurve(sol.y, 0, hi, 700) }];
  if (sol.kind === 'over') {
    sol.modes.forEach((s, i) => lines.push({ cls: i ? 'c5 dash' : 'c2 dash', pts: sampleCurve((t) => sol.coeffs[i] * Math.exp(s * t), 0, hi, 300) }));
  }
  if (sol.kind === 'under') {
    lines.push({ cls: 'cm dash', pts: sampleCurve((t) => sol.envelope * Math.exp(sol.sigma * t), 0, hi, 200) });
    lines.push({ cls: 'cm dash', pts: sampleCurve((t) => -sol.envelope * Math.exp(sol.sigma * t), 0, hi, 200) });
  }
  const locus = rootLocus(RLC_PRESETS[family].Cinv);
  const reMin = -14.8;
  const imMax = Math.max(6, Math.sqrt(RLC_PRESETS[family].Cinv) * 1.2);
  const dots = sol.roots.map(([re, im], i) => ({ cls: i ? 'c5' : 'c4', x: re, y: im }));
  return {
    panes: [
      { title: `y_h(t) — 자연응답 (입력 0, 초기값 y(0)=${num(p.y0)}, i(0)=${num(RLC_PRESETS[family].i0)})`, x: [0, hi], y: [yl, yh], lines,
        texts: [] },
      { title: 's 평면 — 특성근의 자취 (R: 0→14), × 현재 근', x: [reMin, 1.5], y: [-imMax, imMax], h: 150, xTicks: [-14, -10, -6, -2, 0], yTicks: [0],
        lines: [{ cls: 'cm', pts: locus.upper }, { cls: 'cm', pts: locus.lower }, { cls: 'cm', pts: locus.real1 }, { cls: 'cm', pts: locus.real2 }],
        vlines: [{ cls: 'cm dash', x: 0 }], dots },
    ],
    legend: [{ cls: 'c1', text: 'y_h(t)' }, ...(sol.kind === 'over' ? [{ cls: 'c2 dash', text: '모드 c₁e^(s₁t)' }, { cls: 'c5 dash', text: '모드 c₂e^(s₂t)' }] : []),
      ...(sol.kind === 'under' ? [{ cls: 'cm dash', text: '지수 포락선 ±|c|e^(σt)' }] : []), { cls: 'c4 mk', text: '특성근 (s 평면)' }],
  };
}

function forcedFrame(p) {
  const f = forcedResponse(p);
  const hi = 3;
  const sets = [f.total, f.transient, f.steady];
  const ranges = sets.map((fn) => padRange(Array.from({ length: 80 }, (_, i) => fn((hi * i) / 79))));
  const yAll = [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
  return {
    panes: [
      { title: `(a) 과도 y_t(t)=c e^(−at), c=${num(f.c)}`, x: [0, hi], y: ranges[1], lines: [{ cls: 'c5', pts: sampleCurve(f.transient, 0, hi, 300) }] },
      { title: `(b) 정상상태 y_ss(t)=${num(f.k1)}cos ωt+${num(f.k2)}sin ωt, 진폭 ${num(f.amplitude)}`, x: [0, hi], y: ranges[2], lines: [{ cls: 'c1', pts: sampleCurve(f.steady, 0, hi, 800) }] },
      { title: '(c) 전체 응답 y=y_t+y_ss', x: [0, hi], y: yAll, lines: [{ cls: 'c2', pts: sampleCurve(f.total, 0, hi, 800) }, { cls: 'cm dash', pts: sampleCurve(f.steady, 0, hi, 800) }] },
    ],
    legend: [{ cls: 'c5', text: '과도 (사라짐)' }, { cls: 'c1', text: '정상상태 (입력 주파수)' }, { cls: 'c2', text: '합' }],
  };
}

function biboFrame(family, p) {
  const h = family === 'bibo' ? hExp(p.a, p.d) : hOsc(p.sigma);
  const lo = -3;
  const hi = 6;
  const edges = family === 'bibo' ? [p.d] : [0];
  const probe = Array.from({ length: 90 }, (_, i) => h(lo + ((hi - lo) * i) / 89));
  const [yl, yh] = padRange(probe.map((v) => Math.max(-3, Math.min(3, v))));
  const cum = (t) => absIntegralTo(family, p, t);
  const total = absIntegral(family, p);
  const top = Number.isFinite(total) ? total : cum(hi);
  return {
    panes: [
      { title: family === 'bibo' ? `h(t)=e^(−a(t−d))u(t−d), a=${num(p.a)}, d=${num(p.d)} · 음영: t<0` : `h(t)=e^(−σt) sin(5t) u(t), σ=${num(p.sigma)}`,
        x: [lo, hi], y: [yl, yh], yTicks: [0, 1],
        bands: p.d < 0 && family === 'bibo' ? [{ cls: 'c5', from: lo, to: 0 }] : [],
        lines: [{ cls: 'c1', pts: pts(h, lo, hi, 700, edges) }], jumps: [{ cls: 'c1', list: jumpList(h, edges, lo, hi) }] },
      { title: '누적 ∫|h(λ)|dλ — 유한한 값으로 수렴하면 BIBO 안정', x: [lo, hi], y: [-0.05 * top, top * 1.15],
        lines: [{ cls: 'c2', pts: sampleCurve(cum, lo, hi, family === 'bibo' ? 400 : 160, edges) }], hlines: Number.isFinite(total) ? [{ cls: 'c4 dash', y: total }] : [] },
    ],
    legend: [{ cls: 'c1', text: 'h(t)' }, { cls: 'c2', text: '∫|h|' }, { cls: 'c4 dash', text: '극한 (안정일 때)' }, { cls: 'c5 band', text: 't<0 에 남은 응답 (비인과)' }],
  };
}

function testFrame(p) {
  const index = p.sys;
  const hi = 3;
  const lin = (t) => linearityTest(index, p.a1, p.a2, t);
  const ti = (t) => timeInvarianceTest(index, p.T, t);
  const vals = Array.from({ length: 200 }, (_, i) => (hi * i) / 199);
  const rLin = padRange(vals.flatMap((t) => [lin(t).expected, lin(t).actual]));
  const rTi = padRange(vals.flatMap((t) => [ti(t).response, ti(t).shifted]));
  return {
    panes: [
      { title: `선형성: x=α₁cos(2π·5t)+α₂e^(−0.5t) (α₁=${num(p.a1)}, α₂=${num(p.a2)}) · 기대 y_exp=α₁y₁+α₂y₂ vs 실제 y_act`, x: [0, hi], y: rLin,
        lines: [{ cls: 'c1', pts: sampleCurve((t) => lin(t).expected, 0, hi, 900) }, { cls: 'c5 dash', pts: sampleCurve((t) => lin(t).actual, 0, hi, 900) }] },
      { title: `시불변성: 입력 x(t)=e^(−0.5t)u(t)를 T=${num(p.T)} s 지연 · Sys{x(t−T)} vs y(t−T)`, x: [0, hi], y: rTi,
        lines: [{ cls: 'c1', pts: pts((t) => ti(t).shifted, 0, hi, 700, [p.T]) }, { cls: 'c5 dash', pts: pts((t) => ti(t).response, 0, hi, 700, [p.T]) }] },
    ],
    legend: [{ cls: 'c1', text: '기대 / 출력 지연' }, { cls: 'c5 dash', text: '실제 / 지연 입력의 응답' }],
  };
}

export function ltiFrame(family, params, cursor = 0) {
  if (family === 'step') return stepFrame(params, cursor);
  if (family.startsWith('nat-')) return naturalFrame(family, params);
  if (family === 'forced') return forcedFrame(params);
  if (family === 'bibo' || family === 'bibo-osc') return biboFrame(family, params);
  if (family === 'test') return testFrame(params);
  throw new RangeError('지원하지 않는 예시입니다.');
}

// ---------------------------------------------------------------- lesson
const slider = (key, label, min, max, step, initial, unit = '') => ({ key, label, min, max, step, initial, unit });

function ltiControls(family) {
  if (family === 'step') return [slider('tau', 'τ = RC', 0.05, 2, 0.05, 0.25, 's')];
  if (family.startsWith('nat-')) return [slider('R', 'R 저항', 0.2, 14, 0.2, RLC_PRESETS[family].R, 'Ω'), slider('y0', 'y(0) 초기 전압', -3, 3, 0.5, RLC_PRESETS[family].y0, 'V')];
  if (family === 'forced') return [slider('omega', 'ω 입력 각주파수', 1, 20, 1, 8, 'rad/s'), slider('a', 'a=1/RC', 1, 10, 1, 4, '1/s'), slider('y0', 'y(0) 초기값', -5, 10, 1, 5)];
  if (family === 'bibo') return [slider('a', 'a (극점 s=−a)', -1, 3, 0.25, 1), slider('d', 'd 지연(+)/앞섬(−)', -1, 1, 0.25, 0, 's')];
  if (family === 'bibo-osc') return [slider('sigma', 'σ 감쇠', -0.5, 2, 0.25, 1, '1/s')];
  return [
    slider('a1', 'α₁', -3, 3, 0.25, 2), slider('a2', 'α₂', -3, 3, 0.25, 1.25), slider('T', 'T 지연', 0, 3, 0.25, 2, 's'),
    choiceControl('sys', '시스템', TEST_OPTIONS, 1),
  ];
}

const caseText = { over: '과감쇠 (서로 다른 실근)', critical: '임계감쇠 (중근)', under: '부족감쇠 (켤레 복소근)' };

function describeNatural(family, p) {
  const preset = RLC_PRESETS[family];
  const sol = rlcNatural({ ...preset, R: p.R, y0: p.y0 });
  const rc = criticalR(preset.Cinv);
  let roots;
  let form;
  if (sol.kind === 'over') {
    roots = `s=${num(sol.roots[0][0])}, ${num(sol.roots[1][0])}`;
    form = `y=${num(sol.coeffs[0])}e^(${num(sol.roots[0][0])}t)${sol.coeffs[1] < 0 ? '−' : '+'}${num(Math.abs(sol.coeffs[1]))}e^(${num(sol.roots[1][0])}t)`;
  } else if (sol.kind === 'critical') {
    roots = `s=${num(sol.roots[0][0])} (중근)`;
    form = `y=(${num(sol.coeffs[0])}${sol.coeffs[1] < 0 ? '−' : '+'}${num(Math.abs(sol.coeffs[1]))}t)e^(${num(sol.roots[0][0])}t)`;
  } else {
    roots = `s=${num(sol.sigma)}±j${num(sol.omega)}`;
    form = `y=e^(${num(sol.sigma)}t)(${num(sol.coeffs[0])}cos${num(sol.omega)}t${sol.coeffs[1] < 0 ? '−' : '+'}${num(Math.abs(sol.coeffs[1]))}sin${num(sol.omega)}t)`;
  }
  return `R=${num(p.R)} Ω (임계 ${num(rc)} Ω): ${caseText[sol.kind]} · ${roots} · ${form}`;
}

export const ltiLesson = {
  id: 'lti',
  families: LTI_FAMILIES,
  initialFamily: 'step',
  controls: ltiControls,
  scrub: false,
  cursor(family, params) {
    if (family !== 'step') return null;
    const { hi } = stepWindow(params.tau ?? 0.25);
    return { min: 0, max: hi, step: hi / 150, initial: (params.tau ?? 0.25) * 0.5, unit: 's', symbol: 't', discrete: false };
  },
  describe({ family, params, cursor }) {
    if (family === 'step') {
      const t = cursor;
      return `τ=RC=${num(params.tau)} s · t=${num(t)}: s=${num(stepResponse(params.tau, t))}, h=ds/dt=${num(rcImpulse(params.tau, t))} · s(τ)=0.632, h(0⁺)=1/τ=${num(1 / params.tau)}`;
    }
    if (family.startsWith('nat-')) return describeNatural(family, params);
    if (family === 'forced') {
      const f = forcedResponse(params);
      return `y=${num(f.c)}e^(−${num(params.a)}t)+${num(f.k1)}cos(${num(params.omega)}t)+${num(f.k2)}sin(${num(params.omega)}t) · 정상상태 진폭 ${num(f.amplitude)}`;
    }
    if (family === 'bibo' || family === 'bibo-osc') {
      const total = absIntegral(family, params);
      const causal = isCausalH(family, params);
      return `${causal ? '인과 (t<0에서 h=0)' : '비인과 (t<0에도 h≠0)'} · ${Number.isFinite(total) ? `∫|h|=${num(total)} 유한 → BIBO 안정` : '∫|h| 발산 → BIBO 불안정'}`;
    }
    const e = testErrors(params.sys, params.a1, params.a2, params.T);
    return `${TEST_SYSTEMS[params.sys].label}: 선형성 ${e.linear ? '통과' : `실패 (최대 차 ${num(e.linearError)})`} · 시불변성 ${e.timeInvariant ? '통과' : `실패 (최대 차 ${num(e.timeError)})`}`;
  },
  read(family) {
    if (family === 'step') return '선형·시불변이므로 계단응답을 미분하면 임펄스응답입니다: h=ds/dt. 접선의 기울기가 그 시각의 h(t)이고 t=τ에서 63.2%입니다.';
    if (family.startsWith('nat-')) return 'R을 키우면 특성근이 켤레 복소 → 중근 → 두 실근으로 갈라집니다. 입력은 0이고 초기 전압·전류가 응답을 만듭니다.';
    if (family === 'forced') return '강제응답은 과도(초기값이 정함, 사라짐)와 정상상태(입력 주파수 성분)의 합입니다. 초기 조건은 둘을 더한 뒤에 적용합니다.';
    if (family === 'test') return '선형성은 기대 출력과 실제 출력이 겹치는지, 시불변성은 입력을 지연한 응답이 출력을 지연한 것과 같은지로 판정합니다.';
    return '인과는 t<0에서 h(t)=0, BIBO 안정은 ∫|h|dt<∞ 입니다. 극점이 왼쪽 반평면(a>0, σ>0)이면 누적이 수렴합니다.';
  },
  formula(family) {
    if (family === 'step') return 's(t)=(1−e^(−t/τ))u(t); h(t)=ds/dt=(1/τ)e^(−t/τ)u(t); τ=RC';
    if (family.startsWith('nat-')) return 'y″+(R/L)y′+y/(LC)=0; s²+(R/L)s+1/(LC)=0; y(0)=y₀; y′(0)=i(0)/C';
    if (family === 'forced') return 'y′+a y=A cos(ωt); y_ss=[aA cos ωt+Aω sin ωt]/(a²+ω²); y=c e^(−at)+y_ss; c=y(0)−y_ss(0)';
    if (family === 'test') return 'Sys{α₁x₁+α₂x₂}=α₁Sys{x₁}+α₂Sys{x₂}; Sys{x(t−T)}=y(t−T)';
    return 'h(t)=0 for t<0 (causal); ∫_{−∞}^{∞}|h(λ)|dλ<∞ (BIBO stable)';
  },
};
