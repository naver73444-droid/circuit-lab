// Fourier transform lesson, free examples "성질 증명" (pure): three properties proved line by line (Ch04_4 p11 sin modulation,
// p12 scaling with a < 0, p16 integration). Each example draws the original x (dashed) and the result y (solid), then Re Y and
// Im Y, so negative coefficients and the delta of the integral are not read as a magnitude/phase.
// Course convention: X(w) = integral x(t) e^{-jwt} dt, inverse with 1/2pi; numeric frequency arguments are f [Hz], w = 2 pi f.
import { formatNumber, jumpList, midpointRect, niceTicks, sampleCurve } from './signals-util.js';
import { axisSymbol, axisUnit, freqAxisControl, freqSlider, isOmega, toAxis } from './signals-axis.js';

const TAU = 2 * Math.PI;
const MINUS = '−';

export const PROOF_FAMILIES = [
  { value: 'proof-scale', label: '성질 증명 · 음수 스케일링' },
  { value: 'proof-sin', label: '성질 증명 · sin 변조' },
  { value: 'proof-integral', label: '성질 증명 · 적분과 δ' },
];
export const isProofFamily = (family) => PROOF_FAMILIES.some((f) => f.value === family);

const SIN_T = 2; // s, x(t) = Pi(t/T) of the sin example
const INT_T = 1; // s, x(t) = Pi(t) of the integral example
const SCALE_F = 10 / TAU; // Hz: the spectrum panes of scaling and integration span |w| <= 10 rad/s
const INT_GAP = 0.5 / TAU; // Hz: |w| < 0.5 rad/s of the integral's regular part is not drawn (it diverges at the origin)
const READ_HZ = { 'proof-scale': 2 / TAU, 'proof-integral': 0.5 }; // reading points: w = 2 rad/s, w = pi rad/s

const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));
const finite = (...values) => values.every((v) => typeof v === 'number' && Number.isFinite(v));
function family$(family) {
  if (!isProofFamily(family)) throw new RangeError('성질 증명 예시가 아닙니다.');
}

// ---------------------------------------------------------------- pure numbers
// y(t) = x(at) with x(t) = e^{-t}u(t): e^{-at} where at > 0, 0 where at < 0; t = 0 is the jump (null).
export function scaledExponential(a, t) {
  if (!finite(a, t)) throw new RangeError('a와 t는 유한한 수여야 합니다.');
  if (a === 0) throw new RangeError('a=0은 스케일링이 아닙니다.');
  if (t === 0) return null;
  return a * t > 0 ? Math.exp(-a * t) : 0;
}

// Y(f) = (1/|a|) X(w/a) = (1/|a|) / (1 + j 2 pi f / a), with X(w) = 1/(1 + jw).
export function scaledExponentialSpectrum(a, fHz) {
  if (!finite(a, fHz)) throw new RangeError('a와 f는 유한한 수여야 합니다.');
  if (a === 0) throw new RangeError('a=0은 스케일링이 아닙니다.');
  const u = (TAU * fHz) / a;
  const den = Math.abs(a) * (1 + u * u);
  return { re: 1 / den, im: -u / den };
}

// x(t) sin(w0 t) with x = Pi(t/T): Y = [X(w - w0) - X(w + w0)]/(2j), X(f) = T sinc(fT). The two lobes are added as complex numbers.
export function sinModulationSpectrum({ T, f0 }, fHz) {
  if (!finite(T, f0, fHz)) throw new RangeError('T, f₀, f는 유한한 수여야 합니다.');
  if (T <= 0) throw new RangeError('T는 양수여야 합니다.');
  const minus = T * sinc((fHz - f0) * T);
  const plus = T * sinc((fHz + f0) * T);
  return { re: 0, im: (plus - minus) / 2 };
}

// Running integral of Pi(t/T) (height 1): 0, then a ramp, then T. Continuous, in seconds.
export function integratedRectangle(T, t) {
  if (!finite(T, t)) throw new RangeError('T와 t는 유한한 수여야 합니다.');
  if (T <= 0) throw new RangeError('T는 양수여야 합니다.');
  if (t <= -T / 2) return 0;
  if (t >= T / 2) return T;
  return t + T / 2;
}

// Y = pi X(0) delta(w) + PV{X(w)/(jw)}: the regular part X(f)/(j 2 pi f) (undefined at f = 0) and the delta, whose coefficient on
// the f axis is X(0)/2 = T/2 (on the w axis pi T).
export function integralSpectrum(T, fHz) {
  if (!finite(T, fHz)) throw new RangeError('T와 f는 유한한 수여야 합니다.');
  if (T <= 0) throw new RangeError('T는 양수여야 합니다.');
  const regular = fHz === 0 ? null : { re: 0, im: -(T * sinc(fHz * T)) / (TAU * fHz) };
  return { regular, impulse: { atHz: 0, areaHz: T / 2 } };
}

// ---------------------------------------------------------------- controls and normalization
const lineControl = { key: 'line', label: '증명 줄', min: 1, max: 4, step: 1, initial: 1, unit: '', integer: true };

export function proofControls(family, params = {}) {
  family$(family);
  const axis = freqAxisControl(1);
  if (family === 'proof-scale') return [{ key: 'a', label: 'a 스케일', min: -3, max: 3, step: 0.25, initial: -2, unit: '' }, lineControl, axis];
  if (family === 'proof-sin') return [freqSlider('f0', ['f₀', 'ω₀'], '반송파', 0.5, 3, 0.1, 2, { axis: 1, ...params }), lineControl, axis];
  return [lineControl, axis];
}

const ZERO_NOTE = 'a=0은 제외합니다. 0.25로 표시합니다.';

// Only the keys that need fixing: a = 0 -> +0.25 (with a note), line -> integer 1..4.
export function normalizeProof(family, params = {}) {
  family$(family);
  const raw = Number(params.line);
  const out = { line: Number.isFinite(raw) ? Math.min(4, Math.max(1, Math.round(raw))) : 1 };
  let note = '';
  if (family === 'proof-scale') {
    const a = Number(params.a);
    if (!Number.isFinite(a)) out.a = -2;
    else if (Math.abs(a) < 1e-9) { out.a = 0.25; note = ZERO_NOTE; }
  }
  return { params: out, note };
}

// Defaults filled in, then normalized: the display adapters accept the raw slider values (a = 0, line = 2.5) safely.
function prepared(family, params = {}) {
  family$(family);
  const defaults = Object.fromEntries(proofControls(family, params).map((c) => [c.key, c.initial]));
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(params ?? {})) if (typeof value === 'number' && Number.isFinite(value)) merged[key] = value;
  return { ...merged, ...normalizeProof(family, merged).params };
}

// ---------------------------------------------------------------- formatting
const num = (value, digits = 4) => formatNumber(value, digits);
// "0.25+j0.25", "−j1", "0" (parts below 1e-12 are dropped)
function complexText({ re, im }, digits = 4) {
  const r = Math.abs(re) < 1e-12 ? 0 : re;
  const i = Math.abs(im) < 1e-12 ? 0 : im;
  if (i === 0) return num(r, digits);
  const imag = `j${num(Math.abs(i), digits)}`;
  if (r === 0) return `${i < 0 ? MINUS : ''}${imag}`;
  return `${num(r, digits)}${i < 0 ? MINUS : '+'}${imag}`;
}
const signed = (value) => (value < 0 ? `(${num(value)})` : num(value));

// ---------------------------------------------------------------- proof lines
const DEFINITIONS = 'X(ω)=∫ x(t) e^(−jωt) dt; x(t)=(1/2π)∫ X(ω) e^(jωt) dω';

export function proofLines(family, params = {}) {
  const p = prepared(family, params);
  if (family === 'proof-scale') {
    const negative = p.a < 0;
    return [
      { formula: 'Y(ω)=∫_(−∞)^(∞) x(at) e^(−jωt) dt', reason: '스케일한 신호 y(t)=x(at)를 변환 정의에 넣습니다.' },
      negative
        ? { formula: 'Y(ω)=∫_(∞)^(−∞) x(λ) e^(−j(ω/a)λ) dλ/a', reason: 'λ=at, dt=dλ/a로 바꿉니다. a<0이면 t가 −∞→∞일 때 λ는 ∞→−∞입니다.' }
        : { formula: 'Y(ω)=∫_(−∞)^(∞) x(λ) e^(−j(ω/a)λ) dλ/a', reason: 'λ=at, dt=dλ/a로 바꿉니다. a>0이면 적분 경계가 그대로입니다.' },
      negative
        ? { formula: 'Y(ω)=−(1/a)∫_(−∞)^(∞) x(λ) e^(−j(ω/a)λ) dλ', reason: '경계를 바로 세우면 부호가 하나 붙어 계수가 −1/a가 됩니다.' }
        : { formula: 'Y(ω)=(1/a)∫_(−∞)^(∞) x(λ) e^(−j(ω/a)λ) dλ', reason: 'a>0이면 계수는 1/a 그대로입니다.' },
      { formula: 'Y(ω)=(1/|a|) X(ω/a)', reason: '두 경우의 계수 −1/a와 1/a는 모두 1/|a|입니다. 남은 적분은 X(ω/a)입니다.' },
    ];
  }
  if (family === 'proof-sin') {
    return [
      { formula: 'sin(ω₀t)=[e^(jω₀t)−e^(−jω₀t)]/(2j)', reason: 'sin을 두 복소 지수로 풉니다. 지수의 j를 빠뜨리지 않습니다.' },
      { formula: 'Y(ω)=[F{x(t)e^(jω₀t)}−F{x(t)e^(−jω₀t)}]/(2j)', reason: '선형성으로 두 항을 따로 변환합니다.' },
      { formula: 'Y(ω)=[X(ω−ω₀)−X(ω+ω₀)]/(2j)', reason: '주파수이동 성질 x(t)e^(jω₀t)↔X(ω−ω₀)를 두 번 씁니다.' },
      { formula: 'Y(ω)=[e^(−jπ/2)X(ω−ω₀)+e^(jπ/2)X(ω+ω₀)]/2', reason: '1/j=e^(−jπ/2), −1/j=e^(jπ/2)이므로 두 복사본에 ∓90° 위상이 붙습니다.' },
    ];
  }
  return [
    { formula: 'y(t)=∫_(−∞)^(t) x(λ) dλ=(x*u)(t)', reason: 'u(t−λ)는 λ<t에서만 1이므로 누적 적분은 x와 u의 컨볼루션입니다.' },
    { formula: 'U(ω)=πδ(ω)+PV{1/(jω)}', reason: '단위 계단의 변환을 씁니다. PV는 원점을 빼고 읽는 주값(정규 부분)입니다.' },
    { formula: 'Y(ω)=X(ω)U(ω)=πX(ω)δ(ω)+PV{X(ω)/(jω)}', reason: '컨볼루션 성질로 시간의 컨볼루션이 주파수의 곱이 됩니다.' },
    { formula: 'X(ω)δ(ω)=X(0)δ(ω); Y(ω)=πX(0)δ(ω)+PV{X(ω)/(jω)}', reason: 'δ의 표본화 성질로 X(ω)δ(ω)=X(0)δ(ω)입니다. δ 계수는 πX(0)입니다.' },
  ];
}

function substitution(family, p) {
  const axis = p.axis;
  if (family === 'proof-scale') {
    const a = p.a;
    const value = scaledExponentialSpectrum(a, READ_HZ[family]);
    const y = a < 0 ? `y(t)=e^(${num(-a)}t)u(−t)` : `y(t)=e^(${MINUS}${num(a)}t)u(t)`;
    return `x(t)=e^(−t)u(t), X(ω)=1/(1+jω), a=${num(a)}; ${y}; Y(ω)=(1/${num(Math.abs(a))})·1/(1+jω/${signed(a)}); Y(2)=${complexText(value)}`;
  }
  if (family === 'proof-sin') {
    const plus = sinModulationSpectrum({ T: SIN_T, f0: p.f0 }, p.f0);
    const minus = sinModulationSpectrum({ T: SIN_T, f0: p.f0 }, -p.f0);
    const at = isOmega(axis) ? `ω₀=${num(TAU * p.f0)}` : `f₀=${num(p.f0)}`;
    const arg = isOmega(axis) ? 'ω₀' : 'f₀';
    return `x(t)=Π(t/2), X(ω)=2 sinc(ω/π), ${at}; Y(${arg})=${complexText(plus)}; Y(−${arg})=${complexText(minus)}`;
  }
  const value = integralSpectrum(INT_T, READ_HZ[family]).regular;
  const delta = isOmega(axis) ? 'Y(ω)=πδ(ω)+PV{sinc(ω/(2π))/(jω)}' : 'Y(f)=δ(f)/2+PV{sinc(f)/(j2πf)}';
  const read = isOmega(axis) ? 'Y_r(π)' : 'Y_r(0.5)';
  return `x(t)=Π(t), X(ω)=sinc(ω/(2π)), X(0)=1; ${delta}; ${read}=${complexText(value)}`;
}

export function proofFormula(family, params = {}) {
  const p = prepared(family, params);
  const lines = proofLines(family, p).slice(0, p.line).map((l) => l.formula);
  return [DEFINITIONS, ...lines, substitution(family, p)].join('; ');
}

const READS = {
  'proof-scale': 'a<0이면 치환한 적분의 경계가 뒤집혀 부호가 붙고 계수가 1/|a|가 됩니다. 증명 줄을 넘기며 a의 부호를 바꿔 보세요.',
  'proof-sin': 'sin 변조는 두 복사본에 ∓90° 위상이 붙습니다. 두 로브는 복소수로 더한 뒤 크기를 읽습니다. Re Y는 0이고 Im Y만 남습니다.',
  'proof-integral': '누적 적분의 변환은 원점의 δ(면적 πX(0))와 정규 부분 X(ω)/(jω)로 나뉩니다. PV는 원점을 빼고 읽는 주값입니다.',
};
export function proofRead(family) {
  family$(family);
  return READS[family];
}

function readout(family, p) {
  const omega = isOmega(p.axis);
  if (family === 'proof-scale') {
    const v = scaledExponentialSpectrum(p.a, READ_HZ[family]);
    const at = omega ? 'ω=2 rad/s' : `f=${num(READ_HZ[family], 3)} Hz`;
    return `${at}: Y=${complexText(v)}, |Y|=${num(Math.hypot(v.re, v.im))}, 위상 ${num(Math.atan2(v.im, v.re))} rad`;
  }
  if (family === 'proof-sin') {
    const plus = sinModulationSpectrum({ T: SIN_T, f0: p.f0 }, p.f0);
    const minus = sinModulationSpectrum({ T: SIN_T, f0: p.f0 }, -p.f0);
    const at = omega ? `ω=±${num(TAU * p.f0)} rad/s` : `f=±${num(p.f0)} Hz`;
    const other = Math.abs(sinc(2 * p.f0 * SIN_T)) < 1e-12 ? ' · 반대 로브 기여 0이라 ±f₀ 판독값의 크기가 1' : ' · 반대 로브가 겹쳐 크기가 1이 아님';
    return `${at}: Y(+)=${complexText(plus)}, Y(−)=${complexText(minus)}, |Y|=${num(Math.abs(plus.im))}${other}`;
  }
  const { regular, impulse } = integralSpectrum(INT_T, READ_HZ[family]);
  const at = omega ? 'ω=π rad/s' : 'f=0.5 Hz';
  const area = omega ? `δ 면적 π (=2π·${num(impulse.areaHz)})` : `δ 면적 ${num(impulse.areaHz)}`;
  return `${at}: 정규 부분 ${complexText(regular)} · 원점 ${area}`;
}

export function proofDescribe(family, params = {}) {
  const p = prepared(family, params);
  const line = proofLines(family, p)[p.line - 1];
  return `줄 ${p.line}/4 · ${line.reason} · ${readout(family, p)}`;
}

// ---------------------------------------------------------------- frame for signals-panes-view
// Time [lo, hi] s and frequency [lo, hi] Hz drawn by each example.
export function proofRanges(family, params = {}) {
  const p = prepared(family, params);
  if (family === 'proof-scale') return { time: { lo: -4, hi: 4 }, freq: { lo: -SCALE_F, hi: SCALE_F } };
  if (family === 'proof-sin') {
    const f = p.f0 + 3 / SIN_T;
    return { time: { lo: -2, hi: 2 }, freq: { lo: -f, hi: f } };
  }
  return { time: { lo: -2, hi: 2 }, freq: { lo: -SCALE_F, hi: SCALE_F } };
}

const COUNT = 600;
const nanJump = (fn) => (t) => fn(t) ?? NaN;

function timePane(family, p, range) {
  const { lo, hi } = range;
  let x;
  let y;
  let edges;
  let title;
  if (family === 'proof-scale') {
    x = nanJump((t) => scaledExponential(1, t));
    y = nanJump((t) => scaledExponential(p.a, t));
    edges = [0];
    title = `x=e^(−t)u(t), y=x(${num(p.a)}t) · t [s]`; // short enough for a 360 px phone; the legend tells dashed x from solid y
  } else if (family === 'proof-sin') {
    x = (t) => midpointRect(t, -SIN_T / 2, SIN_T / 2);
    y = (t) => x(t) * Math.sin(TAU * p.f0 * t);
    edges = [-SIN_T / 2, SIN_T / 2];
    title = 'x=Π(t/2), y=x·sin(ω₀t) · t [s]';
  } else {
    x = (t) => midpointRect(t, -INT_T / 2, INT_T / 2);
    y = (t) => integratedRectangle(INT_T, t);
    edges = [-INT_T / 2, INT_T / 2];
    title = 'x=Π(t), y=∫x(λ)dλ · t [s]';
  }
  const negative = family === 'proof-sin';
  const xs = sampleCurve(x, lo, hi, COUNT, edges, { gaps: true });
  const ys = sampleCurve(y, lo, hi, COUNT, edges, { gaps: true });
  return {
    title, x: [lo, hi], y: negative ? [-1.35, 1.35] : [-0.25, 1.35], xTicks: niceTicks(lo, hi, 4), yTicks: negative ? [-1, 0, 1] : [0, 1],
    lines: [{ cls: 'cm dash', pts: xs }, { cls: 'c1', pts: ys }],
    jumps: [{ cls: 'cm', list: jumpList(x, edges, lo, hi) }, { cls: 'c1', list: jumpList(y, edges, lo, hi) }],
  };
}

// Samples of a frequency function on [lo, hi] Hz, mapped to the chosen axis; `skip` drops |f| < skip with one null break.
function freqCurve(fn, lo, hi, axis, skip = 0) {
  const pts = [];
  let broken = false;
  for (let i = 0; i < COUNT; i++) {
    const f = lo + ((hi - lo) * i) / (COUNT - 1);
    if (Math.abs(f) < skip) {
      if (!broken) { pts.push([0, null]); broken = true; }
      continue;
    }
    pts.push([toAxis(f, axis), fn(f)]);
  }
  return pts;
}

export function proofFrame(family, params = {}) {
  const p = prepared(family, params);
  const axis = p.axis;
  const sym = axisSymbol(axis);
  const unit = axisUnit(axis);
  const range = proofRanges(family, p);
  const xr = [toAxis(range.freq.lo, axis), toAxis(range.freq.hi, axis)];
  const xTicks = niceTicks(xr[0], xr[1], 4);
  const zero = [[xr[0], 0], [xr[1], 0]];
  let rePane;
  let imPane;
  if (family === 'proof-scale') {
    const m = 1 / Math.abs(p.a); // |Y(0)|
    const value = (f) => scaledExponentialSpectrum(p.a, f);
    rePane = {
      title: `Re Y(${sym}) · ${sym} [${unit}]`, x: xr, y: [-0.15 * m, 1.25 * m], xTicks, yTicks: [0, Number(m.toPrecision(3))],
      lines: [{ cls: 'c2', pts: freqCurve((f) => value(f).re, range.freq.lo, range.freq.hi, axis) }],
    };
    imPane = {
      title: `Im Y(${sym}) · a<0이면 부호 반대`, x: xr, y: [-0.65 * m, 0.65 * m], xTicks, yTicks: [-Number((m / 2).toPrecision(3)), 0, Number((m / 2).toPrecision(3))],
      lines: [{ cls: 'c3', pts: freqCurve((f) => value(f).im, range.freq.lo, range.freq.hi, axis) }],
    };
  } else if (family === 'proof-sin') {
    const value = (f) => sinModulationSpectrum({ T: SIN_T, f0: p.f0 }, f);
    rePane = { title: `Re Y(${sym}) = 0 · ${sym} [${unit}]`, x: xr, y: [-1.35, 1.35], xTicks, yTicks: [-1, 0, 1], lines: [{ cls: 'c2', pts: zero }] };
    imPane = {
      title: `Im Y(${sym}) · 두 로브의 복소 합`, x: xr, y: [-1.35, 1.35], xTicks, yTicks: [-1, 0, 1],
      lines: [{ cls: 'c3', pts: freqCurve((f) => value(f).im, range.freq.lo, range.freq.hi, axis) }],
    };
  } else {
    const { impulse } = integralSpectrum(INT_T, 1);
    const area = isOmega(axis) ? TAU * impulse.areaHz : impulse.areaHz; // pi T on the w axis, T/2 on the f axis
    const label = isOmega(axis) ? '면적 π' : '면적 1/2';
    rePane = {
      title: `Re Y(${sym}) · δ는 면적 표시 · ${sym} [${unit}]`, x: xr, y: [-0.2 * area, 1.55 * area], xTicks, yTicks: [0],
      lines: [{ cls: 'c2', pts: zero }],
      segments: [{ cls: 'c2', x1: 0, y1: 0, x2: 0, y2: area * 1.2 }],
      texts: [{ cls: 'c2', x: 0, y: area * 1.2, text: label, dy: -6 }],
    };
    imPane = {
      title: `Im Y(${sym}) 정규 부분 · ${sym} [${unit}]`, x: xr, y: [-2, 2], xTicks, yTicks: [-2, -1, 0, 1, 2],
      lines: [{ cls: 'c3', pts: freqCurve((f) => integralSpectrum(INT_T, f).regular.im, range.freq.lo, range.freq.hi, axis, INT_GAP) }],
      texts: [{ cls: 'c3', x: 0, y: 1.6, text: '원점 발산 · 가운데 구간 생략', dy: 0 }],
    };
  }
  return {
    split: true,
    panes: [timePane(family, p, range.time), rePane, imPane],
    legend: [{ cls: 'cm dash', text: 'x(t) 원 신호' }, { cls: 'c1', text: 'y(t) 연산 결과' }, { cls: 'c2', text: `Re Y(${sym})` }, { cls: 'c3', text: `Im Y(${sym})` }],
  };
}
