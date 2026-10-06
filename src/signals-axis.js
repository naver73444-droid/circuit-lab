// Pure conventions shared by the signals lessons: frequency-axis choice (f [Hz] | omega [rad/s]),
// choice controls (select instead of a slider), and DT periodicity N = k/F0.
// Course convention: X(w) = integral x(t) e^{-jwt} dt with 1/2pi on the inverse; X(f) = X(w) at w = 2 pi f.
import { formatNumber } from './signals-util.js';

const TAU = 2 * Math.PI;

// A select-type control: the value is the index of the chosen option (0, 1, ...).
export function choiceControl(key, label, options, initial = 0) {
  return { key, label, min: 0, max: options.length - 1, step: 1, initial, unit: '', integer: true, options };
}

export const AXIS_OPTIONS = [{ value: 0, label: 'f [Hz]' }, { value: 1, label: 'ω [rad/s]' }];
export const freqAxisControl = (initial = 0) => choiceControl('axis', '주파수 축', AXIS_OPTIONS, initial);
export const isOmega = (axis) => axis === 1;

// Frequency [Hz] <-> value on the chosen axis.
export const toAxis = (hz, axis) => (isOmega(axis) ? TAU * hz : hz);
export const fromAxis = (value, axis) => (isOmega(axis) ? value / TAU : value);
export const axisSymbol = (axis) => (isOmega(axis) ? 'ω' : 'f');
export const axisUnit = (axis) => (isOmega(axis) ? 'rad/s' : 'Hz');
// "X(f)" / "X(ω)" style names.
export const spectrumName = (axis, name = 'X') => `${name}(${axisSymbol(axis)})`;

export function formatFreq(hz, axis) {
  return `${formatNumber(toAxis(hz, axis))} ${axisUnit(axis)}`;
}

// Smallest fraction p/q (q <= maxDen) within tol of x, or null.
export function rationalApprox(x, maxDen = 1000, tol = 1e-10) {
  if (!Number.isFinite(x)) return null;
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(x * q);
    if (Math.abs(x - p / q) <= tol) return { p, q };
  }
  return null;
}

// Fundamental period of x[n] = cos(2 pi F0 n + theta): N = k/F0 with the smallest integer k that makes N an integer.
// F0 = p/q (reduced) gives N = q, k = p; an irrational F0 means no period. F0 = 0 is the constant (N = 1).
export function dtPeriod(F0) {
  if (Math.abs(F0) < 1e-12) return { N: 1, k: 0, periodic: true };
  const r = rationalApprox(Math.abs(F0), 500, 1e-10);
  if (!r) return { N: null, k: null, periodic: false };
  return { N: r.q, k: r.p, periodic: true };
}

// DT frequencies from a CT tone sampled at fs: Omega0 = w0 Ts = 2 pi f0/fs, F0 = f0/fs (Ch 1.4 relation).
export const normalizedFrequency = (f0, fs) => ({ F0: f0 / fs, Omega0: (TAU * f0) / fs });
