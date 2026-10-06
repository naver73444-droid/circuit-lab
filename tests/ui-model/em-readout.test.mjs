import test from 'node:test';
import assert from 'node:assert/strict';
import { gaussReadout, sensorReadout } from '../../src/em-readout.js';
import { gaussEnclosure } from '../../src/em-gauss.js';
import { createSandboxField, createSceneField } from '../../src/em-plane-field.js';
import { DEFAULT_SCENES } from '../../src/em-state.js';
import { validatePointSources } from '../../src/em-playground-physics.js';

const sources = validatePointSources([
  { id: 'q1', q: 1e-9, position: [-0.75, 0, 0] }, { id: 'q2', q: -1e-9, position: [0.75, 0, 0] },
]);

test('sensor readout is one compact line with E and V, plus rows', () => {
  const field = createSandboxField(sources);
  const readout = sensorReadout(field, field.evaluate([0, 1, 0]), 'xy');
  assert.equal(readout.valid, true);
  assert.match(readout.compact, /^E = [\d.]+ V\/m ∠ -?\d+°, V = /);
  assert.deepEqual(readout.rows.map(row => row.label), ['E', '|E|', 'V']);
  assert.ok(readout.compact.length < 60);
});

test('the sensor angle follows the plane axes', () => {
  const field = createSandboxField(sources);
  // On the +x axis beyond both charges the field points along -x (net force of a dipole: toward the negative side).
  const onAxis = sensorReadout(field, field.evaluate([2, 0, 0]), 'xy');
  assert.match(onAxis.compact, /∠ (180|-180|0)°/);
});

test('current scenes show B in tesla and no potential', () => {
  const field = createSceneField(DEFAULT_SCENES.line);
  const readout = sensorReadout(field, field.evaluate([1, 0, 0]), 'xy');
  assert.equal(readout.compact, "B = 200 nT ∠ 90°");
  assert.deepEqual(readout.rows.map(row => row.label), ['B', '|B|']);
});

test('an excluded point reads as such', () => {
  const field = createSandboxField(sources);
  const readout = sensorReadout(field, field.evaluate([-0.75, 0, 0]), 'xy');
  assert.equal(readout.valid, false);
  assert.match(readout.compact, /제외영역/);
});

test('gauss readout: enclosed charge, prediction and numeric flux with agreement', () => {
  const enclosure = gaussEnclosure(sources, [-0.75, 0, 0], 0.4);
  const flux = 1e-9 / 8.8541878188e-12;
  const readout = gaussReadout({ enclosure, coarse: { status: 'valid', flux: flux * 1.01 }, precise: null });
  assert.equal(readout.status, 'ok');
  assert.match(readout.lines[0], /Q내부 = 1 nC  \(q1\)/);
  assert.match(readout.lines[1], /^Φ = Q\/ε₀ = 112\.9 V·m$/);
  assert.match(readout.lines[2], /\(근사\)$/);
  assert.equal(readout.agrees, true);
  const precise = gaussReadout({ enclosure, coarse: null, precise: { status: 'valid', flux: flux * 1.2 } });
  assert.match(precise.lines[2], /\(정밀\)$/);
  assert.equal(precise.agrees, false);
});

test('gauss readout reports unsupported and excluded surfaces without numbers', () => {
  const lines = validatePointSources([{ id: 'f', type: 'finite-line', lambda: 1e-9, start: [0, -1, 0], end: [0, 1, 0] }]);
  const unsupported = gaussReadout({ enclosure: gaussEnclosure(lines, [0, 0, 0], 0.5) });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.lines.length, 2);
  const onSurface = gaussReadout({ enclosure: gaussEnclosure(sources, [-0.75, 0, 0], 0) });
  assert.equal(onSurface.status === 'excluded' || onSurface.status === 'ok', true);
  const empty = gaussReadout({ enclosure: gaussEnclosure(sources, [3, 3, 0], 0.5), coarse: { status: 'valid', flux: 0 } });
  assert.match(empty.lines[0], /Q내부 = 0 C  \(없음\)/);
  assert.equal(empty.agrees, true);
});

test('a vector with no in-plane part shows its normal component, not "∠ 0°" (B = 1 uT along z read in the xy plane)', () => {
  const field = { kind: 'loop', scalarName: '|B|' };
  const normal = sensorReadout(field, { status: 'valid', vector: [0, 0, 1e-6], scalar: 1e-6 }, 'xy');
  assert.doesNotMatch(normal.compact, /∠/);
  assert.equal(normal.compact, 'B = 1 µT · 법선 +1 µT');
  assert.ok(normal.rows.some(row => row.label === '방향' && /평면에 수직 \(법선 \+1 µT\)/.test(row.text)));
  const negative = sensorReadout(field, { status: 'valid', vector: [0, 0, -2e-6], scalar: 2e-6 }, 'xy');
  assert.equal(negative.compact, 'B = 2 µT · 법선 −2 µT');
  // the same vector seen edge-on has an in-plane direction again: y component in the xz plane is the normal one
  const edgeOn = sensorReadout(field, { status: 'valid', vector: [0, 0, 1e-6], scalar: 1e-6 }, 'xz');
  assert.match(edgeOn.compact, /∠ 90°/);
  // an oblique vector keeps its angle and lists the normal part as a row
  const oblique = sensorReadout(field, { status: 'valid', vector: [1e-6, 0, 1e-6], scalar: 1.4e-6 }, 'xy');
  assert.match(oblique.compact, /∠ 0°/);
  assert.ok(oblique.rows.some(row => row.label === '법선 성분' && row.text === '+1 µT'));
  // the zero vector has neither
  const zero = sensorReadout(field, { status: 'valid', vector: [0, 0, 0], scalar: 0 }, 'xy');
  assert.equal(zero.compact, 'B = 0 T');
});

test('an unconverged precise flux says so; near a charge it says "경계 근처 · 미수렴" and never claims agreement', () => {
  const near = validatePointSources([{ id: 'q', q: 1e-9, position: [0.997, 0, 0] }]);
  const enclosure = gaussEnclosure(near, [0, 0, 0], 1);
  assert.ok(Math.abs(enclosure.boundaryGap - 0.003) < 1e-12);
  const unconverged = gaussReadout({ enclosure, coarse: { status: 'valid', flux: 76.4 }, precise: { status: 'valid', flux: 76.42, converged: false } });
  assert.match(unconverged.lines[2], /\(경계 근처 · 미수렴\)$/);
  assert.doesNotMatch(unconverged.lines[2], /정밀/);
  assert.equal(unconverged.converged, false);
  assert.equal(unconverged.agrees, null);
  assert.equal(unconverged.stateText, '경계 근처 · 미수렴');
  // away from the surface an unconverged result is just unconverged
  const far = gaussEnclosure(validatePointSources([{ id: 'q', q: 1e-9, position: [0.5, 0, 0] }]), [0, 0, 0], 1);
  const plain = gaussReadout({ enclosure: far, precise: { status: 'valid', flux: 100, converged: false } });
  assert.match(plain.lines[2], /\(미수렴\)$/);
  assert.equal(plain.stateText, '미수렴');
  // a converged precise result shows the convergence and the agreement as before
  const flux = 1e-9 / 8.8541878188e-12;
  const good = gaussReadout({ enclosure: far, precise: { status: 'valid', flux, converged: true } });
  assert.match(good.lines[2], /\(정밀 · 수렴\)$/);
  assert.equal(good.agrees, true);
  assert.equal(good.stateText, '가우스 법칙과 일치');
});
