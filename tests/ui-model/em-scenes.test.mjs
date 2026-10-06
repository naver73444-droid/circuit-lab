import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFields, parseEMNumber, readRaw, sceneFieldIds, sceneTitle } from '../../src/em-scenes-panel.js';
import { createEMState } from '../../src/em-state.js';

test('readRaw parses numbers, keeps direction names and rejects empty or non-finite text', () => {
  const raw = readRaw('line', { current: ' 2.5 ', direction: '-y' });
  assert.deepEqual(raw, { current: 2.5, direction: '-y' });
  assert.throws(() => readRaw('line', { current: '', direction: 'x' }), /빈값/);
  assert.throws(() => readRaw('line', { current: '1e', direction: 'x' }), /유한/);
  assert.equal(parseEMNumber('0'), 0);
});

test('each scene derives model fields the state accepts', () => {
  const em = createEMState();
  const forms = {
    charge: { q: 2, x: 0, y: 0, z: 0 },
    dipole: { q: 1, separation: 0.5, axis: 'y' },
    line: { current: 3, direction: '-z' },
    loop: { current: 1, radius: 0.5, normal: 'x' },
    wave: { amplitude: 5, frequency: 1e7, phaseDeg: -90, direction: 'x' },
  };
  for (const [name, raw] of Object.entries(forms)) {
    em.setScene(name);
    assert.ok(em.apply(deriveFields(name, raw)), `${name} applies: ${em.state.error}`);
    assert.ok(sceneFieldIds(name).every(id => id in raw));
    assert.ok(sceneTitle(name));
  }
  const wave = em.state.models.wave;
  assert.deepEqual(wave.direction, [1, 0, 0]);
  assert.deepEqual(wave.polarization, [0, 1, 0], 'polarization stays perpendicular to the propagation axis');
  assert.ok(Math.abs(wave.phase - 1.5 * Math.PI) < 1e-12, 'phase wraps into 0..2pi');
});

test('a value that cannot be applied leaves the model untouched', () => {
  const em = createEMState();
  em.evaluate();
  assert.equal(em.apply(deriveFields('charge', { q: 5000, x: 0, y: 0, z: 0 })), null);
  assert.equal(em.state.models.charge.q, 1e-9);
  em.setScene('loop');
  assert.equal(em.apply(deriveFields('loop', { current: 1, radius: 20, normal: 'z' })), null);
  assert.equal(em.state.models.loop.radius, 1);
});

test('parseEMNumber lives in the pure em-source-edit module (the calculus panel imports it from there, not from the DOM scenes panel)', async () => {
  const pure = await import('../../src/em-source-edit.js');
  assert.equal(pure.parseEMNumber, parseEMNumber, 'the scenes panel re-exports the same function');
  assert.equal(pure.parseEMNumber(' 2.5e-3 '), 0.0025);
  assert.throws(() => pure.parseEMNumber(''), /빈값/);
  const { readFile } = await import('node:fs/promises');
  const calculusPanel = await readFile(new URL('../../src/em-calculus-panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(calculusPanel, /em-scenes-panel/);
});
