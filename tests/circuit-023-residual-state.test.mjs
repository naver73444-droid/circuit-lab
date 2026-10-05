import test from 'node:test';
import assert from 'node:assert/strict';
import { createEMState } from '../src/em-state.js';

test('wave scene round-trip rejects an out-of-range shared point without clamping and recovers by apply', () => {
  const em = createEMState();
  em.evaluate();
  em.setPoint([0, 0, 0]);
  assert.equal(em.setScene('wave'), true);
  em.setDraft('frequency', '1000000000');
  assert.ok(em.apply({ frequency: 1e9 }));

  assert.equal(em.setScene('charge'), true);
  assert.ok(em.setPoint([1, 0, 0]));
  const previousSnapshot = em.state.lastValid;

  assert.equal(em.setScene('wave'), false);
  assert.deepEqual(em.state.point, [1, 0, 0]);
  assert.strictEqual(em.state.lastValid, previousSnapshot);
  assert.equal(em.state.previous, true);
  assert.match(em.state.error, /−2λ…2λ/);

  em.setDraft('frequency', '1000000');
  const recovered = em.apply({ frequency: 1e6 });
  assert.ok(recovered);
  assert.equal(recovered.sceneName, 'wave');
  assert.deepEqual(recovered.point, [1, 0, 0]);
  assert.equal(em.state.models.wave.frequency, 1e6);
  assert.deepEqual(em.state.draft, {});
  assert.equal(em.state.previous, false);
  assert.equal(em.state.error, null);
});

test('pending model draft survives time and measurement updates until a valid apply', () => {
  const em = createEMState();
  em.evaluate();
  em.setPoint([0, 0, 0]);
  em.setScene('wave');
  const previousSnapshot = em.state.lastValid;

  em.setDraft('amplitude', '');
  const draftError = em.state.error;
  assert.equal(em.setTime(0.25), null);
  assert.equal(em.state.timeCycles, 0.25);
  assert.strictEqual(em.state.lastValid, previousSnapshot);
  assert.equal(em.state.previous, true);
  assert.equal(em.state.error, draftError);
  assert.equal(em.state.draft.amplitude, '');

  assert.equal(em.setPoint([0.1, 0, 0]), null);
  assert.deepEqual(em.state.point, [0, 0, 0]);
  assert.strictEqual(em.state.lastValid, previousSnapshot);
  assert.equal(em.state.previous, true);
  assert.equal(em.state.error, draftError);

  assert.equal(em.setTime(0.5), null);
  assert.equal(em.state.timeCycles, 0.5);
  assert.strictEqual(em.state.lastValid, previousSnapshot);
  const recovered = em.apply({ amplitude: 0 });
  assert.ok(recovered);
  assert.equal(recovered.timeCycles, 0.5);
  assert.equal(em.state.models.wave.amplitude, 0);
  assert.deepEqual(em.state.draft, {});
  assert.equal(em.state.previous, false);
  assert.equal(em.state.error, null);
});
