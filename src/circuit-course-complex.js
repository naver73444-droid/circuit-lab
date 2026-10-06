// Small complex-number toolkit for the course models: linear solve, helpers, display basis. Pure, no DOM.
import { add, sub, multiply, divide, conjugate, scale, magnitude, polar } from './circuit-course-model.js';

const ONE = Object.freeze({ re: 1, im: 0 });
export const cz = (re, im = 0) => ({ re, im });
export const neg = a => ({ re: -a.re, im: -a.im });
export const sum = list => list.reduce(add, { re: 0, im: 0 });
export const inverse = a => divide(ONE, a);
export const sqrtComplex = a => {
  const m = magnitude(a);
  if (m === 0) return { re: 0, im: 0 };
  const angle = Math.atan2(a.im + 0, a.re) / 2, r = Math.sqrt(m); // +0 turns a negative zero imaginary part into +0 (principal root of −4 is +2j)
  return { re: r * Math.cos(angle), im: r * Math.sin(angle) };
};
export { add, sub, multiply, divide, conjugate, scale, magnitude, polar };

// Gaussian elimination with partial pivoting for a small complex system A x = b.
export function solveLinear(matrix, rhs) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row.map(v => ({ ...v })), { ...rhs[i] }]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (magnitude(a[r][col]) > magnitude(a[pivot][col])) pivot = r;
    if (magnitude(a[pivot][col]) < 1e-300) throw new RangeError('연립방정식이 특이합니다 (해가 없거나 무한히 많음).');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = divide(a[r][col], a[col][col]);
      for (let c = col; c <= n; c++) a[r][c] = sub(a[r][c], multiply(factor, a[col][c]));
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = a[r][n];
    for (let c = r + 1; c < n; c++) acc = sub(acc, multiply(a[r][c], x[c]));
    x[r] = divide(acc, a[r][r]);
  }
  return x;
}

// Amplitude display basis: internal phasors are RMS; "peak" shows √2 times larger numbers.
export const basisFactor = basis => (basis === 'peak' ? Math.SQRT2 : 1);
// A phasor that is zero up to rounding noise relative to `reference` is snapped to exactly 0 (its angle is meaningless).
export const snap = (z, reference) => (magnitude(z) <= 1e-9 * Math.max(reference, 1e-300) ? { re: 0, im: 0 } : z);

// Relative/absolute comparison used by the textbook expectation checks.
export function closeTo(actual, expected, relTol = 1e-3, absTol = 0) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) <= Math.max(absTol, relTol * Math.abs(expected));
}
