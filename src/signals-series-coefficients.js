// Fourier series in its three forms (pure): one row per harmonic k of TFS a_k, b_k, EFS c_k, |c_k|, angle c_k and CFS d_k, phi_k.
//   TFS x_N(t) = a0 + sum_{k=1..N} [a_k cos(k w0 t) + b_k sin(k w0 t)], a0 = mean (not a0/2)
//   k >= 1: a_k = 2 Re c_k, b_k = -2 Im c_k, d_k = 2|c_k|, phi_k = atan2(-b_k, a_k) = arg c_k
//   k = 0:  a0 = c0 = d0; b0 and phi0 are undefined (null), the DC term is never doubled.
// Coefficients come from the existing EFS c_k (normalized amplitude, period-independent: T0 only scales the frequency axis).
import { MAX_HARMONICS, fourierCoefficient } from './signals-series-model.js';

export const TABLE_ROWS = 10; // the table lists k = 0..min(N, 10); the bars use all 25 harmonics
const PHASE_HIDE = 1e-6; // phase is undefined where |c_k| <= 1e-6 * the largest |c_k| (same rule as twoSidedSpectrum)

const peakCache = new Map();
function peakMagnitude(wave, D) {
  const key = `${wave}|${D}`;
  if (peakCache.has(key)) return peakCache.get(key);
  let peak = 0;
  for (let k = 0; k <= MAX_HARMONICS; k++) {
    const c = fourierCoefficient(wave, D, k);
    peak = Math.max(peak, Math.hypot(c.re, c.im));
  }
  if (peakCache.size > 200) peakCache.clear();
  peakCache.set(key, peak);
  return peak;
}

// Angle of c in (-pi, pi]: a negative real coefficient reads +pi (atan2(-0, x<0) would give -pi).
const foldedAngle = (c) => {
  const angle = Math.atan2(c.im, c.re);
  return angle <= -Math.PI ? Math.PI : angle;
};

// One row for harmonic k (integer 0..25). Values keep full precision; `+ 0` only turns a -0 into 0.
export function coefficientRow(wave, D, k) {
  if (!Number.isInteger(k) || k < 0 || k > MAX_HARMONICS) throw new RangeError(`고조파 번호 k는 0~${MAX_HARMONICS}의 정수입니다.`);
  const c = fourierCoefficient(wave, D, k);
  const mag = Math.hypot(c.re, c.im);
  const phase = mag > PHASE_HIDE * Math.max(peakMagnitude(wave, D), 1e-12) ? foldedAngle(c) : null;
  if (k === 0) return { k, a: c.re + 0, b: null, c: { re: c.re, im: c.im }, mag, phase, d: c.re + 0, phi: null };
  return { k, a: 2 * c.re + 0, b: -2 * c.im + 0, c: { re: c.re, im: c.im }, mag, phase, d: 2 * mag, phi: phase };
}

// Table rows k = 0..min(N, 10) for N harmonics (integer 1..25).
export function coefficientRows(wave, D, N) {
  if (!Number.isInteger(N) || N < 1 || N > MAX_HARMONICS) throw new RangeError(`고조파 수 N은 1~${MAX_HARMONICS}의 정수입니다.`);
  return Array.from({ length: Math.min(N, TABLE_ROWS) + 1 }, (_, k) => coefficientRow(wave, D, k));
}
