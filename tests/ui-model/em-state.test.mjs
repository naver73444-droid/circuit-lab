import test from "node:test";
import assert from "node:assert/strict";
import { createEMState } from "../../src/em-state.js";
import { parseEMNumber } from "../../src/em-controller.js";

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

test('EM session is separate, preserves last valid snapshot, and never auto-resumes',()=>{
  const em=createEMState();assert.equal(em.state.playing,false);const first=em.evaluate();assert.equal(first.result.status,'valid');const revision=em.inspect().revision;
  em.setDraft('q','-');assert.equal(em.state.models.charge.q,1e-9);assert.ok(em.inspect().revision>revision);
  assert.equal(em.apply({q:2e-6}),null);assert.equal(em.state.models.charge.q,1e-9);assert.equal(em.state.draft.q,'-');assert.equal(em.state.previous,true);assert.equal(em.state.lastValid.result.status,'valid');assert.match(em.state.error,/범위/);
  assert.throws(()=>parseEMNumber(''),/빈값/);assert.throws(()=>parseEMNumber('   '),/빈값/);assert.equal(parseEMNumber('0'),0);
  // While a model draft is pending the shared point is not moved either (see circuit-023-residual-state).
  assert.equal(em.setPoint([2,0,0]),null);assert.deepEqual(em.state.point,[1,0,0]);assert.equal(em.state.draft.q,'-');
  // A valid apply clears the draft; measurement-point moves are then evaluated: out of range is rejected, the excluded zone is reported.
  assert.ok(em.apply({q:2e-9}));assert.deepEqual(em.state.draft,{});assert.equal(em.state.previous,false);
  assert.equal(em.setPoint([21,0,0]),null);assert.deepEqual(em.state.point,[1,0,0]);assert.equal(em.state.previous,true);
  assert.equal(em.setPoint([0,0,0]).result.status,'excluded');assert.deepEqual(em.state.point,[0,0,0]);assert.equal(em.setPoint([2,0,0]).result.status,'valid');assert.equal(em.state.previous,false);
  em.state.playing=true;em.setActive(false);assert.equal(em.state.playing,false);em.setActive(true);assert.equal(em.state.playing,false);
  em.setScene('wave');assert.equal(em.state.sceneName,'wave');assert.equal(em.state.playing,false);em.setTime(1.25);assert.equal(em.state.timeCycles,1.25);
  em.destroy();assert.equal(em.inspect().destroyed,true);
});

const finite = { id: 'f1', type: 'finite-line', lambda: 2e-9, start: [-1, 2, 0], end: [1, 2.5, 0.3], enabled: true, visible: true };

test('setTime ignores non-finite input and keeps time, snapshot and revision', () => {
  const em = createEMState();
  em.setScene('wave');
  em.setTime(0.5);
  const snapshot = em.state.lastValid, revision = em.inspect().revision;
  for (const bad of [NaN, 'abc', Infinity, -Infinity, undefined]) {
    assert.strictEqual(em.setTime(bad), snapshot);
    assert.equal(em.state.timeCycles, 0.5);
    assert.equal(em.inspect().revision, revision);
  }
  em.setTime(5);
  assert.equal(em.state.timeCycles, 2);
  em.setTime(-1);
  assert.equal(em.state.timeCycles, 0);
});
