import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from '../../../src/em-course-transmission.js';
const [line] = EXPERIMENTS;
const p = { z0: 50, velocity: 2e8, frequency: 1e8, length: 1, amplitude: 2, phase: 0, time: 0, loadMode: 0, loadResistance: 100, loadReactance: 0 };
const scalar = (r, key) => r.scalars.find(s => s.key === key)?.value;
const phasor = (r, key) => r.phasors?.find(s => s.key === key);
const close = (actual, expected, rel = 1e-11, absolute = 1e-12) => {
  assert.ok(Number.isFinite(actual)); assert.ok(Math.abs(actual - expected) <= absolute + rel * Math.abs(expected), actual + ' vs ' + expected);
};
const complexClose = (value, re, im) => { assert.ok(value); close(value.re, re); close(value.im, im); };
function finite(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(finite);
}
const excluded = (r, status) => { assert.equal(r.status, status, r.reason); assert.deepEqual(r.vectors, {}); assert.deepEqual(r.scalars, []); assert.ok(r.reason); };
test('definition/API are bounded, SI, passive complex and peak/cos with explicit load coordinates', () => {
  assert.equal(line.id, 'transmission-lossless'); assert.equal(line.view.kind, 'profile');
  for (const key of ['assumptions', 'validity', 'singularities', 'formulas', 'references']) assert.ok(line[key].length);
  const r = line.evaluate(Object.fromEntries(line.parameters.map(k => [k.key, k.initial])), line.probeDefault);
  assert.equal(r.status, 'valid'); assert.deepEqual(r.vectors, {}); finite(r);
  r.phasors.forEach(c => assert.match(c.reference, /peak\/cos.*load z=0/));
});
test('resistive independent gamma1/3,SWR2,peak power and constant conserved power', () => {
  for (const z of [-1, -.83, -.4, -.01, 0]) {
    const r = line.evaluate(p, [0, 0, z]);
    assert.equal(r.status, z === -1 || z === 0 ? 'boundary' : 'valid');
    complexClose(phasor(r, 'gammaLoad'), 1 / 3, 0);
    close(scalar(r, 'swr'), 2); close(scalar(r, 'incidentPower'), .04);
    close(scalar(r, 'reflectedPower'), .004444444444444444); close(scalar(r, 'averagePower'), .03555555555555556);
    const V = phasor(r, 'voltage'), I = phasor(r, 'current');
    close(.5 * (V.re * I.re + V.im * I.im), .03555555555555556);
  }
});
test('literal ABCD eighth-wave input40-j30 and quarterwave inverse25', () => {
  const eighth = line.evaluate({ ...p, length: .25 }, [0, 0, -.125]);
  complexClose(phasor(eighth, 'inputImpedance'), 40, -30);
  const quarter = line.evaluate({ ...p, length: .5 }, [0, 0, -.25]);
  complexClose(phasor(quarter, 'inputImpedance'), 25, 0);
});
test('MIT quarterwave100-ohm section/50-ohm load ->200; matching section200 ->50', () => {
  const a = line.evaluate({ ...p, z0: 100, loadResistance: 50, length: .5 }, [0, 0, -.25]);
  complexClose(phasor(a, 'inputImpedance'), 200, 0);
  const b = line.evaluate({ ...p, z0: 100, loadResistance: 200, length: .5 }, [0, 0, -.25]);
  complexClose(phasor(b, 'inputImpedance'), 50, 0);
});
test('matched forward phase +j at negative quarterwave, time and peak/RMS power', () => {
  const matched = { ...p, loadResistance: 50 };
  const r = line.evaluate(matched, [0, 0, -.5]);
  complexClose(phasor(r, 'voltage'), 0, 2); complexClose(phasor(r, 'current'), 0, .04);
  complexClose(phasor(r, 'inputImpedance'), 50, 0); complexClose(phasor(r, 'gammaLoad'), 0, 0);
  close(scalar(r, 'swr'), 1); close(scalar(r, 'averagePower'), .04);
  close(scalar(r, 'averagePower'), Math.SQRT2 ** 2 / 50);
  const timed = line.evaluate({ ...matched, time: 1 / (4e8) }, [0, 0, -.5]);
  close(scalar(timed, 'voltage'), -2); close(scalar(timed, 'current'), -.04);
});
test('reactive j50: gamma+j,zero power,quadrature load voltage/current,quarterwave -j50', () => {
  const reactive = { ...p, amplitude: 1, loadResistance: 0, loadReactance: 50 };
  const r = line.evaluate(reactive, [0, 0, 0]);
  assert.equal(r.status, 'boundary');
  complexClose(phasor(r, 'gammaLoad'), 0, 1); complexClose(phasor(r, 'voltage'), 1, 1); complexClose(phasor(r, 'current'), .02, -.02);
  close(scalar(r, 'averagePower'), 0); assert.equal(scalar(r, 'swr'), undefined); assert.ok(r.notes.some(n => n.includes('무한')));
  const quarter = line.evaluate({ ...reactive, length: .5 }, [0, 0, -.5]);
  complexClose(phasor(quarter, 'inputImpedance'), 0, -50);
  const pole = line.evaluate(reactive, [0, 0, -.25]);
  assert.equal(pole.status, 'singular'); assert.equal(phasor(pole, 'positionImpedance'), undefined);
  complexClose(phasor(pole, 'current'), 0, 0); assert.ok(phasor(pole, 'voltage')); finite(pole);
});
test('passive complex60+j80 atZ0=100 gives gamma+j/2, SWR3 and .015W', () => {
  const r = line.evaluate({ ...p, z0: 100, loadResistance: 60, loadReactance: 80 }, [0, 0, -.3]);
  complexClose(phasor(r, 'gammaLoad'), 0, .5); close(scalar(r, 'swr'), 3); close(scalar(r, 'averagePower'), .015);
});
test('open/short reflection,current sign,unbounded SWR and quarterwave poles explicit', () => {
  for (const [loadMode, gamma] of [[1, 1], [2, -1]]) {
    const load = line.evaluate({ ...p, loadMode }, [0, 0, 0]);
    complexClose(phasor(load, 'gammaLoad'), gamma, 0); close(scalar(load, 'averagePower'), 0);
    close(scalar(load, 'voltageMagnitude'), loadMode === 1 ? 4 : 0);
    close(scalar(load, 'currentMagnitude'), loadMode === 1 ? 0 : .08);
    assert.equal(scalar(load, 'swr'), undefined); finite(load);
  }
  const shortQuarter = line.evaluate({ ...p, loadMode: 2, length: .5 }, [0, 0, -.25]);
  assert.equal(shortQuarter.status, 'singular'); assert.equal(phasor(shortQuarter, 'inputImpedance'), undefined);
  const openQuarter = line.evaluate({ ...p, loadMode: 1, length: .5 }, [0, 0, -.25]);
  assert.equal(openQuarter.status, 'valid'); complexClose(phasor(openQuarter, 'inputImpedance'), 0, 0);
  const finiteShort = line.evaluate({ ...p, loadResistance: 0 }, [0, 0, -.2]);
  complexClose(phasor(finiteShort, 'gammaLoad'), -1, 0);
});
test('delays and matched integrated stored energy independent fixture', () => {
  const matched = { ...p, loadResistance: 50 };
  const r = line.evaluate(matched, [0, 0, -.2]);
  close(scalar(r, 'oneWayDelay'), 5e-9, 1e-11, 1e-20); close(scalar(r, 'roundTripDelay'), 1e-8, 1e-11, 1e-20);
  close(scalar(r, 'averageEnergyPerLength'), 2e-10, 1e-11, 1e-21);
  close(scalar(r, 'averageEnergyPerLength') * 1, .04 * 5e-9, 1e-11, 1e-21);
});
test('zero excitation leaves amplitude-independent impedances and no energy', () => {
  const r = line.evaluate({ ...p, amplitude: 0 }, [0, 0, -.2]);
  assert.equal(r.status, 'valid'); close(scalar(r, 'averagePower'), 0); close(scalar(r, 'averageEnergyPerLength'), 0);
  complexClose(phasor(r, 'voltage'), 0, 0); complexClose(phasor(r, 'current'), 0, 0);
  complexClose(phasor(r, 'inputImpedance'), 100, 0); finite(r);
  assert.ok(r.notes.some(n => n.includes('0/0')));
});
test('malformed,negative/active,lossy,off-axis,outside coordinates are explicit and unclamped', () => {
  for (const bad of [null, [], {}, { ...p, z0: 0 }, { ...p, length: -1 }, { ...p, amplitude: -1 }, { ...p, frequency: 0 },
    { ...p, loadMode: .5 }, { ...p, phase: NaN }, { ...p, extra: Infinity }, { ...p, loadResistance: '50' }]) excluded(line.evaluate(bad, [0, 0, -.2]), 'invalid');
  for (const bad of [null, [], [0, 0], [0, 0, 0, 0], [0, Infinity, 0], ['0', 0, 0]]) excluded(line.evaluate(p, bad), 'invalid');
  excluded(line.evaluate({ ...p, loadResistance: -1 }, [0, 0, -.2]), 'unsupported');
  for (const key of ['attenuation', 'seriesResistance', 'shuntConductance']) excluded(line.evaluate({ ...p, [key]: .1 }, [0, 0, -.2]), 'unsupported');
  for (const point of [[1e-30, 0, -.2], [0, 1, -.2], [0, 0, .00001], [0, 0, -1.00001]]) excluded(line.evaluate(p, point), 'unsupported');
});
test('nonfinite intermediate/extreme phase/underflow produce invalid without fake fields', () => {
  for (const bad of [{ ...p, frequency: Number.MAX_VALUE }, { ...p, z0: Number.MIN_VALUE }, { ...p, velocity: Number.MIN_VALUE },
    { ...p, amplitude: Number.MAX_VALUE }, { ...p, amplitude: Number.MIN_VALUE }, { ...p, time: 1e20 },
    { ...p, loadResistance: Number.MIN_VALUE }]) excluded(line.evaluate(bad, [0, 0, -.2]), 'invalid');
});
test('bounded telegrapher,cycle power,boundary and matched energy verification passes', () => {
  for (const params of [p, { ...p, loadResistance: 50 }, { ...p, loadResistance: 0, loadReactance: 50 },
    { ...p, loadMode: 1 }, { ...p, loadMode: 2 }, { ...p, loadResistance: 60, loadReactance: 80 }, { ...p, amplitude: 0 }, { ...p, phase: .731 }]) {
    const rows = line.verify(params);
    assert.ok(rows.length >= 5 && rows.length <= 8);
    rows.forEach(r => { assert.equal(r.status, 'pass', r.label + ': ' + r.actual + ' vs ' + r.expected); assert.ok(r.method); finite(r); });
  }
  assert.ok(line.verify({ ...p, velocity: 0 }).every(r => r.status === 'skipped' && r.reason));
});
test('profile standing-wave peaks2/3,4/3 and bounded SI data including poles,immutable inputs', () => {
  const snapshot = JSON.stringify(p), series = line.profile(p, 81);
  assert.equal(series.length, 2); assert.equal(JSON.stringify(p), snapshot);
  close(Math.max(...series[0].points.map(p => p.value)), 8 / 3); close(Math.min(...series[0].points.map(p => p.value)), 4 / 3);
  series.forEach(s => { assert.equal(s.points.length, 81); assert.equal(s.coordinateUnit, 'm'); close(s.points[0].coordinate, -1); close(s.points.at(-1).coordinate, 0); finite(s); });
  assert.equal(line.profile({ ...p, loadMode: 1 }, 513)[0].points.length, 513);
  for (const count of [0, 1, 2.5, 514, NaN, Infinity]) assert.deepEqual(line.profile(p, count), []);
  assert.deepEqual(line.profile({ ...p, length: 0 }), []);
});

test('R3 wavelength-adaptive RF profile resolves prior exact envelope alias', () => {
  const series = line.profile({ ...p, frequency: 1e9, length: 8 }, 81);
  assert.equal(series.length, 2);
  series.forEach(s => {
    assert.equal(s.points.length, 481); assert.equal(s.sampling.status, 'resolved');
    assert.equal(s.sampling.requestedCount, 81); assert.equal(s.sampling.requiredCount, 481);
    assert.ok(s.sampling.step <= s.sampling.maxStep * (1 + 1e-12)); finite(s);
  });
  close(Math.min(...series[0].points.map(s => s.value)), 4 / 3);
  close(Math.max(...series[0].points.map(s => s.value)), 8 / 3);
  close(Math.min(...series[1].points.map(s => s.value)), 2 / 75);
  close(Math.max(...series[1].points.map(s => s.value)), 4 / 75);
  close(series[0].points[0].coordinate, -8); close(series[0].points.at(-1).coordinate, 0);
});
test('R3 sampling cap yields explicit unresolved empty traces; matched envelope remains drawable', () => {
  const series = line.profile({ ...p, frequency: 1e9, length: 20 });
  assert.equal(series.length, 2);
  series.forEach(s => {
    assert.deepEqual(s.points, []); assert.equal(s.sampling.status, 'unresolved');
    assert.equal(s.sampling.requiredCount, 1201); assert.equal(s.sampling.actualCount, 0);
    assert.equal(s.sampling.maxCount, 513); assert.ok(s.notes.some(n => n.includes('513') && n.includes('미해상'))); finite(s);
  });
  const matched = line.profile({ ...p, frequency: 1e9, length: 20, loadResistance: 50 });
  assert.equal(matched[0].sampling.status, 'resolved'); assert.equal(matched[0].points.length, 81);
  matched[0].points.forEach(s => close(s.value, 2));
});
test('R3 high-order short/open/reactive nominal poles preserve finite V/I and omit unresolved Z', () => {
  for (const params of [
    { ...p, frequency: 1e9, length: 4.05, loadMode: 2 },
    { ...p, frequency: 1e9, length: 4, loadMode: 1 },
    { ...p, frequency: 1e9, length: 4.025, loadResistance: 0, loadReactance: 50 }
  ]) {
    const r = line.evaluate(params, [0, 0, -params.length]);
    assert.equal(r.status, 'singular', JSON.stringify(r));
    assert.equal(phasor(r, 'inputImpedance'), undefined); assert.equal(phasor(r, 'positionImpedance'), undefined);
    assert.ok(phasor(r, 'voltage')); assert.ok(phasor(r, 'current'));
    assert.match(r.reason, /구별/); finite(r);
  }
});
test('R3 resolvable finite detuning near a high-order pole retains signed finite impedance', () => {
  for (const delta of [-1e-9, 1e-9]) {
    const length = 4.05 + delta;
    const r = line.evaluate({ ...p, frequency: 1e9, length, loadMode: 2 }, [0, 0, -length]);
    assert.equal(r.status, 'boundary');
    const Z = phasor(r, 'inputImpedance'); assert.ok(Z);
    close(Z.re, 0); close(Z.im, -50 / Math.tan(10 * Math.PI * delta), 1e-6);
    assert.equal(Math.sign(Z.im), -Math.sign(delta)); finite(r);
  }
});
