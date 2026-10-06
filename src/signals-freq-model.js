// Lesson "주파수 응답 H(ω)" (pure): Ch 4.5-4.7. H(w) = Y(w)/X(w) = F{h}; |H| and angle H, the steady-state response to a cosine,
// a periodic pulse train through the RC low-pass (harmonic by harmonic, d_k = c_k H(k f0)) and a pulse input (Y = H X).
// Course convention: H is defined in w [rad/s] (w_c = 1/RC), figures often use f [Hz] (f_c = w_c / 2 pi).
import { breakWraps, formatNumber, jumpList, niceTicks, sampleCurve } from './signals-util.js';
import { choiceControl, freqAxisControl, freqSlider, fromAxis, isOmega, toAxis } from './signals-axis.js';

export const FREQ_FAMILIES = [
  { value: 'rc', label: 'RC 저역통과 · 정현파 응답 (Ex 4.45)' },
  { value: 'rlc', label: '직렬 RLC (출력 C 전압) · 정현파 응답' },
  { value: 'train', label: 'RC에 주기 펄스열 (Ex 4.46)' },
  { value: 'pulse', label: 'RC에 단위 펄스 Π(t) (Ex 4.47)' },
];

const TAU = 2 * Math.PI;
const num = (v) => formatNumber(v, 4);
export const SCALE_OPTIONS = [{ value: 0, label: '선형 (±주파수)' }, { value: 1, label: '로그 (|H| dB, 양의 주파수)' }];
export const INPUT_AMPLITUDE = 5; // lecture: x(t) = 5 cos(2 pi f t)
export const TRAIN_PERIOD = 0.05; // s (T0 = 50 ms, f0 = 20 Hz)

// ---------------------------------------------------------------- system functions (f in Hz)
// RC: H = 1/(1 + j w/w_c), w_c = 2 pi f_c = 1/RC.
export function rcH(fc, f) {
  const r = f / fc;
  const den = 1 + r * r;
  return { re: 1 / den, im: -r / den, mag: 1 / Math.sqrt(den), phase: -Math.atan(r) };
}
// Series RLC, output across C: H = w2 / ((w2 - w^2) + j w R) with L = 1 H, w2 = 1/(LC): DC gain 1.
export function rlcH(R, w2, f) {
  const w = TAU * f;
  const re = w2 - w * w;
  const im = w * R;
  const den = re * re + im * im;
  return { re: (w2 * re) / den, im: (-w2 * im) / den, mag: w2 / Math.sqrt(den), phase: Math.atan2(-im, re) };
}
export const rlcDamping = (R, w2) => R / (2 * Math.sqrt(w2)); // zeta = R/2 sqrt(L/C)
export const rlcResonance = (R, w2) => {
  const zeta = rlcDamping(R, w2);
  if (zeta >= Math.SQRT1_2) return { peak: 1, omega: 0 };
  return { peak: 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)), omega: Math.sqrt(w2) * Math.sqrt(1 - 2 * zeta * zeta) };
};

// Steady-state output of A cos(2 pi f t + phi) through H: A|H| cos(2 pi f t + phi + Theta); delay t_d = -Theta / w.
export function steadyState(H, A, f, phi = 0) {
  return {
    amplitude: A * H.mag, phase: phi + H.phase, delay: f > 0 ? -H.phase / (TAU * f) : 0,
    y: (t) => A * H.mag * Math.cos(TAU * f * t + phi + H.phase), x: (t) => A * Math.cos(TAU * f * t + phi),
  };
}

// ---------------------------------------------------------------- periodic pulse train through RC
// Input: height 1, width d T0, centered on 0: c_k = d sinc(k d).
const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
export const pulseCoefficient = (d, k) => d * sinc(k * d);
export function trainOutputCoefficient(d, fc, k, T0 = TRAIN_PERIOD) {
  const c = pulseCoefficient(d, k);
  const H = rcH(fc, k / T0);
  return { re: c * H.re, im: c * H.im, mag: Math.abs(c) * H.mag, phase: (c < 0 ? Math.PI : 0) + H.phase, c };
}
// y(t) from the harmonics -N..N: c_0 + sum_{k=1}^{N} 2 |d_k| cos(k w0 t + angle d_k)
export function trainOutput(d, fc, N, t, T0 = TRAIN_PERIOD) {
  let y = d;
  for (let k = 1; k <= N; k++) {
    const q = trainOutputCoefficient(d, fc, k, T0);
    y += 2 * (q.re * Math.cos((TAU * k * t) / T0) - q.im * Math.sin((TAU * k * t) / T0));
  }
  return y;
}
export const trainInput = (d, t, T0 = TRAIN_PERIOD) => {
  const u = (((t / T0 + 0.5) % 1) + 1) % 1 - 0.5; // (-1/2, 1/2]
  return Math.abs(u) < d / 2 ? 1 : 0;
};
// Exact steady-state RC response of the same pulse train (the limit of the harmonic sum as N grows).
export function trainExact(d, fc, t, T0 = TRAIN_PERIOD) {
  const tau = 1 / (TAU * fc);
  const w = d * T0;
  const a = Math.exp(-w / tau);
  const b = Math.exp(-(T0 - w) / tau);
  const end = (1 - a) / (1 - a * b);
  const start = b * end;
  const u = (((t + w / 2) % T0) + T0) % T0; // time since the pulse rose
  return u < w ? 1 - (1 - start) * Math.exp(-u / tau) : end * Math.exp(-(u - w) / tau);
}
// Power split of the input train: P = sum |c_k|^2 (Ex 4.38 style) up to harmonic N, both sides.
export function trainPowers(d, N) {
  let sum = d * d;
  for (let k = 1; k <= N; k++) sum += 2 * pulseCoefficient(d, k) ** 2;
  return { dc: d * d, partial: sum, total: d };
}

// ---------------------------------------------------------------- pulse input (Ex 4.47)
export const pulseX = (f) => ({ re: sinc(f), im: 0, mag: Math.abs(sinc(f)), phase: sinc(f) < 0 ? Math.PI : 0 });
// y = x * h for x = Pi(t) and h = (1/tau) e^{-t/tau} u(t) (Ex 2.21), tau = RC = 1/(2 pi f_c).
export function pulseOutput(fc, t) {
  const tau = 1 / (TAU * fc);
  if (t <= -0.5) return 0;
  if (t <= 0.5) return 1 - Math.exp(-(t + 0.5) / tau);
  return (Math.exp(1 / (2 * tau)) - Math.exp(-1 / (2 * tau))) * Math.exp(-t / tau);
}

// ---------------------------------------------------------------- frames
const padRange = (values, pad = 0.12) => {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = Math.max(hi - lo, 1e-9);
  return [lo - span * pad * (lo < 0 ? 1 : 0.3), hi + span * pad];
};
const PHASE_TICKS = [{ value: -Math.PI, label: '−π' }, { value: -Math.PI / 2, label: '−π/2' }, { value: 0, label: '0' }, { value: Math.PI / 2, label: 'π/2' }, { value: Math.PI, label: 'π' }];

// Reference frequency [Hz] and the response function of a rc / rlc state.
function systemOf(family, p) {
  if (family === 'rc') return { fref: p.fc, H: (f) => rcH(p.fc, f), fcut: p.fc, f: p.fin };
  const w0 = Math.sqrt(p.w2);
  return { fref: w0 / TAU, H: (f) => rlcH(p.R, p.w2, f), fcut: null, f: p.fin };
}

function logTicks(lo, hi) {
  const out = [];
  for (let k = Math.ceil(lo - 1e-9); k <= hi + 1e-9; k++) out.push({ value: k, label: formatNumber(10 ** k, 3) });
  return out;
}

function responseFrame(family, p) {
  const { fref, H, f } = systemOf(family, p);
  const axis = p.axis;
  const log = p.scale === 1;
  const sym = isOmega(axis) ? 'ω' : 'f';
  const unit = isOmega(axis) ? 'rad/s' : 'Hz';
  const sample = (fn, lo, hi, n) => Array.from({ length: n }, (_, i) => {
    const u = lo + ((hi - lo) * i) / (n - 1);
    const hz = log ? 10 ** u : u;
    return [log ? Math.log10(toAxis(hz, axis)) : toAxis(hz, axis), fn(hz)];
  });
  // The plot window follows the system (around f_ref) but always contains the current input frequency, so the marker never leaves the graph.
  const span = family === 'rc' ? 100 : 20;
  const reach = Math.max((family === 'rc' ? 7 : 3.2) * fref, f * 1.15);
  const lo = log ? Math.min(Math.log10(fref / span), Math.log10(f) - 0.15) : -reach;
  const hi = log ? Math.max(Math.log10(fref * span), Math.log10(f) + 0.15) : reach;
  const xLo = log ? Math.log10(toAxis(10 ** lo, axis)) : toAxis(lo, axis);
  const xHi = log ? Math.log10(toAxis(10 ** hi, axis)) : toAxis(hi, axis);
  const marker = (hz) => (log ? Math.log10(toAxis(hz, axis)) : toAxis(hz, axis));
  const magFn = log ? (hz) => 20 * Math.log10(H(hz).mag) : (hz) => H(hz).mag;
  const magPts = sample(magFn, lo, hi, 600);
  const phPts = sample((hz) => H(hz).phase, lo, hi, 600);
  const magVals = magPts.map((q) => q[1]);
  const [m0, m1] = log ? [Math.max(-70, Math.min(...magVals)) - 3, Math.max(...magVals) + 6] : padRange(magVals);
  const cur = H(f);
  const A = INPUT_AMPLITUDE;
  const phi = p.phi ?? 0;
  const ss = steadyState(cur, A, f, phi);
  const top = Math.max(A, ss.amplitude);
  const win = 3 / f;
  const ms = win < 1;
  const scale = ms ? 1000 : 1;
  const timeLines = [
    { cls: 'c1', pts: sampleCurve((t) => ss.x(t / scale), 0, win * scale, 700) },
    { cls: 'c2', pts: sampleCurve((t) => ss.y(t / scale), 0, win * scale, 700) },
  ];
  // first positive peaks of the input and of the output: the output peak comes t_d later
  const period = 1 / f;
  const peakX = ((((-phi / (TAU * f)) % period) + period) % period) * scale;
  const peakY = peakX + ss.delay * scale;
  const marks = [{ cls: 'c4', x: marker(f), y: magFn(f) }];
  const phaseMarks = [{ cls: 'c4', x: marker(f), y: cur.phase }];
  const xTicks = log ? logTicks(xLo, xHi) : niceTicks(xLo, xHi, 6);
  const refLines = [];
  if (family === 'rc') refLines.push({ cls: 'cm dash', x: marker(p.fc) });
  else refLines.push({ cls: 'cm dash', x: marker(fref) });
  return {
    panes: [
      { title: log ? `|H(${sym})| [dB]  (로그 ${sym} 축)` : `|H(${sym})|  · ${sym} [${unit}]`, x: [xLo, xHi], y: [m0, m1], xTicks, vlines: [...refLines, { cls: 'c4 dash', x: marker(f) }],
        lines: [{ cls: 'c3', pts: magPts }], dots: marks, hlines: family === 'rc' ? [{ cls: 'cm dash', y: log ? -3.0103 : Math.SQRT1_2 }] : [] },
      { title: `∠H(${sym}) [rad]`, x: [xLo, xHi], y: [-Math.PI * 1.1, log ? Math.PI * 0.35 : Math.PI * 1.1], xTicks, yTicks: log ? PHASE_TICKS.filter((t) => t.value <= 0.1) : PHASE_TICKS,
        lines: [{ cls: 'c3', pts: breakWraps(phPts) }], dots: phaseMarks, vlines: [{ cls: 'c4 dash', x: marker(f) }] },
      { title: `입력 5cos(2πf t${phi ? '+θ' : ''}) 와 정상상태 출력 · t [${ms ? 'ms' : 's'}]`, x: [0, win * scale], y: [-top * 1.3, top * 1.3],
        yTicks: [-top, -A, 0, A, top].filter((v, i, list) => list.indexOf(v) === i), lines: timeLines,
        vlines: Math.abs(cur.phase) > 1e-6 ? [{ cls: 'c1 dash', x: peakX }, { cls: 'c4 dash', x: peakY }] : [],
        texts: Math.abs(cur.phase) > 1e-6 ? [{ cls: 'c4', x: peakY, y: top * 1.12, text: `t_d=${num(ss.delay * scale)} ${ms ? 'ms' : 's'}`, anchor: 'start' }] : [] },
    ],
    legend: [
      { cls: 'c3', text: 'H 응답' }, { cls: 'c4 mk', text: `입력 ${sym}=${num(toAxis(f, axis))} ${unit}` }, { cls: 'c1', text: '입력 x(t)' },
      { cls: 'c2', text: '출력 y(t)' }, { cls: 'cm dash', text: family === 'rc' ? '차단 −3 dB' : '공진 ω₀' },
    ],
  };
}

function trainFrame(p) {
  const f0 = 1 / TRAIN_PERIOD;
  const axis = p.axis;
  const sym = isOmega(axis) ? 'ω' : 'f';
  const unit = isOmega(axis) ? 'rad/s' : 'Hz';
  const K = Math.max(20, p.N); // show every harmonic that is synthesized (N goes up to 40)
  const inc = []; const incOut = []; const exc = []; const excOut = [];
  const phIn = []; const phOut = [];
  const off = 0.14 * f0;
  for (let k = -K; k <= K; k++) {
    const q = trainOutputCoefficient(p.d, p.fc, k);
    const inside = Math.abs(k) <= p.N;
    const xo = toAxis(k * f0 - off, axis);
    const xp = toAxis(k * f0 + off, axis);
    (inside ? inc : exc).push([xo, Math.abs(q.c)]);
    (inside ? incOut : excOut).push([xp, q.mag]);
    if (Math.abs(q.c) > 1e-4) {
      const angIn = q.c < 0 ? Math.PI : 0;
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      phIn.push([xo, angIn]);
      phOut.push([xp, wrap(q.phase)]);
    }
  }
  const xr = toAxis(K * f0 + 20, axis);
  const envelope = sampleCurve((f) => p.d * rcH(p.fc, f).mag, -K * f0, K * f0, 400).map(([f, v]) => [toAxis(f, axis), v]);
  const win = TRAIN_PERIOD * 2;
  const tms = 1000;
  const edges = [];
  for (let m = -3; m <= 3; m++) edges.push((m + p.d / 2) * TRAIN_PERIOD, (m - p.d / 2) * TRAIN_PERIOD);
  const input = (t) => trainInput(p.d, t / tms);
  const out = (t) => trainOutput(p.d, p.fc, p.N, t / tms);
  const exact = (t) => trainExact(p.d, p.fc, t / tms);
  const edgesMs = edges.map((e) => e * tms);
  return {
    panes: [
      { title: `선 스펙트럼 |c_k| (입력) 와 |d_k|=|c_k||H(kf₀)| (출력) · ${sym} [${unit}], f₀=20 Hz`, x: [-xr, xr], y: [0, p.d * 1.18], xTicks: niceTicks(-xr, xr, 6),
        stems: [{ cls: 'c1', pts: inc }, { cls: 'c2', pts: incOut }, { cls: 'cm faint', pts: exc }, { cls: 'cm faint', pts: excOut }],
        lines: [{ cls: 'c4 dash', pts: envelope }] },
      { title: '위상 ∠c_k (입력, 0 또는 ±π) 와 ∠d_k = ∠c_k + ∠H(kf₀)', x: [-xr, xr], y: [-Math.PI * 1.1, Math.PI * 1.1], xTicks: niceTicks(-xr, xr, 6), yTicks: PHASE_TICKS,
        stems: [{ cls: 'c1', pts: phIn }, { cls: 'c2', pts: phOut }] },
      { title: `시간 파형: 입력 펄스열 x̃(t) 와 출력 ỹ(t) (N=${p.N}개 조화) · t [ms]`, x: [-win * tms / 2, win * tms / 2], y: [-0.12, 1.25], yTicks: [0, 1],
        lines: [{ cls: 'c1', pts: sampleCurve(input, -win * tms / 2, win * tms / 2, 800, edgesMs, { gaps: true }) }, { cls: 'c2', pts: sampleCurve(out, -win * tms / 2, win * tms / 2, 800) },
          { cls: 'cm dash', pts: sampleCurve(exact, -win * tms / 2, win * tms / 2, 600, edgesMs) }],
        jumps: [{ cls: 'c1', list: jumpList(input, edgesMs, -win * tms / 2, win * tms / 2) }] },
    ],
    legend: [
      { cls: 'c1', text: '입력 c_k' }, { cls: 'c2', text: '출력 d_k' }, { cls: 'c4 dash', text: '|H| 모양' },
      { cls: 'cm dash', text: 'N→∞ 극한 (지수 충·방전)' }, { cls: 'cm', text: '아직 더하지 않은 조화' },
    ],
  };
}

function pulseFrame(p) {
  const axis = p.axis;
  const sym = isOmega(axis) ? 'ω' : 'f';
  const unit = isOmega(axis) ? 'rad/s' : 'Hz';
  const R = 4;
  const fn = (fun) => sampleCurve(fun, -R, R, 700).map(([f, v]) => [toAxis(f, axis), v]);
  const xr = toAxis(R, axis);
  const phaseY = (f) => { const a = pulseX(f).phase + rcH(p.fc, f).phase; return Math.atan2(Math.sin(a), Math.cos(a)); };
  const phY = breakWraps(sampleCurve((f) => (Math.abs(pulseX(f).mag) * rcH(p.fc, f).mag > 0.02 ? phaseY(f) : null), -R, R, 900).map(([f, v]) => [toAxis(f, axis), v]));
  const hi = Math.max(3, 0.5 + 6 / (TAU * p.fc));
  const lo = -1.5;
  const edges = [-0.5, 0.5];
  return {
    panes: [
      { title: `|X|=|sinc(f)|, |H|, |Y|=|H||X| · ${sym} [${unit}]`, x: [-xr, xr], y: [0, 1.15], xTicks: niceTicks(-xr, xr, 6), yTicks: [0, 1],
        lines: [{ cls: 'c1', pts: fn((f) => pulseX(f).mag) }, { cls: 'c4 dash', pts: fn((f) => rcH(p.fc, f).mag) }, { cls: 'c2', pts: fn((f) => pulseX(f).mag * rcH(p.fc, f).mag) }] },
      { title: '∠Y = ∠X + ∠H  (±π로 접힘)', x: [-xr, xr], y: [-Math.PI * 1.1, Math.PI * 1.1], xTicks: niceTicks(-xr, xr, 6), yTicks: PHASE_TICKS,
        lines: [{ cls: 'c4 dash', pts: fn((f) => rcH(p.fc, f).phase) }, { cls: 'c2', pts: phY }] },
      { title: `시간: x(t)=Π(t) 와 y(t)=x∗h (τ=RC=${num(1 / (TAU * p.fc))} s)`, x: [lo, hi], y: [-0.12, 1.25], yTicks: [0, 1],
        lines: [{ cls: 'c1', pts: sampleCurve((t) => (Math.abs(t) < 0.5 ? 1 : 0), lo, hi, 600, edges, { gaps: true }) }, { cls: 'c2', pts: sampleCurve((t) => pulseOutput(p.fc, t), lo, hi, 700, edges) }],
        jumps: [{ cls: 'c1', list: [{ x: -0.5, left: 0, right: 1 }, { x: 0.5, left: 1, right: 0 }] }] },
    ],
    legend: [{ cls: 'c1', text: 'X · 입력' }, { cls: 'c4 dash', text: 'H' }, { cls: 'c2', text: 'Y=HX · 출력' }],
  };
}

export function freqFrame(family, params) {
  if (family === 'rc' || family === 'rlc') return responseFrame(family, params);
  if (family === 'train') return trainFrame(params);
  if (family === 'pulse') return pulseFrame(params);
  throw new RangeError('지원하지 않는 예시입니다.');
}

// ---------------------------------------------------------------- lesson
const slider = (key, label, min, max, step, initial, unit = '') => ({ key, label, min, max, step, initial, unit });

// The stored values are in Hz; the axis select (default f [Hz], the Hz worked-example convention of Ex 4.45) relabels the frequency sliders to w.
const FIN_RANGE = { rc: [5, 500, 5], rlc: [0.05, 4, 0.05] };
function freqControls(family, params = {}) {
  if (family === 'rc') {
    return [
      freqSlider('fc', ['f_c', 'ω_c'], '차단', 10, 200, 5, 80, params), freqSlider('fin', ['f', 'ω'], '입력 주파수', ...FIN_RANGE.rc, 20, params),
      slider('phi', 'θ 입력 위상', -3.1, 3.1, 0.1, 0, 'rad'), freqAxisControl(0), choiceControl('scale', '축 척도', SCALE_OPTIONS, 0),
    ];
  }
  if (family === 'rlc') {
    return [
      slider('R', 'R 저항', 0.2, 14, 0.2, 2, 'Ω'), slider('w2', 'ω₀²=1/LC', 1, 50, 1, 26, 'rad²/s²'), freqSlider('fin', ['f', 'ω'], '입력 주파수', ...FIN_RANGE.rlc, 0.5, params),
      freqAxisControl(0), choiceControl('scale', '축 척도', SCALE_OPTIONS, 0),
    ];
  }
  if (family === 'train') return [slider('N', 'N 조화 수', 1, 40, 1, 20, ''), slider('d', 'd 듀티', 0.05, 0.95, 0.05, 0.2), freqSlider('fc', ['f_c', 'ω_c'], '차단', 10, 200, 5, 80, params), freqAxisControl(0)];
  return [freqSlider('fc', ['f_c', 'ω_c'], '차단', 0.1, 100, 0.1, 0.5, params), freqAxisControl(0)];
}

// Dragging the |H| / angle H plots: a point on the plot axis (a linear value or log10 of it) becomes the input frequency [Hz],
// clamped to the slider range and snapped to its step (so the slider and the plot agree).
export function inputFromPlot(family, params, x) {
  const spec = freqControls(family, params).find((c) => c.key === 'fin');
  if (!spec || !Number.isFinite(x)) return null;
  const onAxis = params.scale === 1 ? 10 ** x : x;
  const hz = Math.abs(fromAxis(onAxis, params.axis ?? 0));
  const snapped = Math.round(hz / spec.step) * spec.step;
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(6));
}

export function describeFreq(family, p) {
  if (family === 'rc' || family === 'rlc') {
    const { H, f } = systemOf(family, p);
    const cur = H(f);
    const ss = steadyState(cur, INPUT_AMPLITUDE, f, p.phi ?? 0);
    const head = family === 'rc'
      ? `ω_c=1/RC=${num(TAU * p.fc)} rad/s (f_c=${num(p.fc)} Hz)`
      : `ω₀=${num(Math.sqrt(p.w2))} rad/s, ζ=${num(rlcDamping(p.R, p.w2))}, 공진 피크 ${num(rlcResonance(p.R, p.w2).peak)}`;
    return `${head} · f=${num(f)} Hz(ω=${num(TAU * f)}): |H|=${num(cur.mag)}, Θ=${num(cur.phase)} rad → y=${num(ss.amplitude)}cos(2πft${ss.phase < 0 ? '−' : '+'}${num(Math.abs(ss.phase))}), 지연 ${num(ss.delay * 1000)} ms`;
  }
  if (family === 'train') {
    const q1 = trainOutputCoefficient(p.d, p.fc, 1);
    const pw = trainPowers(p.d, p.N);
    return `f₀=20 Hz, c_k=d sinc(kd): |c₁|=${num(Math.abs(q1.c))} → |d₁|=${num(q1.mag)} (H(f₀)=${num(rcH(p.fc, 20).mag)}) · 조화 ${p.N}개까지 전력 ${num(pw.partial)} / ${num(pw.total)}`;
  }
  const tau = 1 / (TAU * p.fc);
  return `τ=RC=${num(tau)} s: y 최댓값 ${num(pulseOutput(p.fc, 0.5))} (=1−e^(−1/RC)=${num(1 - Math.exp(-1 / tau))}), Y=H·X, ∠Y=∠X+∠H`;
}

export const freqLesson = {
  id: 'freq',
  families: FREQ_FAMILIES,
  initialFamily: 'rc',
  controls: freqControls,
  scrub: false,
  describe: ({ family, params }) => describeFreq(family, params),
  read(family) {
    if (family === 'rc' || family === 'rlc') return 'H(ω)=Y/X. 정상상태에서 입력 cos은 크기 |H|배, 위상 Θ만큼 밀려 나옵니다. |H|·∠H 그래프를 끌어(또는 ←/→) 입력 주파수 점이 곡선 위를 움직이게 해 보세요.';
    if (family === 'train') return '주기 입력은 조화마다 c_k H(kf₀)로 곱해집니다. 고주파 조화가 깎여 모서리가 둥글어지고 지수 충·방전 모양이 됩니다.';
    return '비주기 입력은 Y(ω)=H(ω)X(ω)입니다. 크기는 곱, 위상은 합이며 f_c를 낮출수록 펄스 응답이 지수적으로 퍼집니다.';
  },
  formula(family) {
    if (family === 'rc') return 'H(ω)=1/(1+jω/ω_c); ω_c=1/RC; f_c=ω_c/2π; |H|=1/√(1+(ω/ω_c)²); Θ=−tan⁻¹(ω/ω_c); x=5cos(ωt+θ) ⇒ y=5|H(ω)|cos(ωt+θ+Θ(ω))';
    if (family === 'rlc') return 'H(ω)=ω₀²/[(ω₀²−ω²)+jωR/L]; ω₀²=1/LC; ζ=(R/2)√(C/L); x=5cos(ωt+θ) ⇒ y=5|H(ω)|cos(ωt+θ+Θ(ω))';
    if (family === 'train') return 'x̃=Σ c_k e^(jkω₀t); c_k=d sinc(kd); ỹ=Σ c_k H(kω₀) e^(jkω₀t); d_k=c_k H(kω₀)';
    return 'Y(ω)=H(ω)X(ω); |Y|=|H||X|; arg Y=arg X+Θ; X(f)=sinc(f), x=Π(t)';
  },
};
