import test from "node:test";
import assert from "node:assert/strict";
import { createEMState, SCENE_VIEWS } from "../../src/em-state.js";
import { parseEMNumber } from "../../src/em-controller.js";

test('a scene starts with its own sensor point and plane, and playback never auto-resumes', () => {
  const em = createEMState();
  assert.equal(em.state.playing, false);
  assert.equal(em.evaluate().result.status, 'valid');
  em.state.playing = true;
  em.setActive(false);
  assert.equal(em.state.playing, false);
  em.setActive(true);
  assert.equal(em.state.playing, false);
  for (const name of ['dipole', 'line', 'loop', 'wave', 'charge']) {
    const snapshot = em.setScene(name);
    assert.equal(snapshot.sceneName, name);
    assert.deepEqual(em.state.point, SCENE_VIEWS[name].point);
    assert.equal(em.state.slice, SCENE_VIEWS[name].plane);
  }
  assert.equal(em.setScene('nope'), null);
  em.destroy();
  assert.equal(em.inspect().destroyed, true);
});

test('live edits apply at once; an invalid value is rejected and the last valid state stays', () => {
  const em = createEMState();
  em.evaluate();
  const before = em.state.lastValid;
  assert.ok(em.apply({ q: 2e-9 }));
  assert.equal(em.state.models.charge.q, 2e-9);
  assert.equal(em.apply({ q: 2e-6 }), null);
  assert.match(em.state.error, /범위/);
  assert.equal(em.state.models.charge.q, 2e-9, 'the rejected value is not stored');
  assert.equal(em.state.lastValid.model.q, 2e-9);
  assert.notStrictEqual(em.state.lastValid, before);
  assert.ok(em.apply({ q: -1e-9 }));
  assert.equal(em.state.error, null);
});

test('the sensor can enter an exclusion zone but not leave the model range', () => {
  const em = createEMState();
  em.evaluate();
  assert.equal(em.setPoint([21, 0, 0]), null);
  assert.deepEqual(em.state.point, [1, 0, 0]);
  assert.equal(em.setPoint([0, 0, 0]).result.status, 'excluded');
  assert.deepEqual(em.state.point, [0, 0, 0]);
  assert.equal(em.setPoint([2, 0, 0]).result.status, 'valid');
  assert.equal(em.state.error, null);
});

test('changing the wave frequency keeps the sensor at the same place in wavelengths', () => {
  const em = createEMState();
  em.setScene('wave');
  em.setPoint([0, 0, 75]);
  assert.ok(em.apply({ frequency: 1e7 }));
  assert.ok(Math.abs(em.state.point[2] - 7.5) < 1e-9);
  assert.equal(em.setPoint([0, 0, 100]), null, 'beyond 2 wavelengths is rejected');
  assert.match(em.state.error, /−2λ…2λ/);
  assert.deepEqual(em.state.point, [0, 0, 7.5]);
});

test('parseEMNumber rejects empty and non-finite text, and accepts zero', () => {
  assert.throws(() => parseEMNumber(''), /빈값/);
  assert.throws(() => parseEMNumber('   '), /빈값/);
  assert.throws(() => parseEMNumber('abc'), /유한/);
  assert.equal(parseEMNumber('0'), 0);
  assert.equal(parseEMNumber(' 2.5e-3 '), 0.0025);
});

test('setTime ignores non-finite input and clamps to 0..2 periods', () => {
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
  assert.equal(em.state.lastValid.timeCycles, 0);
});

test('the viewed plane can be changed for a scene and rejects unknown planes', () => {
  const em = createEMState();
  assert.equal(em.setSlice('yz'), true);
  assert.equal(em.state.slice, 'yz');
  assert.equal(em.setSlice('ab'), false);
  assert.equal(em.state.slice, 'yz');
});
