// Ch.13 models: coupled coils, T/π equivalents, ideal transformer, autotransformer, 3-phase bank. Closed forms are written out here, not taken from the module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coupledCoils, tPiEquivalents, mutualInductance, idealTransformer, idealRating, autotransformer, threePhaseBank, BANK_CONNECTIONS } from '../../../src/circuit-course-coupled.js';
import { magnitude, multiply, divide, add, sub, waveSample } from '../../../src/circuit-course-model.js';

const near = (actual, expected, tolerance = 1e-9, what = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, what + ' ' + actual + ' ≠ ' + expected + ' ± ' + tolerance);
const z = (re, im) => ({ re, im });
const zn = (a, b, tol = 1e-9, what = '') => { near(a.re, b.re, tol, what + ' re'); near(a.im, b.im, tol, what + ' im'); };
const J = (w, l) => z(0, w * l);
const ok = r => { assert.equal(r.status, 'valid', r.reason); return r; };

const coupledCase = { dots: 'opposite', frequencyHz: 4 / (2 * Math.PI), l1: 5, l2: 4, m: 2.5, z1: z(10, 0), zl: z(0, -4), voltageRms: 60 / Math.SQRT2, voltageDeg: 30 };

test('coupled coils: both mesh equations hold (Cramer), for same and opposite dots', () => {
  for (const dots of ['same', 'opposite']) {
    const s = dots === 'same' ? 1 : -1, w = 4, V = z(60 / Math.SQRT2 * Math.cos(Math.PI / 6), 60 / Math.SQRT2 * Math.sin(Math.PI / 6));
    const r = ok(coupledCoils({ ...coupledCase, dots }));
    const a11 = add(z(10, 0), J(w, 5)), a12 = z(0, -s * w * 2.5), a21 = z(0, -s * w * 2.5), a22 = add(z(0, -4), J(w, 4));
    const det = sub(multiply(a11, a22), multiply(a12, a21));
    zn(r.I1, divide(multiply(V, a22), det), 1e-9, dots + ' I1'); zn(r.I2, divide(sub(z(0, 0), multiply(a21, V)), det), 1e-9, dots + ' I2');
  }
  const same = ok(coupledCoils({ ...coupledCase, dots: 'same' })), opposite = ok(coupledCoils({ ...coupledCase, dots: 'opposite' }));
  zn(same.I1, opposite.I1, 1e-12, 'I1 does not depend on the dot side'); zn(same.I2, { re: -opposite.I2.re, im: -opposite.I2.im }, 1e-12, 'I2 flips sign');
  zn(same.reflected, opposite.reflected, 1e-12, 'reflected impedance has M² only');
  zn(same.I2into, opposite.I2, 1e-12, 'into-reference is the opposite sign of the clockwise mesh current');
  near(same.k, 2.5 / Math.sqrt(20), 1e-12);
});

test('coupled coils: example 13.1 and 13.3 numbers; w(1 s) = 20.73 J', () => {
  const a = ok(coupledCoils({ frequencyHz: 1 / (2 * Math.PI), l1: 5, l2: 6, m: 3, dots: 'same', z1: z(0, -4), zl: z(12, 0), voltageRms: 12 }));
  near(magnitude(a.I1), 13.0158, 5e-4); near(Math.atan2(a.I1.im, a.I1.re) * 180 / Math.PI, -49.399, 5e-3); near(magnitude(a.I2), 2.9104, 5e-4);
  zn(a.I1, multiply(z(2, -4), a.I2), 1e-9, 'I1=(2−j4)I2 from the lecture algebra');
  const b = ok(coupledCoils({ ...coupledCase, dots: 'opposite' }));
  near(b.energy(1), 20.7366, 1e-3);
  zn(b.I1, multiply(z(-1.2, 0), b.I2), 1e-9, 'I1=−1.2 I2 (lecture mesh 2)');
  assert.ok(b.checks.every(c => c.pass));
});

test('coupled coils: energy sign — dw/dt equals v1 i1 + v2 i2 with the into-convention coil voltages (sign of the M i1 i2 term)', () => {
  for (const dots of ['same', 'opposite']) {
    const r = ok(coupledCoils({ ...coupledCase, dots })), sigma = dots === 'same' ? 1 : -1, f = r.frequencyHz, h = 1e-7;
    const i1 = t => waveSample(r.I1, f, t), i2 = t => -waveSample(r.I2, f, t); // into-convention secondary current
    for (const t of [0.13, 0.4, 0.9, 1.7]) {
      const d = fn => (fn(t + h) - fn(t - h)) / (2 * h);
      const v1 = 5 * d(i1) + sigma * 2.5 * d(i2), v2 = 4 * d(i2) + sigma * 2.5 * d(i1);
      near(d(r.energy), v1 * i1(t) + v2 * i2(t), 2e-5 * Math.max(1, Math.abs(v1 * i1(t))), dots + ' t=' + t);
    }
  }
});

test('coupled coils: k limits and degenerate cases', () => {
  assert.equal(coupledCoils({ ...coupledCase, m: 4.5 }).status, 'invalid');
  assert.equal(coupledCoils({ ...coupledCase, couplingMode: 'k', k: 1.01 }).status, 'invalid');
  assert.equal(coupledCoils({ ...coupledCase, couplingMode: 'k', k: -0.1 }).status, 'invalid');
  near(mutualInductance({ l1: 4, l2: 9, couplingMode: 'k', k: 0.5 }).M, 3);
  near(mutualInductance({ l1: 4, l2: 9, m: 6 }).k, 1);
  const none = ok(coupledCoils({ ...coupledCase, m: 0 })); near(magnitude(none.I2), 0, 1e-15); near(none.reflected.re, 0, 1e-15);
  const perfect = ok(coupledCoils({ ...coupledCase, couplingMode: 'k', k: 1 })); assert.equal(perfect.pi, null); assert.match(perfect.piReason, /k=1/);
  near(perfect.seriesAiding, 5 + 4 + 2 * Math.sqrt(20), 1e-12); near(perfect.seriesOpposing, 5 + 4 - 2 * Math.sqrt(20), 1e-12);
  for (const bad of [{ l1: 0 }, { frequencyHz: 0 }, { voltageRms: -1 }, { dots: 'x' }, { zl: z(NaN, 0) }]) assert.equal(coupledCoils({ ...coupledCase, ...bad }).status, 'invalid');
});

test('T and π equivalents reproduce the two-port impedance matrix (13.5, 13.6)', () => {
  const t13_5 = tPiEquivalents({ l1: 10, l2: 4, M: 2, sigma: 1 });
  assert.deepEqual(t13_5.T, { La: 8, Lb: 2, Lc: 2 });
  const t13_6 = tPiEquivalents({ l1: 8, l2: 5, M: 1, sigma: -1 });
  assert.deepEqual(t13_6.T, { La: 9, Lb: 6, Lc: -1 });
  for (const [l1, l2, M, sigma] of [[10, 4, 2, 1], [3, 7, 1.5, -1], [0.2, 0.5, 0.25, 1]]) {
    const { T, pi } = tPiEquivalents({ l1, l2, M, sigma }), m = sigma * M;
    // T: Z = jω [[La+Lc, Lc],[Lc, Lb+Lc]] must equal jω [[L1, m],[m, L2]]
    near(T.La + T.Lc, l1, 1e-12); near(T.Lb + T.Lc, l2, 1e-12); near(T.Lc, m, 1e-12);
    // π: Y = (jω)^-1 [[1/LA+1/LC, −1/LC],[−1/LC, 1/LB+1/LC]] must be the inverse of [[L1, m],[m, L2]]
    const det = l1 * l2 - m * m, inv = [[l2 / det, -m / det], [-m / det, l1 / det]];
    near(1 / pi.LA + 1 / pi.LC, inv[0][0], 1e-9 * Math.abs(inv[0][0]) + 1e-12); near(-1 / pi.LC, inv[0][1], 1e-9 * Math.abs(inv[0][1]) + 1e-12); near(1 / pi.LB + 1 / pi.LC, inv[1][1], 1e-9 * Math.abs(inv[1][1]) + 1e-12);
  }
  near(t13_5.pi.LA, 18, 1e-12); near(t13_5.pi.LB, 4.5, 1e-12); near(t13_5.pi.LC, 18, 1e-12);
  const c = ok(coupledCoils({ frequencyHz: 1 / (2 * Math.PI), l1: 8, l2: 5, m: 1, dots: 'opposite', z1: z(4, 0), zl: z(10, 0), voltageRms: 6, voltageDeg: 90 }));
  near(magnitude(c.I2into), 0.06, 1e-4); near(Math.atan2(c.I2into.im, c.I2into.re) * 180 / Math.PI, 90.573, 1e-3);
  near(magnitude(c.Vo), 0.6, 5e-4);
});

test('ideal transformer: the four dot / reference cases give ±n and ±1/n, S1=S2, Zin=ZL/n², no power is kept', () => {
  const base = { turns1: 100, turns2: 250, z1: z(3, -2), zl: z(20, 15), voltageRms: 120, voltageDeg: 15 };
  for (const dots of ['same', 'opposite']) for (const i2Direction of ['out', 'in']) {
    const r = ok(idealTransformer({ ...base, dots, i2Direction })), n = 2.5, s = dots === 'same' ? 1 : -1;
    zn(r.V2, { re: s * n * r.V1.re, im: s * n * r.V1.im }, 1e-9, 'V2/V1=±n');
    const ratio = divide(r.I2, r.I1), expected = (i2Direction === 'out' ? s : -s) / n;
    near(ratio.re, expected, 1e-12); near(ratio.im, 0, 1e-12);
    zn(r.zin, { re: 20 / n ** 2, im: 15 / n ** 2 }, 1e-12);
    zn(r.S1, r.S2, 1e-9, 'S1=S2');
    near(r.S1.re, magnitude(r.loadCurrent) ** 2 * 20, 1e-9, 'all real power ends in ZL');
    near(r.Ssource.re, magnitude(r.I1) ** 2 * 3 + r.S1.re, 1e-9, 'source = Z1 + transformer');
    assert.equal(r.step, '승압');
  }
  assert.equal(idealTransformer({ ...base, dots: 'same', i2Direction: 'up' }).status, 'invalid');
  // ZL=0 is a short circuit on the secondary: fine while Z1+ZL/n² is not zero (see review-fixes.test.mjs); only the total 0 is rejected
  assert.equal(idealTransformer({ ...base, dots: 'same', i2Direction: 'out', zl: z(0, 0) }).status, 'valid');
  assert.equal(idealTransformer({ ...base, dots: 'same', i2Direction: 'out', zl: z(0, 0), z1: z(0, 0) }).status, 'invalid');
  assert.equal(idealTransformer({ ...base, dots: 'same', i2Direction: 'out', turns1: 0 }).status, 'invalid');
  assert.equal(ok(idealTransformer({ ...base, turns2: 100, dots: 'same', i2Direction: 'out' })).step, '격리');
  assert.equal(ok(idealTransformer({ ...base, turns2: 50, dots: 'same', i2Direction: 'out' })).step, '강압');
});

test('rating (13.7) and autotransformer: ratios from the lecture, V1I1 = V2I2, gain over a two-winding transformer', () => {
  const r = idealRating({ v1: 2400, v2: 120, kva: 9.6, turns2: 50 });
  near(r.n, 0.05, 1e-12); near(r.turns1, 1000, 1e-9); near(r.i1, 4, 1e-12); near(r.i2, 80, 1e-12); assert.equal(r.step, '강압');
  for (const [mode, n1, n2] of [['down', 100, 100], ['down', 30, 70], ['up', 100, 5], ['up', 50, 50]]) {
    const a = autotransformer({ mode, turns1: n1, turns2: n2, v1Rms: 240, loadCurrentRms: 10 });
    assert.equal(a.status, 'valid');
    near(a.v2 / 240, mode === 'down' ? n2 / (n1 + n2) : (n1 + n2) / n1, 1e-12, mode + ' V2/V1');
    near(a.i1 * 240, a.i2 * a.v2, 1e-9, 'lossless');
    near(a.apparentVA, a.v2 * 10, 1e-9);
    assert.ok(a.gain >= 1, 'autotransformer rating gain ≥ 1');
  }
  const ex13_10 = autotransformer({ mode: 'up', turns1: 100, turns2: 5, v1Rms: 240, loadCurrentRms: 4 });
  near(ex13_10.v2, 252, 1e-9); near(ex13_10.i1, 4.2, 1e-9); near(ex13_10.gain, 21, 1e-9);
  assert.equal(autotransformer({ mode: 'sideways', turns1: 1, turns2: 1, v1Rms: 1, loadCurrentRms: 1 }).status, 'invalid');
});

test('3-phase bank: lecture line ratios for the four connections, winding voltage ratio = n, line power is conserved, 13.12', () => {
  const n = 5;
  const lecture = { 'Y-Y': [n, 1 / n], 'delta-delta': [n, 1 / n], 'Y-delta': [n / Math.sqrt(3), Math.sqrt(3) / n], 'delta-Y': [Math.sqrt(3) * n, 1 / (Math.sqrt(3) * n)] };
  for (const connection of Object.keys(BANK_CONNECTIONS)) for (const known of ['primary', 'secondary']) {
    const r = ok(threePhaseBank({ connection, n, known, lineVoltage: 1000, totalVA: 60000 }));
    near(r.vs / r.vp, lecture[connection][0], 1e-12, connection + ' VLs/VLp'); near(r.is / r.ip, lecture[connection][1], 1e-12, connection + ' ILs/ILp');
    near(Math.sqrt(3) * r.vp * r.ip, 60000, 1e-6); near(Math.sqrt(3) * r.vs * r.is, 60000, 1e-6);
    near(r.secondaryWinding.v / r.primaryWinding.v, n, 1e-12, connection + ' winding ratio is n');
    near(r.primaryWinding.v * r.primaryWinding.i * 3, 60000, 1e-6, 'three windings carry the rating');
    near(r.perUnitVA, 20000, 1e-9);
  }
  const ex = ok(threePhaseBank({ connection: 'Y-delta', n: 5, known: 'secondary', lineVoltage: 240, totalVA: 42000 }));
  near(ex.is, 101.04, 5e-3); near(ex.ip, 291.67, 5e-3); near(ex.vp, 83.14, 5e-3); near(ex.perUnitVA, 14000, 1e-9); assert.equal(ex.shiftDeg, -30);
  assert.equal(threePhaseBank({ connection: 'Y-Z', n: 5, known: 'primary', lineVoltage: 1, totalVA: 1 }).status, 'invalid');
  assert.equal(threePhaseBank({ connection: 'Y-Y', n: 5, known: 'both', lineVoltage: 1, totalVA: 1 }).status, 'invalid');
  assert.equal(threePhaseBank({ connection: 'Y-Y', n: 0, known: 'primary', lineVoltage: 1, totalVA: 1 }).status, 'invalid');
});
