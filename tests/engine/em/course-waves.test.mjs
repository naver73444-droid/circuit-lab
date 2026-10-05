import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-waves.js';
const [wave, boundary] = EXPERIMENTS;
const waveParams = { epsilonR: 4, muR: 1, frequency: 1e8, amplitude: 10, phase: 0, time: 0 };
const interfaceParams = { epsilonR1: 1, muR1: 1, epsilonR2: 4, muR2: 1, frequency: 1e8, amplitude: 10, phase: 0, time: 0 };
const scalar = (r, key) => r.scalars.find(s => s.key === key)?.value;
const close = (actual, expected, rel = 1e-11, absolute = 1e-12) => {
  assert.ok(Number.isFinite(actual), 'nonfinite actual');
  assert.ok(Math.abs(actual - expected) <= absolute + rel * Math.abs(expected), actual + ' vs ' + expected);
};
const excluded = (r, status) => { assert.equal(r.status, status, r.reason); assert.deepEqual(r.vectors, {}); assert.deepEqual(r.scalars, []); assert.ok(r.reason); };
function finite(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(finite);
}
test('definitions preserve exact SI API, distinct IDs and peak/cos provenance', () => {
  assert.deepEqual(EXPERIMENTS.map(e => e.id), ['wave-medium', 'wave-interface-normal']);
  for (const e of EXPERIMENTS) {
    for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(e[key].length);
    for (const p of e.parameters) assert.ok(Number.isFinite(p.initial) && p.displayScale > 0);
    assert.equal(e.view.kind, 'profile');
    const r = e.evaluate(Object.fromEntries(e.parameters.map(p => [p.key, p.initial])), e.probeDefault);
    assert.equal(r.status, 'valid'); finite(r);
    r.phasors.forEach(p => assert.match(p.reference, /peak\/cos.*e\^/));
  }
});
test('literal material constants, impedance, speed, beta, field and energy fixture', () => {
  const r = wave.evaluate(waveParams, [0, 0, 0]);
  assert.equal(r.status, 'valid');
  close(scalar(r, 'impedance'), 188.365156706, 3e-10);
  close(scalar(r, 'velocity'), 149896229, 3e-10);
  close(scalar(r, 'beta'), 4.19169004390, 3e-10);
  close(r.vectors.E[0], 10); close(r.vectors.H[1], .053088374595802533, 3e-10);
  close(r.vectors.D[0], 3.54167512752e-10, 1e-11, 1e-22);
  close(r.vectors.B[1], 6.67128190365e-8, 3e-10, 1e-18);
  close(scalar(r, 'averagePoyntingZ'), .265441872979012665, 3e-10);
  close(scalar(r, 'averageEnergyDensity'), 1.77083756376e-9, 1e-11, 1e-21);
});
test('forward phase is negative in space, positive time; E/H orthogonal and flow positive', () => {
  const origin = wave.evaluate(waveParams, [0, 0, 0]), wavelength = scalar(origin, 'wavelength');
  const r = wave.evaluate(waveParams, [2, -3, wavelength / 4]);
  close(r.phasors[0].re, 0); close(r.phasors[0].im, -10);
  const t = wave.evaluate({ ...waveParams, time: 1 / (4e8) }, [0, 0, wavelength / 4]);
  close(t.vectors.E[0], 10); close(t.vectors.H[1], .053088374595802533, 3e-10);
  close(t.vectors.E.reduce((s, x, i) => s + x * t.vectors.H[i], 0), 0);
  assert.ok(scalar(t, 'poyntingZ') > 0);
  assert.deepEqual(r, wave.evaluate(waveParams, [0, 0, wavelength / 4])); // transverse homogeneity
});
test('normal incidence independent -1/3,2/3,1/9,8/9 and reverse sign fixtures', () => {
  const r = boundary.evaluate(interfaceParams, [0, 0, -1e-10]);
  close(scalar(r, 'gammaE'), -1 / 3); close(scalar(r, 'transmissionE'), 2 / 3);
  close(scalar(r, 'reflectance'), 1 / 9); close(scalar(r, 'transmittance'), 8 / 9);
  const reverse = boundary.evaluate({ ...interfaceParams, epsilonR1: 4, epsilonR2: 1 }, [0, 0, .1]);
  close(scalar(reverse, 'gammaE'), 1 / 3); close(scalar(reverse, 'transmissionE'), 4 / 3);
  close(scalar(reverse, 'reflectance') + scalar(reverse, 'transmittance'), 1);
});
test('one-sided E/H continuity with material D/B and exact boundary exclusion', () => {
  const left = boundary.evaluate(interfaceParams, [0, 0, -1e-9]), right = boundary.evaluate(interfaceParams, [0, 0, 1e-9]);
  close(left.vectors.E[0], 20 / 3); close(right.vectors.E[0], 20 / 3);
  close(left.vectors.H[1], .035392249730535022, 3e-10);
  close(left.vectors.H[1], right.vectors.H[1]);
  close(right.vectors.D[0] / left.vectors.D[0], 4);
  excluded(boundary.evaluate(interfaceParams, [0, 0, 0]), 'boundary');
});
test('impedance matching despite differing propagation speeds and magnetic materials', () => {
  const r = boundary.evaluate({ ...interfaceParams, epsilonR2: 4, muR2: 4 }, [0, 0, .1]);
  close(scalar(r, 'gammaE'), 0); close(scalar(r, 'transmissionE'), 1);
  close(scalar(r, 'transmittance'), 1); close(scalar(r, 'velocity'), 74948114.5, 3e-10);
});
test('zero amplitude valid everywhere in supported regions and zero energy', () => {
  for (const [e, p] of [[wave, waveParams], [boundary, interfaceParams]]) {
    const r = e.evaluate({ ...p, amplitude: 0 }, [0, 0, -.2]);
    assert.equal(r.status, 'valid'); finite(r);
    Object.values(r.vectors).flat().forEach(x => close(x, 0));
    close(scalar(r, 'averageEnergyDensity'), 0); close(scalar(r, 'averagePoyntingZ'), 0);
  }
});
test('malformed params/coordinates rejected and unsupported physics is explicit', () => {
  for (const [e, p] of [[wave, waveParams], [boundary, interfaceParams]]) {
    for (const bad of [null, [], {}, { ...p, frequency: 0 }, { ...p, amplitude: -1 }, { ...p, phase: NaN },
      { ...p, time: Infinity }, { ...p, frequency: '1' }, { ...p, extra: Infinity }]) excluded(e.evaluate(bad, [0, 0, .1]), 'invalid');
    for (const bad of [null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0], [0, 0, '1']]) excluded(e.evaluate(p, bad), 'invalid');
    for (const key of ['conductivity', 'attenuation', 'incidenceAngle']) excluded(e.evaluate({ ...p, [key]: 1 }, [0, 0, .1]), 'unsupported');
  }
  for (const er of [0, -1, Infinity, Number.MIN_VALUE]) excluded(wave.evaluate({ ...waveParams, epsilonR: er }, [0, 0, 0]), 'invalid');
});
test('overflow/phase-resolution/underflow never produces synthetic finite success', () => {
  for (const p of [{ ...waveParams, amplitude: Number.MAX_VALUE }, { ...waveParams, frequency: Number.MAX_VALUE },
    { ...waveParams, muR: Number.MAX_VALUE, epsilonR: Number.MIN_VALUE }, { ...waveParams, time: 1e10 },
    { ...waveParams, amplitude: Number.MIN_VALUE }]) excluded(wave.evaluate(p, [0, 0, .1]), 'invalid');
  excluded(wave.evaluate(waveParams, [0, 0, Number.MAX_VALUE]), 'invalid');
});
test('bounded independent Maxwell, power and interface checks normal,phase-shifted,zero', () => {
  for (const [e, p, count] of [[wave, waveParams, 5], [boundary, interfaceParams, 10]]) {
    for (const phase of [0, .731, -1.123]) for (const amplitude of [10, 0]) {
      const rows = e.verify({ ...p, amplitude, phase });
      assert.equal(rows.length, count);
      rows.forEach(row => { assert.equal(row.status, 'pass', row.label + ': ' + row.reason); finite(row); assert.ok(row.method); });
    }
    assert.ok(e.verify({ ...p, frequency: 0 }).every(r => r.status === 'skipped' && r.reason));
  }
});
test('profiles have bounded SI coordinates, finite tangential interface limits and no mutation', () => {
  for (const [e, p] of [[wave, waveParams], [boundary, interfaceParams]]) {
    const snapshot = JSON.stringify(p);
    const profiles = e.profile(p, 81);
    assert.equal(profiles.length, 2);
    profiles.forEach(s => { assert.equal(s.points.length, 81); assert.equal(s.coordinateUnit, 'm'); assert.match(s.reference, /peak\/cos/); finite(s); });
    assert.equal(JSON.stringify(p), snapshot);
    for (const n of [0, 1, 2.5, 514, Infinity, NaN]) assert.deepEqual(e.profile(p, n), []);
    assert.deepEqual(e.profile({ ...p, frequency: 0 }), []);
  }
  const center = boundary.profile(interfaceParams, 81).map(s => s.points[40].value);
  close(center[0], 20 / 3); close(center[1], .035392249730535022, 3e-10);
});

test('profile follows evaluator numeric exclusions instead of unbounded trigonometry or underflow', () => {
  assert.deepEqual(wave.profile({ ...waveParams, amplitude: Number.MAX_VALUE }), []);
  assert.deepEqual(wave.profile({ ...waveParams, amplitude: Number.MIN_VALUE }), []);
  assert.deepEqual(boundary.profile({ ...interfaceParams, epsilonR2: 1e20 }), []);
});
