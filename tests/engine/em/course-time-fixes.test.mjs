import test from 'node:test';
import assert from 'node:assert/strict';
import { getExperiment } from '../../../src/em-course-registry.js';
import {
  instantProfiles, MAX_SAMPLES, normalizeTime, SAMPLES_PER_WAVELENGTH, timeSpec, UNRESOLVED_TEXT,
} from '../../../src/em-course-time.js';

const defaults = definition => Object.fromEntries(definition.parameters.map(p => [p.key, p.initial]));
const line = getExperiment('transmission-lossless'), wave = getExperiment('wave-medium');
const peak = series => Math.max(...series.points.map(p => Math.abs(p.value)));

test('the instantaneous curve gets enough samples per wavelength: 32 GHz on a 1 m line is a real standing wave, not a flat line', () => {
  const params = { ...defaults(line), frequency: 32e9, length: 1, loadMode: 2, time: 1 / (4 * 32e9) }; // v = 2e8 m/s -> lambda = 6.25 mm; a quarter period (the short-circuit phasor is imaginary at t = 0)
  const [voltage] = instantProfiles(line, params, [-1, 0]);
  assert.equal(voltage.status, 'resolved');
  const lambda = 2e8 / 32e9, needed = Math.ceil(SAMPLES_PER_WAVELENGTH * 1 / lambda) + 1;
  assert.ok(voltage.points.length >= needed && voltage.points.length <= MAX_SAMPLES, `${voltage.points.length} samples`);
  // sampled densely enough that it swings through the full amplitude and changes sign many times
  const signChanges = voltage.points.filter((p, i) => i && Math.sign(p.value) !== Math.sign(voltage.points[i - 1].value)).length;
  assert.ok(signChanges >= 100, `${signChanges} sign changes over 160 wavelengths`);
  assert.ok(peak(voltage) > 0.9 * 2 * 2, 'a short-circuit standing wave reaches twice the incident amplitude');
});

test('above the sample cap the curve is reported as unresolved with a reason instead of an aliased curve', () => {
  const params = { ...defaults(line), frequency: 1e12, length: 1 }; // lambda = 0.2 mm -> 80001 samples needed
  const series = instantProfiles(line, params, [-1, 0]);
  assert.equal(series.length, 2);
  for (const item of series) {
    assert.equal(item.status, 'unresolved');
    assert.equal(item.reason, UNRESOLVED_TEXT);
    assert.equal(item.reason, '미해상도 (파장이 너무 짧음)');
    assert.deepEqual(item.points, []);
    assert.ok(item.requiredSamples > MAX_SAMPLES);
  }
  const waves = instantProfiles(wave, { ...defaults(wave), frequency: 1e12 }, [-1.5, 1.5]);
  assert.ok(waves.every(item => item.status === 'unresolved'));
});

test('the sample count never drops below the old 161 for a long wavelength', () => {
  const [volts] = instantProfiles(line, defaults(line), [-1, 0]);
  assert.equal(volts.points.length, 161);
});

test('an open load (singular input impedance) still plots finite v(z, t) and i(z, t): the check is per plotted quantity', () => {
  // length 1 m, v = 2e8, f = 1e8: beta*l = pi, so Z_in has a pole and every point reports status "singular"
  const params = { ...defaults(line), loadMode: 1, length: 1 };
  assert.equal(line.evaluate({ ...params }, [0, 0, -0.25]).status, 'singular');
  const series = instantProfiles(line, params, [-1, 0]);
  assert.ok(series, 'no longer null');
  assert.deepEqual(series.map(s => s.key), ['v', 'i']);
  assert.ok(series.every(s => s.points.length === 161 && s.points.every(p => Number.isFinite(p.value))));
  // an open end carries no current at z = 0 and has the voltage antinode there
  const at = (s, z) => s.points.reduce((best, p) => (Math.abs(p.coordinate - z) < Math.abs(best.coordinate - z) ? p : best));
  assert.ok(Math.abs(at(series[0], 0).value) <= 4 + 1e-9);
  assert.ok(Math.abs(at(series[1], 0).value) < 1e-9);
  // a quarter period later the current of the open line is nonzero
  const later = instantProfiles(line, { ...params, time: 2.5e-9 }, [-1, 0]);
  assert.ok(peak(later[1]) > 0.01);
});

test('terminal samples (status "boundary") are part of the curve', () => {
  const series = instantProfiles(line, { ...defaults(line), loadMode: 2 }, [-1, 0]);
  assert.equal(series[0].points.at(-1).coordinate, 0);
  assert.equal(series[0].points[0].coordinate, -1);
});

test('normalizeTime moves a stale time into the range the new parameters define, so the old time is never evaluated', () => {
  const params = { ...defaults(wave), frequency: 1e6, time: 1.9e-6 };
  assert.ok(Math.abs(timeSpec(wave, params).max - 2e-6) < 1e-18);
  assert.equal(normalizeTime(wave, params), params, 'unchanged object when already in range');
  const faster = { ...params, frequency: 1e8 }; // the range shrinks to 20 ns
  const normalized = normalizeTime(wave, faster);
  assert.ok(Math.abs(timeSpec(wave, normalized).max - 2e-8) < 1e-20);
  assert.ok(Math.abs(normalized.time - 2e-8) < 1e-20, 'time is the end of the new range');
  const shown = wave.evaluate({ ...normalized }, [0, 0, 0.1]).vectors.E[0];
  const stale = wave.evaluate({ ...faster }, [0, 0, 0.1]).vectors.E[0];
  assert.notEqual(shown, stale, 'the computation differs from the one that used the old time');
  assert.equal(shown, wave.evaluate({ ...faster, time: timeSpec(wave, faster).max }, [0, 0, 0.1]).vectors.E[0]);
});

test('normalizeTime leaves experiments without a clock and without a finite time alone', () => {
  const coax = getExperiment('coax-current'), params = defaults(coax);
  assert.equal(normalizeTime(coax, params), params);
  const faraday = getExperiment('faraday-loop'), fp = { ...defaults(faraday), time: NaN };
  assert.equal(normalizeTime(faraday, fp), fp);
  const rod = getExperiment('motional-rod'), rp = { ...defaults(rod), velocity: 3, x0: 0.2, railLength: 2, time: 5 };
  assert.ok(Math.abs(normalizeTime(rod, rp).time - 0.985 * 1.8 / 3) < 1e-12);
});

test('a zoomed-out view of a transmission line only counts the samples that lie on the line', () => {
  const params = { ...defaults(line), frequency: 8e9, length: 1, loadMode: 2 }; // 40 wavelengths on the line
  const near = instantProfiles(line, params, [-1, 0])[0];
  const far = instantProfiles(line, params, [-100, 100])[0]; // the view zoomed out 100x: the line is only 1/200 of it
  assert.equal(far.status, 'resolved');
  assert.equal(far.points.length, near.points.length, 'same density on the line');
  assert.ok(far.points[0].coordinate >= -1 && far.points.at(-1).coordinate <= 0);
  assert.equal(instantProfiles(line, params, [1, 2]), null, 'a view that does not touch the line has no curve');
  assert.ok(near.points.length >= SAMPLES_PER_WAVELENGTH * 40, `${near.points.length} samples for 40 wavelengths`);
});
