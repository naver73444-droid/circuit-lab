// Ch.14 series and parallel RLC resonance (Alexander & Sadiku §14.5–14.6, Table 14.4) and the design inverses used in the exercises.
// Pure, no DOM. Amplitudes are whatever the caller passes (the tool passes RMS); every ratio here is basis-free.

/**
 * circuit 'series' (voltage source, current response) or 'parallel' (current source, voltage response):
 * { w0, f0, B, Q, w1, w2, approx: [ω0 − B/2, ω0 + B/2], at(ω) → { z (series Z or parallel 1/Y), response, vR, vL, vC (series) | iR, iL, iC (parallel), p } }.
 */
export function resonance({ circuit, R, L, C, source }) {
  for (const [name, x] of [['R', R], ['L', L], ['C', C]]) if (!(Number.isFinite(x) && x > 0)) throw new RangeError(name + '는 0보다 큰 값이어야 합니다.');
  const w0 = 1 / Math.sqrt(L * C), series = circuit !== 'parallel';
  const half = series ? R / (2 * L) : 1 / (2 * R * C), B = 2 * half, Q = w0 / B, root = Math.sqrt(half * half + w0 * w0);
  function at(w) {
    if (series) {
      const x = w * L - 1 / (w * C), m2 = R * R + x * x, i = { re: source * R / m2, im: -source * x / m2 }; // I = V / (R + jX)
      return { z: { re: R, im: x }, response: Math.hypot(i.re, i.im), current: i, vR: Math.hypot(i.re, i.im) * R, vL: Math.hypot(i.re, i.im) * w * L, vC: Math.hypot(i.re, i.im) / (w * C),
        p: (i.re * i.re + i.im * i.im) * R };
    }
    const b = w * C - 1 / (w * L), m2 = 1 / (R * R) + b * b, v = { re: source / R / m2, im: -source * b / m2 }; // V = I / (G + jB)
    const vm = Math.hypot(v.re, v.im);
    return { z: { re: 1 / R / m2, im: -b / m2 }, response: vm, voltage: v, iR: vm / R, iL: vm / (w * L), iC: vm * w * C, p: vm * vm / R };
  }
  return { circuit: series ? 'series' : 'parallel', R, L, C, source, w0, f0: w0 / (2 * Math.PI), B, Q, w1: root - half, w2: root + half, approx: [w0 - B / 2, w0 + B / 2], at };
}

/** f0 · L → C (exercise style "choose C for resonance at f0"). */
export const capacitorForResonance = (f0, L) => 1 / ((2 * Math.PI * f0) ** 2 * L);
/** ω0 · B · R → L · C (series: B = R/L; parallel: B = 1/(RC)). */
export function designFromBand(circuit, w0, B, R) {
  if (circuit === 'parallel') { const C = 1 / (R * B); return { L: 1 / (w0 * w0 * C), C }; }
  const L = R / B;
  return { L, C: 1 / (w0 * w0 * L) };
}
