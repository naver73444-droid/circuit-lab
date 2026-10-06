// Lesson 3 (pure): Fourier series as a chain of rotating phasors with a general period T0.
// Every wave is written as x_N(t) = dc + sum_{k=1..N} amp_k cos(2*pi*k*t/T0 + phase_k); the model works in normalized time
// (t/T0 = periods), the view and the readout convert with T0. EFS: x = sum c_k e^{j k w0 t}, c_k = (1/T0) integral x e^{-j k w0 t} dt.
import { choiceControl, freqAxisControl } from './signals-axis.js';
import { formatNumber } from './signals-util.js';

export const SERIES_WAVES = [
  { value: 'pulse', label: '중심 펄스열 · 우대칭 (Ex 4.3, 4.5, 4.7)' },
  { value: 'pulse0', label: '이동 펄스열 0<t<DT₀ · 선형 위상 (Ex 4.1, 4.6)' },
  { value: 'odd', label: '홀 방형파 ±A (Ex 4.4)' },
  { value: 'ramp', label: '톱니 x=t/T₀ (0<t<T₀) (Ex 4.8)' },
  { value: 'saw', label: '톱니파 · 홀대칭 2t' },
  { value: 'tri', label: '삼각파' },
];
export const MAX_HARMONICS = 25;
// The overshoot is judged against the jump once it is clearly there; below this fraction the peak is just "the maximum".
const GIBBS_VISIBLE = 0.005;
const TAU = 2 * Math.PI;
const SERIES_PERIOD = 1; // normalized period

export const SPEC_OPTIONS = [
  { value: 0, label: '양쪽 |c_k| · ∠c_k' },
  { value: 1, label: '한쪽 진폭 2|c_k| (CFS)' },
  { value: 2, label: '전력 |c_k|² (PSD)' },
];

export const hasDuty = (wave) => wave === 'pulse' || wave === 'pulse0';
export const hasJump = (wave) => wave !== 'tri';
export const isUnipolar = (wave) => wave === 'pulse' || wave === 'pulse0' || wave === 'ramp';

const sinc = (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u));

// Exponential Fourier series coefficient c_k of the unit-period wave (complex; c_{-k} = conj c_k).
export function fourierCoefficient(wave, D, k) {
  if (!Number.isSafeInteger(k) || Math.abs(k) > 1000) throw new RangeError('고조파 번호 k 조건을 확인하세요.');
  if (wave === 'pulse' || wave === 'pulse0') {
    if (!Number.isFinite(D) || D <= 0 || D >= 1) throw new RangeError('A,D,k 조건을 확인하세요.');
    const mag = k === 0 ? D : Math.sin(Math.PI * k * D) / (Math.PI * k);
    if (wave === 'pulse') return { re: mag, im: 0 };
    return { re: mag * Math.cos(Math.PI * k * D), im: -mag * Math.sin(Math.PI * k * D) };
  }
  if (wave === 'odd') return { re: 0, im: k !== 0 && k % 2 !== 0 ? -2 / (Math.PI * k) : 0 };
  if (wave === 'ramp') return k === 0 ? { re: 0.5, im: 0 } : { re: 0, im: 1 / (TAU * k) };
  if (wave === 'saw') return k === 0 ? { re: 0, im: 0 } : { re: 0, im: (k % 2 === 0 ? 1 : -1) / (Math.PI * k) };
  if (wave === 'tri') return { re: k % 2 !== 0 ? 4 / (Math.PI * k) ** 2 : 0, im: 0 };
  throw new RangeError('지원하지 않는 파형입니다.');
}

// Coefficients up to harmonic K (k = 1..K), real DC term.
export function seriesCoefficients(wave, D = 0.5, K = MAX_HARMONICS) {
  if (!Number.isInteger(K) || K < 0 || K > 1000) throw new RangeError('고조파 수는 0~1000입니다.');
  const terms = [];
  const dc = fourierCoefficient(wave, D, 0).re;
  for (let k = 1; k <= K; k++) {
    const c = fourierCoefficient(wave, D, k);
    const mag = Math.hypot(c.re, c.im);
    terms.push({ k, amp: 2 * mag, phase: mag === 0 ? 0 : Math.atan2(c.im, c.re) });
  }
  return { dc, terms };
}

// The exact periodic waveform (value at a jump = midpoint). t in periods.
export function exactWaveform(wave, D, t) {
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const frac0 = t - Math.floor(t); // [0, 1)
  if (wave === 'pulse') {
    const frac = t - Math.round(t); // (-1/2, 1/2]
    return near(Math.abs(frac), D / 2) ? 0.5 : Math.abs(frac) < D / 2 ? 1 : 0;
  }
  if (wave === 'pulse0') return near(frac0, 0) || near(frac0, 1) || near(frac0, D) ? 0.5 : frac0 < D ? 1 : 0;
  if (wave === 'odd') return near(frac0, 0) || near(frac0, 1) || near(frac0, 0.5) ? 0 : frac0 < 0.5 ? 1 : -1;
  if (wave === 'ramp') return near(frac0, 0) || near(frac0, 1) ? 0.5 : frac0;
  const frac = t - Math.round(t);
  if (wave === 'saw') return near(Math.abs(frac), 0.5) ? 0 : 2 * frac;
  if (wave === 'tri') return 1 - 4 * Math.abs(frac);
  throw new RangeError('지원하지 않는 파형입니다.');
}

// Jump positions of the wave inside one period [0, 1) (normalized time).
export function jumpPositions(wave, D) {
  if (wave === 'pulse') return [D / 2, 1 - D / 2];
  if (wave === 'pulse0') return [0, D];
  if (wave === 'odd') return [0, 0.5];
  if (wave === 'ramp') return [0];
  if (wave === 'saw') return [0.5];
  return [];
}

export function partialSum(coefficients, N, t) {
  let value = coefficients.dc;
  for (let i = 0; i < N && i < coefficients.terms.length; i++) {
    const { k, amp, phase } = coefficients.terms[i];
    value += amp * Math.cos(TAU * k * t + phase);
  }
  return value;
}

// Tip positions of the tip-to-tail chain at time t: [origin, DC, k=1, ..., k=N].
// The chain is drawn turned by +90 degrees (up = real axis), so the height of the final tip equals partialSum:
// vector k points at angle 2*pi*k*t + phase + pi/2.
export function phasorChain(coefficients, N, t) {
  const points = [{ x: 0, y: 0, k: -1, amp: 0 }, { x: 0, y: coefficients.dc, k: 0, amp: Math.abs(coefficients.dc) }];
  let x = 0;
  let y = coefficients.dc;
  for (let i = 0; i < N && i < coefficients.terms.length; i++) {
    const { k, amp, phase } = coefficients.terms[i];
    const angle = TAU * k * t + phase + Math.PI / 2;
    x += amp * Math.cos(angle);
    y += amp * Math.sin(angle);
    points.push({ x, y, k, amp, angle });
  }
  return points;
}

// Largest value of the partial sum vs. the exact maximum: the Gibbs overshoot, as a fraction of the jump.
const gibbsCache = new Map();
export function gibbsOvershoot(wave, D, N, samples = 2400) {
  const key = `${wave}|${D}|${N}|${samples}`;
  if (gibbsCache.has(key)) return gibbsCache.get(key);
  const coefficients = seriesCoefficients(wave, D, N);
  let peak = -Infinity;
  for (let i = 0; i <= samples; i++) peak = Math.max(peak, partialSum(coefficients, N, (i / samples) * SERIES_PERIOD - 0.5));
  const exactMax = 1; // every wave peaks at 1
  const jump = wave === 'saw' || wave === 'odd' ? 2 : 1;
  const result = { peak, exactMax, fraction: hasJump(wave) ? (peak - exactMax) / jump : 0 };
  if (gibbsCache.size > 200) gibbsCache.clear();
  gibbsCache.set(key, result);
  return result;
}

// Spectrum lines k = 0..K: amplitude of the cosine at k Hz (DC for k = 0).
export function spectrumLines(wave, D, K = MAX_HARMONICS) {
  const { dc, terms } = seriesCoefficients(wave, D, K);
  return [{ k: 0, amp: Math.abs(dc) }, ...terms.map(({ k, amp }) => ({ k, amp }))];
}

// Two-sided line spectrum k = -K..K: c_k, |c_k|, angle c_k (angle only meaningful where |c_k| is not ~0), |c_k|^2.
export function twoSidedSpectrum(wave, D, K = MAX_HARMONICS) {
  const lines = [];
  let peak = 0;
  for (let k = -K; k <= K; k++) peak = Math.max(peak, Math.hypot(...Object.values(fourierCoefficient(wave, D, k))));
  for (let k = -K; k <= K; k++) {
    const c = fourierCoefficient(wave, D, k);
    const mag = Math.hypot(c.re, c.im);
    lines.push({ k, re: c.re, im: c.im, mag, power: mag * mag, phase: mag > 1e-6 * Math.max(peak, 1e-12) ? Math.atan2(c.im, c.re) : null });
  }
  return lines;
}

// Total power <x^2> of the wave over one period (R = 1 ohm normalization) and the share carried by DC + harmonics 1..N.
export const SERIES_POWER = { pulse: null, pulse0: null, odd: 1, ramp: 1 / 3, saw: 1 / 3, tri: 1 / 3 };
export function seriesPower(wave, D, N) {
  const total = hasDuty(wave) ? D : SERIES_POWER[wave];
  let partial = fourierCoefficient(wave, D, 0).re ** 2;
  for (let k = 1; k <= N; k++) {
    const c = fourierCoefficient(wave, D, k);
    partial += 2 * (c.re * c.re + c.im * c.im);
  }
  return { total, partial, fraction: partial / total };
}

// Default T0 [s] and duty per wave (the lecture examples use T0 = 3 s with a 1 s pulse, and T0 = 2 s for the Gibbs figures).
export const SERIES_DEFAULTS = {
  pulse: { T0: 3, D: 1 / 3, N: 7 },
  pulse0: { T0: 3, D: 1 / 3, N: 4 },
  odd: { T0: 2, N: 3 },
  ramp: { T0: 1, N: 7 },
  saw: { T0: 1, N: 7 },
  tri: { T0: 1, N: 7 },
};

// ---- lesson description consumed by the controller -------------------------------------------

// Peak sentence of the live readout. "넘침" is only said when the sum really exceeds the target value 1.
function describePeak(wave, gibbs) {
  if (!hasJump(wave)) return `최댓값 ${formatNumber(gibbs.peak)} (연속 파형, 넘침 없음)`;
  if (gibbs.fraction > GIBBS_VISIBLE) return `최댓값 ${formatNumber(gibbs.peak)} (점프의 ${formatNumber(gibbs.fraction * 100)}% 넘침)`;
  return `최댓값 ${formatNumber(gibbs.peak)} (목표 ${gibbs.exactMax})`;
}

const t0Of = (params) => params.T0 ?? 1;

export const seriesLesson = {
  id: 'series',
  families: SERIES_WAVES,
  initialFamily: 'pulse',
  controls(family) {
    const d = SERIES_DEFAULTS[family];
    const list = [
      { key: 'N', label: 'N 고조파 수', min: 1, max: MAX_HARMONICS, step: 1, initial: d.N, unit: '', integer: true },
      { key: 'T0', label: 'T₀ 주기', min: 0.5, max: 6, step: 0.5, initial: d.T0, unit: 's' },
    ];
    // step 1/60 holds 1/3, 0.1, 0.2, 0.3 and 0.5 exactly (the lecture duty cycles)
    if (hasDuty(family)) list.push({ key: 'D', label: 'D 듀티 (τ/T₀)', min: 3 / 60, max: 57 / 60, step: 1 / 60, initial: d.D, unit: '' });
    list.push(choiceControl('spec', '스펙트럼', SPEC_OPTIONS, 0), freqAxisControl(0));
    return list;
  },
  cursor: (family, params) => {
    const T0 = t0Of(params ?? {});
    return { min: 0, max: 2 * T0, step: 0.01 * T0, initial: 0, unit: 's', symbol: 't', loop: true, rate: 0.25 * T0 };
  },
  scrub: true,
  read(family) {
    if (family === 'pulse') return 'D=τ/T₀가 클수록 DC가 커지고 첫 영점은 k=1/D에 있습니다. 불연속 옆 부분합은 약 9% 넘침(Gibbs)으로 수렴합니다.';
    if (family === 'pulse0') return '펄스를 0<t<DT₀로 옮겨도 |c_k|는 그대로이고 위상만 −πkD씩 선형으로 밀립니다. 시간 이동은 선형 위상입니다.';
    if (family === 'odd') return '홀대칭 구형파는 sin 항만, 홀수 고조파만 남습니다: b_k=4A/(πk). 부분합은 불연속 옆에서 약 9% 넘칩니다(수렴 후에도).';
    if (family === 'ramp') return '톱니 x=t/T₀는 c₀=1/2, c_k=j/(2πk): 순허수라 위상이 π/2로 일정하고 크기는 1/k로 줄어듭니다. 불연속에서 수렴값은 평균입니다.';
    if (family === 'saw') return 'k번째 벡터는 k배 빠르게 돌고 끝점의 높이가 파형입니다. N이 커지면 점프 옆 최댓값은 약 9% 넘침(Gibbs)으로 수렴합니다.';
    return '삼각파는 연속이라 홀수 고조파만으로 빠르게 수렴하고 넘침이 없습니다. 벡터 k는 k배 빠르게 돕니다.';
  },
  formula(family, params = {}) {
    const T0 = t0Of(params);
    const rate = `T₀=${formatNumber(T0)} s, f₀=${formatNumber(1 / T0)} Hz`;
    const common = `x(t)≈c₀+Σ_{k=1}^{N} 2|cₖ| cos(kω₀t+φₖ), φₖ=arg cₖ, ω₀=2π/T₀=2πf₀, ${rate}`;
    const link = 'cₖ=(aₖ−jbₖ)/2; dₖ=2|cₖ|; c_{−k}=conj(c_k)';
    const wave = {
      pulse: 'c₀=D, cₖ=D sinc(kD)=sin(πkD)/(πk)',
      pulse0: 'cₖ=D sinc(kD) e^(−jπkD)',
      odd: 'bₖ=4A/(πk) (k odd); aₖ=0; cₖ=−j2A/(πk)',
      ramp: 'c₀=1/2, cₖ=j/(2πk)',
      saw: 'cₖ=j(−1)^k/(πk)',
      tri: 'cₖ=4/(πk)², k odd',
    }[family];
    return `${common}; ${wave}; ${link}`;
  },
  describe({ family, params }) {
    const D = params.D ?? 0.5;
    const T0 = t0Of(params);
    const coefficients = seriesCoefficients(family, D, params.N);
    const gibbs = gibbsOvershoot(family, D, params.N);
    const tail = describePeak(family, gibbs);
    const f0 = 1 / T0;
    const base = `N=${params.N} · T₀=${formatNumber(T0)} s (f₀=${formatNumber(f0)} Hz, ω₀=${formatNumber(TAU * f0)} rad/s)`;
    if (params.spec === 2) {
      const pw = seriesPower(family, D, params.N);
      return `${base} · 전력 ${formatNumber(pw.partial)} / ${formatNumber(pw.total)} (${formatNumber(pw.fraction * 100)}%) · DC ${formatNumber(coefficients.dc ** 2)}`;
    }
    return `${base} · 합성 ${coefficients.terms.slice(0, params.N).filter((t) => t.amp > 1e-9).length}개 성분 · ${tail}`;
  },
};
