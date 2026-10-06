import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxMode, createSceneMode } from '../../src/em-plane-modes.js';
import { createPointChargeEditor } from '../../src/em-playground-state.js';
import { createEMState } from '../../src/em-state.js';

test('sandbox field is rebuilt for new sources but not for a moved sensor or a new plane', () => {
  const editor = createPointChargeEditor(), mode = createSandboxMode(editor);
  const field = mode.field(), key = mode.fieldKey();
  assert.equal(mode.moveSensor([1, 1, 0]), true);
  assert.deepEqual(mode.sensor(), [1, 1, 0]);
  assert.strictEqual(mode.field(), field);
  assert.equal(mode.fieldKey(), key);
  mode.setPlane('xz');
  assert.strictEqual(mode.field(), field);
  assert.equal(mode.fixed(), 1, 'the fixed coordinate is the sensor y when viewing xz');
  editor.updateSource('q1', { q: 3e-9 });
  assert.notStrictEqual(mode.field(), field);
  assert.notEqual(mode.fieldKey(), key);
  assert.equal(mode.moveSensor([99, 0, 0]), false, 'out of range is refused');
  assert.deepEqual(mode.sensor(), [1, 1, 0]);
});

test('scene mode works in display coordinates and follows the wave clock', () => {
  const store = createEMState(), mode = createSceneMode(store);
  store.setScene('wave');
  const field = mode.field(), key = mode.fieldKey();
  assert.equal(mode.plane(), 'xz');
  assert.equal(mode.moveSensor([0.5, 0, 1]), true);
  const lambda = field.unit;
  assert.ok(Math.abs(store.state.point[2] - lambda) < 1e-6);
  assert.deepEqual(mode.sensor().map(v => Number(v.toFixed(9))), [0.5, 0, 1]);
  assert.strictEqual(mode.field(), field, 'the sensor does not rebuild the field');
  store.setTime(0.25);
  assert.notEqual(mode.fieldKey(), key, 'time changes the wave field');
  assert.equal(mode.moveSensor([0, 0, 3]), false, 'beyond 2 wavelengths');
  assert.deepEqual(mode.sources(), []);
  assert.equal(mode.model().kind, 'wave');
});
