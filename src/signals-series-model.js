// Lesson 3 (pure): Fourier series as a chain of rotating phasors, T0 = 1 s (f0 = 1 Hz, so harmonic k is k Hz).
// Every wave is written as x_N(t) = dc + sum_{k=1..N} amp_k cos(2*pi*k*f0*t + phase_k).
import { pulseSeriesCoefficient } from './signals-course-model.js';
import { formatNumber } from './signals-util.js';

export const SERIES_WAVES = [
  { value: 'pulse', label: '구형파 (듀티 D)' },
  { value: 'saw', label: '톱니파' },
  { value: 'tri', label: '삼각파' },
];
export const MAX_HARMONICS = 25;
const SERIES_PERIOD = 1; // T0 in seconds; f0 = 1 Hz
// The overshoot is judged against the jump once it is clearly there; below this fraction the peak is just "the maximum".
const GIBBS_VISIBLE = 0.005;
const TAU = 2 * Math.PI;

const hasDuty = (wave) => wave === 'pulse';
export const hasJump = (wave) => wave === 'pulse' || wave === 'saw';

// Coefficients up to harmonic K (k = 1..K), real DC term.
export function seriesCoefficients(wave, D = 0.5, K = MAX_HARMONICS) {
  const terms = [];
  let dc = 0;
  if (!Number.isInteger(K) || K < 0 || K > 1000) throw new RangeError('고조파 수는 0~1000입니다.');
  if (wave === 'pulse') {
    dc = pulseSeriesCoefficient(1, D, 0);
    for (let k = 1; k <= K; k++) {
      const c = pulseSeriesCoefficient(1, D, k); // real: even pulse
      terms.push({ k, amp: 2 * Math.abs(c), phase: c < 0 ? Math.PI : 0 });
    }
  } else if (wave === 'saw') {
    // 2t on (-1/2, 1/2): sum 2(-1)^(k+1)/(pi k) sin(2 pi k t)
    for (let k = 1; k <= K; k++) terms.push({ k, amp: 2 / (Math.PI * k), phase: k % 2 ? -Math.PI / 2 : Math.PI / 2 });
  } else if (wave === 'tri') {
    // 1-4|t|: odd harmonics 8/(pi k)^2 cos(2 pi k t)
    for (let k = 1; k <= K; k++) terms.push({ k, amp: k % 2 ? 8 / (Math.PI * k) ** 2 : 0, phase: 0 });
  } else {
    throw new RangeError('지원하지 않는 파형입니다.');
  }
  return { dc, terms };
}

// The exact periodic waveform (midpoint at jumps).
export function exactWaveform(wave, D, t) {
  const frac = t - Math.round(t); // (-1/2, 1/2]
  if (wave === 'pulse') {
    const edge = Math.abs(Math.abs(frac) - D / 2) < 1e-12;
    return edge ? 0.5 : Math.abs(frac) < D / 2 ? 1 : 0;
  }
  if (wave === 'saw') return Math.abs(Math.abs(frac) - 0.5) < 1e-12 ? 0 : 2 * frac;
  if (wave === 'tri') return 1 - 4 * Math.abs(frac);
  throw new RangeError('지원하지 않는 파형입니다.');
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
  const exactMax = 1; // all three waves peak at 1
  const jump = wave === 'saw' ? 2 : 1;
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

// ---- lesson description consumed by the controller -------------------------------------------

// Peak sentence of the live readout. "넘침" is only said when the sum really exceeds the target value 1.
function describePeak(wave, gibbs) {
  if (!hasJump(wave)) return `최댓값 ${formatNumber(gibbs.peak)} (연속 파형, 넘침 없음)`;
  if (gibbs.fraction > GIBBS_VISIBLE) return `최댓값 ${formatNumber(gibbs.peak)} (점프의 ${formatNumber(gibbs.fraction * 100)}% 넘침)`;
  return `최댓값 ${formatNumber(gibbs.peak)} (목표 ${gibbs.exactMax})`;
}

export const seriesLesson = {
  id: 'series',
  families: SERIES_WAVES,
  initialFamily: 'pulse',
  controls(family) {
    const list = [{ key: 'N', label: 'N 고조파 수', min: 1, max: MAX_HARMONICS, step: 1, initial: 7, unit: '', integer: true }];
    if (hasDuty(family)) list.push({ key: 'D', label: 'D 듀티', min: 0.05, max: 0.95, step: 0.01, initial: 0.5, unit: '' });
    return list;
  },
  cursor: () => ({ min: 0, max: 2, step: 0.01, initial: 0, unit: 's', symbol: 't', loop: true, rate: 0.25 }),
  scrub: true,
  read(family) {
    return hasJump(family)
      ? 'k번째 벡터는 k배 빠르게 돌고 끝점의 높이가 파형입니다. N이 커지면 점프 옆 최댓값은 약 9% 넘침(Gibbs)으로 수렴합니다.'
      : '삼각파는 연속이라 홀수 고조파만으로 빠르게 수렴하고 넘침이 없습니다. 벡터 k는 k배 빠르게 돕니다.';
  },
  formula(family, { D = 0.5 } = {}) {
    const common = 'x(t)≈c₀+Σ_{k=1}^{N} 2|cₖ| cos(2πk f₀ t+φₖ), φₖ=arg cₖ, T₀=1 s, f₀=1 Hz';
    if (family === 'pulse') return `${common}; c₀=D, cₖ=sin(πkD)/(πk)`;
    if (family === 'saw') return `${common}; cₖ=j(−1)^k/(πk)`;
    return `${common}; cₖ=4/(πk)², k odd`;
  },
  describe({ family, params }) {
    const coefficients = seriesCoefficients(family, params.D ?? 0.5, params.N);
    const gibbs = gibbsOvershoot(family, params.D ?? 0.5, params.N);
    const tail = describePeak(family, gibbs);
    return `N=${params.N} · 합성 ${coefficients.terms.slice(0, params.N).filter((t) => t.amp > 1e-9).length}개 성분 · ${tail}`;
  },
};
