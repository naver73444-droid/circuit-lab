import test from 'node:test';
import assert from 'node:assert/strict';
import {
  samplingFrame, samplingControls, describeSampling, timeSpan, SAMPLING_AXIS, samplingLesson,
} from '../../../src/signals-sampling-model.js';
import { samplingAlias } from '../../../src/signals-course-model.js';

import { controlDefaults } from '../../../src/signals-util.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} versus ${b}`);

test('samples are x(n/fs) and the reconstruction passes through every one of them', () => {
  for (const [f0, fs, phi] of [[7, 10, 0], [7, 10, 0.4], [3, 10, -1], [13.3, 6, 2], [0.5, 2.5, 0.2]]) {
    const frame = samplingFrame({ f0, fs, phi });
    for (const s of frame.samples) {
      near(s.y, Math.cos(2 * Math.PI * f0 * s.t + phi), 1e-12);
      near(frame.reconstruction(s.t), s.y, 1e-9);
    }
    assert.ok(frame.samples.at(-1).t <= frame.span + 1e-9);
  }
});

test('alias-free: the reconstruction is the original; aliased: it is the folded tone', () => {
  const clean = samplingFrame({ f0: 3, fs: 10, phi: 0.3 });
  for (const t of [0, 0.123, 0.77]) near(clean.reconstruction(t), clean.signal(t), 1e-12);
  assert.equal(clean.overlap, false);
  const bad = samplingFrame({ f0: 7, fs: 10, phi: 0 });
  assert.equal(bad.overlap, true);
  near(bad.alias.aliasHz, 3);
  assert.ok(Math.abs(bad.reconstruction(0.04) - bad.signal(0.04)) > 0.1);
  near(bad.reconstruction(0.05), Math.cos(2 * Math.PI * -3 * 0.05), 1e-12);
});

test('spectrum lines: +-f0 plus replicas at k*fs; aliased lines land in the Nyquist band', () => {
  const frame = samplingFrame({ f0: 7, fs: 10, phi: 0 });
  const originals = frame.lines.filter((l) => l.original).map((l) => l.f).sort((a, b) => a - b);
  assert.deepEqual(originals, [-7, 7]);
  for (const l of frame.lines) near(((l.f - l.sign * 7) / 10) % 1, 0, 1e-12);
  const inBand = frame.lines.filter((l) => l.inBand).map((l) => Math.abs(l.f));
  assert.ok(inBand.length >= 2);
  for (const f of inBand) near(f, 3);
  assert.ok(frame.lines.every((l) => Math.abs(l.f) <= SAMPLING_AXIS));
  // no aliasing: the only in-band lines are the original tone
  const fine = samplingFrame({ f0: 2, fs: 10, phi: 0 });
  assert.deepEqual(fine.lines.filter((l) => l.inBand).map((l) => l.original), [true, true]);
});

test('window shows at least a second and two periods; slider ranges give finite frames', () => {
  assert.equal(timeSpan(10), 1);
  assert.equal(timeSpan(0.5), 4);
  const [f0, fs] = samplingControls();
  for (const a of [f0.min, f0.max]) for (const b of [fs.min, fs.max]) {
    const frame = samplingFrame({ f0: a, fs: b, phi: 0 });
    assert.ok(frame.samples.length >= 2 && frame.samples.length < 120 && frame.lines.length > 2);
  }
  assert.equal(controlDefaults(samplingControls()).f0, 7);
});

test('readout formats the alias frequency, never "3.000000"', () => {
  assert.match(describeSampling({ f0: 7, fs: 10 }), /f_alias=3 Hz/);
  assert.match(describeSampling({ f0: 2, fs: 10 }), /알리아싱 없음/);
  assert.match(describeSampling({ f0: 5, fs: 10 }), /Nyquist 경계/);
  assert.doesNotMatch(describeSampling({ f0: 7, fs: 10 }), /\.\d{4}/);
  assert.match(samplingLesson.describe({ params: { f0: 6.3, fs: 10 } }), /3\.7 Hz/);
  near(samplingAlias(6.3, 10).aliasHz, 3.7, 1e-12);
});

test('the phase slider can reach 0 exactly and covers a full turn', () => {
  const phi = samplingControls().find((c) => c.key === 'phi');
  const steps = (0 - phi.min) / phi.step;
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9);
  assert.ok(phi.max >= Math.PI && phi.min <= -Math.PI);
});

test('f0 a multiple of fs: both replicas merge on 0 Hz and the readout says DC', () => {
  const frame = samplingFrame({ f0: 10, fs: 10, phi: 0 });
  assert.equal(frame.alias.aliasHz, 0);
  assert.deepEqual(frame.lines.filter((l) => !l.original && l.inBand).map((l) => l.f), [0]);
  assert.equal(new Set(frame.lines.map((l) => l.f.toFixed(6))).size, frame.lines.length);
  assert.match(describeSampling({ f0: 10, fs: 10 }), /f_alias = 0 Hz \(DC\)/);
  assert.match(describeSampling({ f0: 8, fs: 4 }), /f_alias = 0 Hz \(DC\)/);
});
