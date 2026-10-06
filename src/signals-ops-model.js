// Lesson "신호 연산" (pure): Ch 1 reinforcement. Amplitude operations, sum / product of two signals, even-odd decomposition,
// energy / power classification, the delta-unit step-ramp chain and DT sinusoid periodicity N = k/F0.
// Every example returns a "frame" (curves, markers, texts) that signals-panes-view draws without knowing the lesson.
import { formatNumber, sampleCurve, jumpList } from './signals-util.js';
import { dtPeriod } from './signals-axis.js';

export const OPS_FAMILIES = [
  { value: 'amp', label: '진폭 연산 g=Bx+A (Ex 1.1)' },
  { value: 'sum', label: '두 신호의 합 x₁+B·x₂ (Ex 1.2)' },
  { value: 'prod', label: '두 신호의 곱 x₁·B·x₂ (Ex 1.2)' },
  { value: 'eo-pulse', label: '짝·홀 분해 Π(t−c) (Ex 1.14)' },
  { value: 'eo-exp', label: '짝·홀 분해 e^(−αt)u(t)' },
  { value: 'en-sin', label: '전력 신호 A sin(2πf₀t+θ) (Ex 1.9)' },
  { value: 'en-exp', label: '에너지/전력 A e^(−αt)u(t) (Ex 1.10)' },
  { value: 'en-train', label: '주기 펄스열 평균·전력 (Ex 1.8)' },
  { value: 'chain', label: 'δ → u → r 적분 사슬 (CT)' },
  { value: 'chain-dt', label: 'δ[n] → u[n] → r[n] 누적합 (DT)' },
  { value: 'dt-pi', label: 'DT 정현파 주기 · Ω₀=mπ' },
  { value: 'dt-rad', label: 'DT 정현파 주기 · Ω₀ [rad]' },
];

const TAU = 2 * Math.PI;
const pts = (fn, lo, hi, n = 600, edges = []) => sampleCurve(fn, lo, hi, n, edges, { gaps: true });
const num = (v) => formatNumber(v, 4);
const range = (values, pad = 0.18) => {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = Math.max(hi - lo, 1e-9);
  return [lo - span * pad * (lo < 0 ? 1 : 0.4), hi + span * pad];
};
const interp = (xs, ys) => (t) => {
  if (t < xs[0] || t > xs.at(-1)) return 0;
  for (let i = 0; i < xs.length - 1; i++) if (t <= xs[i + 1]) return ys[i] + ((ys[i + 1] - ys[i]) * (t - xs[i])) / (xs[i + 1] - xs[i]);
  return 0;
};

// ---------------------------------------------------------------- signal definitions
// Ex 1.1: polyline through (-1,0) (0,0) (1,1) (3,-1) (4,-1) (5,0) (6,0).
export const EX11 = { t: [-1, 0, 1, 3, 4, 5, 6], v: [0, 0, 1, -1, -1, 0, 0] };
export const ex11 = interp(EX11.t, EX11.v);
// Ex 1.2: x1 = 2 on [0,1), 1 on [1,2), -1 on [2,3); x2 through (0,0) (2,1) (3,-1) (4,0).
export const ex12x1 = (t) => (t >= 0 && t < 1 ? 2 : t >= 1 && t < 2 ? 1 : t >= 2 && t < 3 ? -1 : 0);
export const ex12x2 = interp([0, 2, 3, 4], [0, 1, -1, 0]);
const PIECES = [ // [from, to, x1, slope of x2, intercept of x2]
  [0, 1, 2, 0.5, 0], [1, 2, 1, 0.5, 0], [2, 3, -1, -2, 5], [3, 4, 0, 1, -4],
];
export const ampOp = (t, A, B) => B * ex11(t) + A;
export const sumOp = (t, B) => ex12x1(t) + B * ex12x2(t);
export const prodOp = (t, B) => ex12x1(t) * B * ex12x2(t);

const linear = (m, c) => {
  const parts = [];
  if (Math.abs(m) > 1e-12) parts.push(`${Math.abs(m - 1) < 1e-12 ? '' : Math.abs(m + 1) < 1e-12 ? '−' : num(m)}t`);
  if (Math.abs(c) > 1e-12 || !parts.length) parts.push(`${parts.length && c > 0 ? '+' : ''}${num(c)}`);
  return parts.join('').replace(/\+-/g, '−').replace(/-/g, '−');
};
// Piecewise formulas of g = x1 + B x2 (sum) or x1 B x2 (product) on the Ex 1.2 pieces.
export function pieceFormulas(mode, B) {
  return PIECES.map(([from, to, c1, m2, c2]) => {
    const [m, c] = mode === 'sum' ? [B * m2, c1 + B * c2] : [c1 * B * m2, c1 * B * c2];
    return { from, to, text: `[${from},${to}) ${linear(m, c)}` };
  });
}

// Even / odd parts (real signals): x_e = (x(t)+x(-t))/2, x_o = (x(t)-x(-t))/2.
export const evenPart = (fn) => (t) => (fn(t) + fn(-t)) / 2;
export const oddPart = (fn) => (t) => (fn(t) - fn(-t)) / 2;
export const pulseAt = (c, w) => (t) => (Math.abs(t - c) < w / 2 ? 1 : 0);
export const expRight = (alpha) => (t) => (t > 0 ? Math.exp(-alpha * t) : 0);

// Energy and power closed forms (R = 1 ohm normalization).
export function energyPower(family, p) {
  if (family === 'en-sin') return { energy: Infinity, power: (p.A * p.A) / 2, rms: p.A / Math.SQRT2, kind: 'power', mean: 0 };
  if (family === 'en-exp') {
    if (p.alpha > 1e-12) return { energy: (p.A * p.A) / (2 * p.alpha), power: 0, rms: 0, kind: 'energy', mean: 0 };
    return { energy: Infinity, power: (p.A * p.A) / 2, rms: p.A / Math.SQRT2, kind: 'power', mean: p.A / 2 };
  }
  if (family === 'en-train') return { energy: Infinity, power: p.A * p.A * p.d, rms: p.A * Math.sqrt(p.d), kind: 'power', mean: p.A * p.d };
  throw new RangeError('에너지/전력 예시가 아닙니다.');
}

// Running quantity shown in the lower pane: P_T for the periodic ones, E(T) for the exponential.
export function runningPower(family, p, T) {
  if (family === 'en-sin') {
    const w = TAU * p.f0;
    return ((p.A * p.A) / 2) * (1 - (Math.cos(2 * p.theta) * Math.sin(2 * w * T)) / (2 * w * T));
  }
  throw new RangeError('이동 전력은 정현파에만 정의됩니다.');
}
export function runningEnergy(p, T) {
  if (T <= 0) return 0;
  return p.alpha > 1e-12 ? ((p.A * p.A) * (1 - Math.exp(-2 * p.alpha * T))) / (2 * p.alpha) : p.A * p.A * T;
}
// P_T = (1/T) integral_0^T x^2 for the unit-period pulse train (A on (0,d) of every period).
export function trainPower(p, T) {
  if (T <= 0) return 0;
  const whole = Math.floor(T + 1e-12);
  const rest = T - whole;
  return (p.A * p.A * (whole * p.d + Math.min(rest, p.d))) / T;
}

// Chain of the delta approximation q_a (width a, height 1/a): its integrals u_a and r_a, and the ideal limits.
export const deltaApprox = (a) => (t) => (Math.abs(t) < a / 2 ? 1 / a : 0);
export const stepApprox = (a) => (t) => (t <= -a / 2 ? 0 : t >= a / 2 ? 1 : (t + a / 2) / a);
export const rampApprox = (a) => (t) => (t <= -a / 2 ? 0 : t >= a / 2 ? t : ((t + a / 2) ** 2) / (2 * a));
export const idealStep = (t) => (t > 0 ? 1 : 0);
export const idealRamp = (t) => (t > 0 ? t : 0);

// DT chain by definition: delta[n-n0], the running sum u[n] = sum delta, and r[n] = sum_{k<n} u[k] (rows for n in [lo, hi]).
export function dtChain(n0, lo = -6, hi = 8) {
  const rows = [];
  let u = 0;
  let r = 0;
  for (let n = Math.min(lo, n0) - 2; n <= hi; n++) {
    const delta = n === n0 ? 1 : 0;
    const ramp = r; // sum over k < n of u[k]
    u += delta;
    r += u;
    if (n >= lo) rows.push({ n, delta, step: u, ramp });
  }
  return rows;
}

// DT sinusoid x[n] = A cos(Omega0 n + theta). m = Omega0/pi (pi family) or Omega0 in rad.
export function dtSinusoid(family, p) {
  const A = 3;
  const omega = family === 'dt-pi' ? p.m * Math.PI : p.omega;
  const theta = family === 'dt-pi' ? p.theta * Math.PI : 0;
  const F0 = family === 'dt-pi' ? p.m / 2 : p.omega / TAU;
  const period = dtPeriod(F0);
  return { A, omega, theta, F0, ...period, x: (n) => A * Math.cos(omega * n + theta) };
}

// ---------------------------------------------------------------- frames
const jumpsOf = (cls, fn, edges, lo, hi) => ({ cls, list: jumpList(fn, edges, lo, hi) });

function ampFrame({ A, B }) {
  const g = (t) => ampOp(t, A, B);
  const lo = -2;
  const hi = 7;
  const edges = EX11.t;
  const gVals = EX11.v.map((v) => B * v + A);
  const [yl, yh] = range([...EX11.v, ...gVals, A]);
  const ticks = [...new Set([0, A, ...gVals, 1, -1].map((v) => Number(v.toPrecision(3))))];
  return {
    panes: [
      { title: 'x(t) — 꺾은선 (끝점 −1,0,1,3,4,5,6)', x: [lo, hi], y: [yl, yh], yTicks: [-1, 0, 1], lines: [{ cls: 'c1', pts: pts(ex11, lo, hi, 400, edges) }],
        dots: EX11.t.map((t, i) => ({ cls: 'c1', x: t, y: EX11.v[i] })) },
      { title: `g(t)=${num(B)}·x(t)${A < 0 ? '−' : '+'}${num(Math.abs(A))}`, x: [lo, hi], y: [yl, yh], yTicks: ticks,
        lines: [{ cls: 'c2', pts: pts(g, lo, hi, 400, edges) }, { cls: 'cm dash', pts: pts(ex11, lo, hi, 400, edges) }],
        hlines: [{ cls: 'c4 dash', y: A }],
        dots: EX11.t.map((t, i) => ({ cls: 'c2', x: t, y: gVals[i] })),
        texts: [{ cls: 'c4', x: hi - 0.2, y: A, text: `기준선 A=${num(A)}`, anchor: 'end', dy: -5 }] },
    ],
    legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'c2', text: 'g(t)=B x+A' }, { cls: 'cm dash', text: 'x(t) 비교' }, { cls: 'c4 dash', text: '오프셋 기준선' }],
  };
}

function combineFrame(mode, { B }) {
  const g = (t) => (mode === 'sum' ? sumOp(t, B) : prodOp(t, B));
  const x2 = (t) => B * ex12x2(t);
  const lo = -1;
  const hi = 5;
  const e1 = [0, 1, 2, 3];
  const e2 = [0, 2, 3, 4];
  const [yl, yh] = range([2, -1, B, -B, ...[0, 1, 2, 3, 4].map((t) => g(t - 1e-9)), ...[0.5, 1.5, 2.5, 3.5].map(g)]);
  return {
    panes: [
      { title: `x₁(t) 계단 · B·x₂(t) 꺾은선 (B=${num(B)})`, x: [lo, hi], y: [yl, yh], yTicks: [-1, 0, 1, 2],
        lines: [{ cls: 'c1', pts: pts(ex12x1, lo, hi, 500, e1) }, { cls: 'c2', pts: pts(x2, lo, hi, 400, e2) }],
        jumps: [jumpsOf('c1', ex12x1, e1, lo, hi)] },
      { title: mode === 'sum' ? 'g=x₁+B·x₂ (구간마다 따로 더함)' : 'g=x₁·B·x₂ (구간마다 따로 곱함)', x: [lo, hi], y: [yl, yh],
        lines: [{ cls: 'c4', pts: pts(g, lo, hi, 600, [0, 1, 2, 3, 4]) }], jumps: [jumpsOf('c4', g, [0, 1, 2, 3, 4], lo, hi)] },
    ],
    legend: [{ cls: 'c1', text: 'x₁(t)' }, { cls: 'c2', text: 'B·x₂(t)' }, { cls: 'c4', text: mode === 'sum' ? 'g=x₁+Bx₂' : 'g=x₁·Bx₂' }],
  };
}

function evenOddFrame(family, p) {
  const x = family === 'eo-pulse' ? pulseAt(p.c, p.w) : expRight(p.alpha);
  const edges = family === 'eo-pulse' ? [p.c - p.w / 2, p.c + p.w / 2, -(p.c - p.w / 2), -(p.c + p.w / 2)] : [0];
  const xr = (t) => x(-t);
  const xe = evenPart(x);
  const xo = oddPart(x);
  const lo = -4;
  const hi = 4;
  const ticks = [-0.5, 0, 0.5, 1];
  return {
    panes: [
      { title: 'x(t) 와 거울상 x(−t)', x: [lo, hi], y: [-0.7, 1.3], yTicks: ticks,
        lines: [{ cls: 'c1', pts: pts(x, lo, hi, 700, edges) }, { cls: 'cm dash', pts: pts(xr, lo, hi, 700, edges) }],
        jumps: [jumpsOf('c1', x, edges, lo, hi)] },
      { title: 'x_e(t)=[x(t)+x(−t)]/2 (우)  ·  x_o(t)=[x(t)−x(−t)]/2 (기)', x: [lo, hi], y: [-0.7, 1.3], yTicks: ticks,
        lines: [{ cls: 'c2', pts: pts(xe, lo, hi, 700, edges) }, { cls: 'c5 dash', pts: pts(xo, lo, hi, 700, edges) }],
        jumps: [jumpsOf('c2', xe, edges, lo, hi), jumpsOf('c5', xo, edges, lo, hi)] },
    ],
    legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'cm dash', text: 'x(−t)' }, { cls: 'c2', text: 'x_e (우함수)' }, { cls: 'c5 dash', text: 'x_o (기함수)' }],
  };
}

function energyFrame(family, p) {
  const ep = energyPower(family, p);
  if (family === 'en-sin') {
    const w = TAU * p.f0;
    const x = (t) => p.A * Math.sin(w * t + p.theta);
    const lo = -4;
    const hi = 4;
    return {
      panes: [
        { title: 'x(t)=A sin(2πf₀t+θ) · 점선: ±RMS=±A/√2', x: [lo, hi], y: [-p.A * 1.3, p.A * 1.3], yTicks: [-p.A, 0, p.A],
          lines: [{ cls: 'c1', pts: pts(x, lo, hi, 900) }], hlines: [{ cls: 'c4 dash', y: ep.rms }, { cls: 'c4 dash', y: -ep.rms }] },
        { title: '이동 평균 전력 P_T=(1/2T)∫x² dt → A²/2', x: [0, hi], y: [0, p.A * p.A * 1.1], yTicks: [0, Number(ep.power.toPrecision(3))],
          lines: [{ cls: 'c2', pts: sampleCurve((T) => runningPower(family, p, Math.max(T, 1e-6)), 0, hi, 400) }], hlines: [{ cls: 'c4 dash', y: ep.power }] },
      ],
      legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'c4 dash', text: 'RMS · 극한 전력 A²/2' }, { cls: 'c2', text: 'P_T' }],
    };
  }
  if (family === 'en-exp') {
    const x = (t) => (t > 0 ? p.A * Math.exp(-p.alpha * t) : 0);
    const lo = -1;
    const hi = 5;
    const lim = ep.kind === 'energy' ? ep.energy : null;
    const top = Math.max(lim ?? 0, runningEnergy(p, hi), 1) * 1.15;
    return {
      panes: [
        { title: 'x(t)=A e^(−αt) u(t)', x: [lo, hi], y: [-0.15 * p.A, p.A * 1.25], yTicks: [0, Number(p.A.toPrecision(3))],
          lines: [{ cls: 'c1', pts: pts(x, lo, hi, 500, [0]) }], jumps: [jumpsOf('c1', x, [0], lo, hi)] },
        { title: lim === null ? '누적 에너지 E(T)=∫x² dt → ∞ (계속 증가)' : '누적 에너지 E(T)=∫x² dt → A²/(2α)', x: [lo, hi], y: [-0.05 * top, top],
          lines: [{ cls: 'c2', pts: sampleCurve((T) => runningEnergy(p, T), lo, hi, 400, [0]) }],
          hlines: lim === null ? [] : [{ cls: 'c4 dash', y: lim }] },
      ],
      legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'c2', text: 'E(T)' }, { cls: 'c4 dash', text: '극한 에너지' }],
    };
  }
  const x = (t) => (((t % 1) + 1) % 1 < p.d ? p.A : 0);
  const edgesT = [];
  for (let k = -3; k <= 5; k++) edgesT.push(k, k + p.d);
  const lo = -1;
  const hi = 4;
  return {
    panes: [
      { title: `주기 T₀=1 s 펄스열 (A=${num(p.A)}, d=${num(p.d)}) · 점선: 평균 ⟨x⟩=Ad`, x: [lo, hi], y: [-0.15 * p.A, p.A * 1.3], yTicks: [0, Number(p.A.toPrecision(3))],
        lines: [{ cls: 'c1', pts: pts(x, lo, hi, 900, edgesT) }], hlines: [{ cls: 'c4 dash', y: ep.mean }], jumps: [jumpsOf('c1', x, edgesT, lo, hi)] },
      { title: '이동 평균 전력 P_T=(1/T)∫₀ᵀ x² dt → A²d', x: [0, hi], y: [0, p.A * p.A * 1.1], yTicks: [0, Number(ep.power.toPrecision(3))],
        lines: [{ cls: 'c2', pts: sampleCurve((T) => trainPower(p, T), 0.02, hi, 500, [1, 2, 3].flatMap((k) => [k, k + p.d])) }], hlines: [{ cls: 'c4 dash', y: ep.power }] },
    ],
    legend: [{ cls: 'c1', text: 'x(t)' }, { cls: 'c4 dash', text: '평균 · 극한 전력' }, { cls: 'c2', text: 'P_T' }],
  };
}

function chainFrame({ a }) {
  const lo = -1.5;
  const hi = 1.5;
  const q = deltaApprox(a);
  const peak = 1 / a;
  const edges = [-a / 2, a / 2];
  return {
    panes: [
      { title: `q_a(t)=(1/a)Π(t/a): 폭 a=${num(a)}, 높이 ${num(peak)}, 넓이 1  →  a→0 이면 δ(t)`, x: [lo, hi], y: [-0.12 * peak, peak * 1.2],
        yTicks: [0, Number(peak.toPrecision(3))], lines: [{ cls: 'c1', pts: pts(q, lo, hi, 600, edges) }], jumps: [jumpsOf('c1', q, edges, lo, hi)],
        segments: [{ cls: 'cm dash', x1: 0, y1: 0, x2: 0, y2: peak * 1.1 }] },
      { title: 'u_a(t)=∫q_a dλ  →  u(t)  (u(0) 정의 안 함, 열린 원)', x: [lo, hi], y: [-0.2, 1.3], yTicks: [0, 1],
        lines: [{ cls: 'c2', pts: pts(stepApprox(a), lo, hi, 600, edges) }, { cls: 'cm dash', pts: pts(idealStep, lo, hi, 300, [0]) }],
        jumps: [{ cls: 'cm', list: [{ x: 0, left: 0, right: 1 }] }] },
      { title: 'r_a(t)=∫u_a dλ  →  r(t)=t·u(t)', x: [lo, hi], y: [-0.2, 1.7], yTicks: [0, 1],
        lines: [{ cls: 'c5', pts: pts(rampApprox(a), lo, hi, 600, edges) }, { cls: 'cm dash', pts: pts(idealRamp, lo, hi, 300, [0]) }] },
    ],
    legend: [{ cls: 'c1', text: 'q_a (δ 근사)' }, { cls: 'c2', text: 'u_a=∫q_a' }, { cls: 'c5', text: 'r_a=∫u_a' }, { cls: 'cm dash', text: 'a→0 극한 δ, u, r' }],
  };
}

function chainDtFrame({ n0 }) {
  const rows = dtChain(n0, -6, 8);
  const lo = -6.8;
  const hi = 8.8;
  const xs = (key) => rows.map((r) => [r.n, r[key]]);
  const ticks = Array.from({ length: 8 }, (_, i) => -6 + i * 2);
  return {
    panes: [
      { title: `δ[n−${n0}] (n=${n0}에서만 1; DT는 δ[0]=1)`, x: [lo, hi], y: [-0.3, 1.5], xTicks: ticks, yTicks: [0, 1], stems: [{ cls: 'c1', pts: xs('delta') }] },
      { title: 'u[n−n₀]=Σ δ[k−n₀] (n≥n₀에서 1; u[0]=1)  ·  δ=u[n]−u[n−1]', x: [lo, hi], y: [-0.3, 1.5], xTicks: ticks, yTicks: [0, 1], stems: [{ cls: 'c2', pts: xs('step') }] },
      { title: 'r[n−n₀]=Σ_{k<n} u[k−n₀]=(n−n₀)u[n−n₀]', x: [lo, hi], y: [-0.5, 9.5], xTicks: ticks, yTicks: [0, 4, 8], stems: [{ cls: 'c5', pts: xs('ramp') }] },
    ],
    legend: [{ cls: 'c1', text: 'δ[n]' }, { cls: 'c2', text: 'u[n]' }, { cls: 'c5', text: 'r[n]' }],
  };
}

function dtPeriodFrame(family, p) {
  const s = dtSinusoid(family, p);
  const N0 = 0;
  const N1 = 79;
  const stems = [];
  for (let n = N0; n <= N1; n++) stems.push([n, s.x(n)]);
  const env = sampleCurve((t) => s.x(t), N0, N1, 400);
  const marks = [];
  const texts = [];
  if (s.periodic && s.N <= 40) {
    for (let n = 0; n <= N1; n += s.N) marks.push({ cls: 'c4 dash', x: n });
    texts.push({ cls: 'c4', x: s.N / 2, y: s.A * 1.28, text: `N=${s.N}`, anchor: 'middle' });
  }
  return {
    panes: [{
      title: `x[n]=3cos(Ω₀n+θ), Ω₀=${num(s.omega)} rad, F₀=Ω₀/2π=${num(s.F0)}  →  ${s.periodic ? `N=k/F₀=${s.N}` : '비주기'}`,
      x: [N0 - 1, N1 + 1], y: [-s.A * 1.5, s.A * 1.5], xTicks: [0, 10, 20, 30, 40, 50, 60, 70], yTicks: [-3, 0, 3],
      lines: [{ cls: 'cm dash', pts: env }], stems: [{ cls: 'c1', pts: stems }], vlines: marks, texts,
    }],
    legend: [{ cls: 'c1', text: 'x[n] 표본' }, { cls: 'cm dash', text: '같은 식의 연속 코사인' }, { cls: 'c4 dash', text: '기본 주기 N 경계' }],
  };
}

export function opsFrame(family, params) {
  if (family === 'amp') return ampFrame(params);
  if (family === 'sum' || family === 'prod') return combineFrame(family, params);
  if (family === 'eo-pulse' || family === 'eo-exp') return evenOddFrame(family, params);
  if (family.startsWith('en-')) return energyFrame(family, params);
  if (family === 'chain') return chainFrame(params);
  if (family === 'chain-dt') return chainDtFrame(params);
  if (family === 'dt-pi' || family === 'dt-rad') return dtPeriodFrame(family, params);
  throw new RangeError('지원하지 않는 예시입니다.');
}

// ---------------------------------------------------------------- lesson
const slider = (key, label, min, max, step, initial, unit = '') => ({ key, label, min, max, step, initial, unit });

function opsControls(family) {
  if (family === 'amp') return [slider('B', 'B 이득', -3, 3, 0.1, 1.5), slider('A', 'A 오프셋', -3, 3, 0.1, -1)];
  if (family === 'sum' || family === 'prod') return [slider('B', 'B x₂ 이득', -2, 2, 0.1, 1)];
  if (family === 'eo-pulse') return [slider('c', 'c 펄스 중심', -2, 2, 0.1, 0.5, 's'), slider('w', 'w 펄스 폭', 0.5, 3, 0.1, 1, 's')];
  if (family === 'eo-exp') return [slider('alpha', 'α 감쇠', 0.25, 3, 0.05, 1, '1/s')];
  if (family === 'en-sin') return [slider('A', 'A 진폭', 0.5, 5, 0.5, 2), slider('f0', 'f₀ 주파수', 0.5, 3, 0.5, 1, 'Hz'), slider('theta', 'θ 위상', -3.1, 3.1, 0.1, 0, 'rad')];
  if (family === 'en-exp') return [slider('A', 'A 진폭', 0.5, 4, 0.5, 2), slider('alpha', 'α 감쇠 (0이면 계단)', 0, 3, 0.1, 1, '1/s')];
  if (family === 'en-train') return [slider('A', 'A 높이', 0.5, 4, 0.5, 2), slider('d', 'd 듀티', 0.05, 0.95, 0.05, 0.3)];
  if (family === 'chain') return [slider('a', 'a 펄스 폭', 0.05, 1, 0.05, 0.5, 's')];
  if (family === 'chain-dt') return [{ key: 'n0', label: 'n₀ 임펄스 위치', min: -4, max: 4, step: 1, initial: 0, unit: '', integer: true }];
  if (family === 'dt-pi') return [slider('m', 'm  (Ω₀=mπ)', 0.05, 1.95, 0.05, 0.2), slider('theta', 'θ/π', -1, 1, 0.1, 0.2)];
  return [slider('omega', 'Ω₀ [rad]', 0.1, 3.1, 0.1, 0.2, 'rad')];
}

const sentenceOf = {
  amp: ({ A, B }) => {
    const gv = EX11.v.map((v) => B * v + A);
    return `g=${num(B)}x${A < 0 ? '−' : '+'}${num(Math.abs(A))}: 최댓값 ${num(Math.max(...gv, A))}, 최솟값 ${num(Math.min(...gv, A))} (기준선 A=${num(A)})`;
  },
  combine: (mode, { B }) => pieceFormulas(mode, B).map((p) => p.text).join(' · '),
  eo: (family, p) => {
    const x = family === 'eo-pulse' ? pulseAt(p.c, p.w) : expRight(p.alpha);
    let ex = 0; let ee = 0; let eo = 0; let err = 0;
    const dt = 0.004;
    const [xe, xo] = [evenPart(x), oddPart(x)];
    for (let t = -6 + dt / 2; t < 6; t += dt) {
      const [a, e, o] = [x(t), xe(t), xo(t)];
      ex += a * a * dt; ee += e * e * dt; eo += o * o * dt; err = Math.max(err, Math.abs(a - e - o));
    }
    return `E_x=${num(ex)} = E_e ${num(ee)} + E_o ${num(eo)} (교차항 0) · 확인 x−(x_e+x_o) 최대 ${num(err)}`;
  },
  en: (family, p) => {
    const ep = energyPower(family, p);
    const e = Number.isFinite(ep.energy) ? `E=${num(ep.energy)}` : 'E=∞';
    const tail = ep.kind === 'energy' ? `P=0 → 에너지 신호` : `P=${num(ep.power)} · RMS=${num(ep.rms)} → 전력 신호`;
    const mean = family === 'en-train' ? ` · 평균 Ad=${num(ep.mean)}` : '';
    return `${e}, ${tail}${mean}`;
  },
};

export const opsLesson = {
  id: 'ops',
  families: OPS_FAMILIES,
  initialFamily: 'amp',
  controls: opsControls,
  scrub: false,
  read(family) {
    if (family === 'amp') return 'g=Bx+A: B는 파형을 키우거나 뒤집고(B<0), A는 기준선을 통째로 올립니다. 꺾임점마다 값이 어디로 가는지 보세요.';
    if (family === 'sum' || family === 'prod') return '합과 곱은 같은 t에서 값끼리 계산하므로 구간마다 따로 식을 세웁니다. 곱은 한쪽이 0인 구간에서 모두 0입니다.';
    if (family.startsWith('eo-')) return 'x=x_e+x_o: 우함수 x_e는 좌우 대칭, 기함수 x_o는 부호 반전 대칭. 두 성분의 에너지를 더하면 x의 에너지입니다.';
    if (family.startsWith('en-')) return '에너지 신호는 E가 유한하고 P=0, 전력 신호는 E=∞이고 P가 유한합니다 (R=1 Ω 정규화). RMS=√P 입니다.';
    if (family === 'chain') return 'δ를 폭 a인 직사각 펄스로 근사해 적분하면 u, 다시 적분하면 r입니다. a를 줄이면 u는 점프(CT에서 u(0)는 미정의)에 다가갑니다.';
    if (family === 'chain-dt') return 'DT는 δ[0]=1, u[0]=1. δ[n]=u[n]−u[n−1], u[n]=Σδ[k], r[n]=n u[n]. 누적합과 차분이 서로 역연산입니다.';
    return 'x[n]=A cos(Ω₀n+θ)는 F₀=Ω₀/2π가 유리수 p/q일 때만 주기이고 N=k/F₀ (최소 정수 k)입니다. cos(0.2n)은 비주기입니다.';
  },
  describe({ family, params }) {
    if (family === 'amp') return sentenceOf.amp(params);
    if (family === 'sum' || family === 'prod') return sentenceOf.combine(family, params);
    if (family.startsWith('eo-')) return sentenceOf.eo(family, params);
    if (family.startsWith('en-')) return sentenceOf.en(family, params);
    if (family === 'chain') return `a=${num(params.a)} s: q_a 높이 ${num(1 / params.a)}, 넓이 1 · u_a(0)=½ · r_a(t)=t (t≥a/2)`;
    if (family === 'chain-dt') return `δ[n−${params.n0}] 의 누적합이 u[n−${params.n0}], 그 누적합이 r[n−${params.n0}] · 차분하면 되돌아옵니다`;
    const s = dtSinusoid(family, params);
    return s.periodic
      ? `Ω₀=${num(s.omega)} rad → F₀=${num(s.F0)} (유리수) · N=k/F₀=${s.k}/${num(s.F0)}=${s.N} 샘플`
      : `Ω₀=${num(s.omega)} rad → F₀=Ω₀/2π=${num(s.F0)} (무리수) · 주기가 없는 DT 신호`;
  },
  formula(family) {
    if (family === 'amp') return 'g(t)=B x(t)+A';
    if (family === 'sum') return 'g(t)=x₁(t)+x₂(t)';
    if (family === 'prod') return 'g(t)=x₁(t) x₂(t)';
    if (family.startsWith('eo-')) return 'x_e(t)=[x(t)+x(−t)]/2; x_o(t)=[x(t)−x(−t)]/2; x=x_e+x_o';
    if (family === 'en-sin') return 'E_x=∫x²(t)dt; P_x=(1/T₀)∫x² dt; P_x=A²/2; X_RMS=√(P_x)=A/√2';
    if (family === 'en-exp') return 'E_x=∫₀^∞ A² e^(−2αt)dt=A²/(2α); P_x=lim (1/T)∫x² dt=0 (α>0); α=0: P_x=A²/2';
    if (family === 'en-train') return 'x̄=(1/T₀)∫x dt=Ad; P_x=(1/T₀)∫x² dt=A²d';
    if (family === 'chain') return 'u(t)=∫_{−∞}^{t}δ(λ)dλ; δ(t)=du/dt; r(t)=∫_{−∞}^{t}u(λ)dλ=t u(t)';
    if (family === 'chain-dt') return 'δ[n]=u[n]−u[n−1]; u[n]=Σ_{k=−∞}^{n}δ[k]; r[n]=Σ_{k=−∞}^{n−1}u[k]=n u[n]';
    return 'x[n]=A cos(2πF₀n+θ); x[n+N]=x[n] ⇒ 2πF₀N=2πk; N=k/F₀; Ω₀=2πF₀';
  },
};
