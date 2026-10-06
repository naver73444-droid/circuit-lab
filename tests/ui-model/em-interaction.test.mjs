import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteraction } from '../../src/em-interaction.js';
import { beginPlaneGrab, grabTarget, screenRay } from '../../src/em-playground-interaction.js';
import { createPointChargeEditor } from '../../src/em-playground-state.js';

test('one shared interaction state: any holder makes it active, begin() cancels pending work and outdates its generation', () => {
  const state = createInteraction();
  let cancelled = 0;
  state.onBegin(() => { cancelled += 1; });
  assert.equal(state.active, false);
  const before = state.generation;
  assert.equal(state.isCurrent(before), true);
  state.begin('plane');
  assert.equal(state.active, true);
  assert.equal(cancelled, 1);
  assert.equal(state.isCurrent(before), false, 'a callback scheduled before the drag is outdated');
  state.begin('3d');
  state.begin('gauss-slider');
  assert.equal(cancelled, 3);
  assert.equal(state.end('plane'), true);
  assert.equal(state.active, true, 'a 3D drag and the radius slider still count');
  state.end('3d');
  state.end('gauss-slider');
  assert.equal(state.active, false);
  assert.equal(state.isCurrent(before), false, 'still outdated after the interaction ended');
  assert.equal(state.isCurrent(state.generation), true);
  assert.equal(state.end('plane'), false, 'ending twice is harmless');
  state.begin('a');
  state.begin('b');
  state.endAll();
  assert.equal(state.active, false);
});

test('a precise computation scheduled before a drag never commits: the generation check discards it', () => {
  // The plane controller schedules with `generation = interaction.generation` and commits only if isCurrent(generation).
  const state = createInteraction();
  const committed = [];
  const schedule = () => {
    const generation = state.generation;
    return () => { if (state.isCurrent(generation)) committed.push(generation); };
  };
  const timerA = schedule();
  state.begin('3d'); // a 3D drag or the radius slider starts before the timer fires
  timerA();
  state.end('3d');
  assert.deepEqual(committed, [], 'the callback of the old generation is dropped');
  const timerB = schedule();
  timerB();
  assert.equal(committed.length, 1, 'a timer scheduled while idle and not interrupted commits');
  const timerC = schedule();
  state.begin('gauss-slider');
  timerC();
  assert.equal(committed.length, 1, 'still dropped while the slider is held');
});

// ---- the 3D drag of a finite-line end point ---------------------------------------------------------------------------

const rect = { left: 0, top: 0, width: 800, height: 600 };
const camera = { yaw: -0.7, pitch: 0.45, distance: 7 };

// The canvas pixel where a 3D point appears for `camera` (inverse of screenRay by search along the screen).
function pixelOf(point) {
  let best = null;
  for (let x = 0; x <= 800; x += 4) {
    for (let y = 0; y <= 600; y += 4) {
      const ray = screenRay(rect, x, y, camera), d = [0, 1, 2].map(i => point[i] - ray.origin[i]);
      const along = d[0] * ray.direction[0] + d[1] * ray.direction[1] + d[2] * ray.direction[2];
      const miss = Math.hypot(...[0, 1, 2].map(i => d[i] - along * ray.direction[i]));
      if (!best || miss < best.miss) best = { x, y, miss };
    }
  }
  return best;
}

test('grabbing a finite-line end point in 3D does not jump: the gesture keeps the plane through the grabbed handle', () => {
  const editor = createPointChargeEditor({ sources: [{ id: 'f', type: 'finite-line', lambda: 1e-9, start: [-1, 0, 0], end: [1, 0, 1] }], selectedId: 'f' });
  const source = editor.state.sources[0], end = [...source.end];
  const { x, y } = pixelOf(end);
  const ray = screenRay(rect, x, y, camera);
  // pointerdown: the grab fixes the plane at the handle's normal coordinate (z = 1), not the centre's (z = 0.5)
  const grab = beginPlaneGrab(ray, 'xy', end);
  assert.equal(grab.constant, 1);
  assert.ok(editor.beginDrag('f', 'xy', 'end', end));
  // the first move with the pointer unmoved keeps the end exactly where it was
  const target = grabTarget(grab, ray);
  assert.ok(target.every((value, i) => Math.abs(value - end[i]) < 1e-9), `${target} vs ${end}`);
  assert.ok(editor.previewDrag(target));
  assert.ok(editor.state.sources[0].end.every((value, i) => Math.abs(value - end[i]) < 1e-9), 'no jump at the first move');
  // the old code intersected the plane through the line's centre (z = 0.5): half a metre away from the handle's plane
  const wrongPlane = beginPlaneGrab(ray, 'xy', [0, 0, 0.5]);
  const jumped = grabTarget({ ...grab, constant: wrongPlane.constant }, ray);
  assert.ok(Math.hypot(...jumped.map((value, i) => value - end[i])) > 0.1, 'the centre plane gives a different point (the jump)');
  // moving the pointer moves the end inside the same plane (z stays 1)
  const moved = grabTarget(grab, screenRay(rect, x + 40, y - 20, camera));
  assert.ok(Math.abs(moved[2] - 1) < 1e-9);
  assert.ok(editor.commitDrag(moved));
  assert.equal(editor.state.sources[0].end[2], 1);
  assert.deepEqual(editor.state.sources[0].start, [-1, 0, 0], 'the other end stays');
});

test('beginPlaneGrab and grabTarget refuse a ray that never meets the plane', () => {
  const parallel = { origin: [0, 0, 5], direction: [1, 0, 0] };
  assert.equal(beginPlaneGrab(parallel, 'xy', [0, 0, 1]), null);
  assert.equal(grabTarget(null, parallel), null);
});

// A hand-driven clock for the pulse tests.
function fakeTimers() {
  let now = 0, next = 1;
  const pending = new Map();
  return {
    setTimer: (callback, delay) => { const id = next++; pending.set(id, { callback, at: now + delay }); return id; },
    clearTimer: id => { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, item] of [...pending]) if (item.at <= now) { pending.delete(id); item.callback(); }
    },
    get count() { return pending.size; },
  };
}

test('a pulse (wheel turn, resize) is an interaction until 150 ms after its LAST event, then settles once', () => {
  const timers = fakeTimers(), state = createInteraction(timers);
  let settled = 0, cancelled = 0;
  state.onBegin(() => { cancelled += 1; });
  state.pulse('plane-view', 150, () => { settled += 1; });
  assert.equal(state.active, true);
  assert.equal(cancelled, 1, 'precise work is cancelled when the burst starts');
  timers.advance(100);
  state.pulse('plane-view', 150, () => { settled += 1; }); // the next wheel tick restarts the wait
  timers.advance(100);
  assert.equal(state.active, true, 'still inside the burst');
  assert.equal(settled, 0);
  assert.equal(timers.count, 1, 'one timer for the whole burst');
  timers.advance(60);
  assert.equal(settled, 1);
  assert.equal(state.active, false);
  assert.equal(state.isCurrent(state.generation), true);
  assert.equal(timers.count, 0);
});

test('ending a pulse early, or endAll(), cancels its settle callback', () => {
  const timers = fakeTimers(), state = createInteraction(timers);
  let settled = 0;
  state.pulse('plane-view', 150, () => { settled += 1; });
  assert.equal(state.end('plane-view'), true);
  timers.advance(500);
  assert.equal(settled, 0);
  state.pulse('plane-view', 150, () => { settled += 1; });
  state.begin('plane');
  state.endAll();
  timers.advance(500);
  assert.equal(settled, 0);
  assert.equal(state.active, false);
});
