// Regression tests for the cross-review of the magnetostatic plane sandbox: Ampere loop accuracy / clamping, the one piercing test, clone direction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenSense, validateCurrentSources, viewNormal, wireHit, wirePierces } from '../../../src/em-current-field.js';
import { currentSeeds, wirePierce } from '../../../src/em-current-lines.js';
import { ampereEnclosure, ampereMeasure, clampAmpere } from '../../../src/em-ampere.js';
import { ampereReadout } from '../../../src/em-readout.js';
import { createCurrentEditor } from '../../../src/em-current-state.js';
import { createPointChargeEditor } from '../../../src/em-playground-state.js';

const wire = (id, current, x, y, direction = [0, 0, 1], z = 0) => ({ id, type: 'wire', current, position: [x, y, z], direction });
const circle = (x, y, radius, orientation = 1) => ({ shape: 'circle', center: [x, y, 0], radius, halfWidth: 1, halfHeight: 1, orientation });
const within = (value, expected, rel) => assert.ok(Math.abs(value - expected) <= rel * Math.max(Math.abs(expected), 1e-12), `${value} vs ${expected}`);

// ---- 8 the circle path is as converged as the rectangle -------------------------------------------------------------------------
test('a wire 0.1 m from a circular path (inside or outside) gives a converged circulation and the "일치" readout', () => {
  for (const [x, enclosed] of [[0.9, 10], [1.1, 0], [0.98, 10], [1.02, 0]]) {
    const sources = validateCurrentSources([wire('W', 10, x, 0)]);
    const measure = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
    assert.equal(measure.numeric.status, 'valid', `x = ${x}`);
    assert.equal(measure.numeric.converged, true, `x = ${x}: converged`);
    assert.ok(Math.abs(measure.numeric.circulation - enclosed) < 1e-6, `x = ${x}: ${measure.numeric.circulation}`);
    const readout = ampereReadout({ enclosure: measure.enclosure, numeric: measure.numeric, precise: true });
    assert.equal(readout.agrees, true, `x = ${x}`);
    assert.match(readout.stateText, /일치/);
  }
});

test('the precise circle still reports 미수렴 (converged: false) when a wire sits 2 mm from the path (the last doubling still changes the value)', () => {
  const sources = validateCurrentSources([wire('W', 10, 1 - 2e-3, 0)]);
  const measure = ampereMeasure(sources, circle(0, 0, 1), 'xy', { precise: true });
  assert.equal(measure.numeric.status, 'valid');
  assert.equal(measure.numeric.converged, false);
  assert.equal(measure.numeric.samples, 16384);
  within(measure.numeric.circulation, 10, 1e-6); // the value itself is already right; only the proof of convergence is missing
  const readout = ampereReadout({ enclosure: measure.enclosure, numeric: measure.numeric, precise: true });
  assert.equal(readout.agrees, null);
  assert.equal(readout.stateText, '미수렴');
});

// ---- 9 clampAmpere ---------------------------------------------------------------------------------------------------------------
test('clampAmpere never passes NaN or Infinity through: previous finite value, else default; finite values still clamp', () => {
  const previous = { shape: 'circle', radius: 2, halfWidth: 3, halfHeight: 1.5, center: [1, -2, 0.5], orientation: 1 };
  const bad = clampAmpere({ shape: 'circle', radius: NaN, halfWidth: Infinity, halfHeight: -Infinity, center: [NaN, Infinity, undefined], orientation: 1 }, previous);
  assert.deepEqual([bad.radius, bad.halfWidth, bad.halfHeight], [2, 3, 1.5]);
  assert.deepEqual(bad.center, [1, -2, 0.5]);
  const fresh = clampAmpere({ shape: 'circle', radius: NaN, center: [NaN, NaN, NaN] });
  assert.deepEqual([fresh.radius, fresh.halfWidth, fresh.halfHeight], [1, 1, 0.7]);
  assert.deepEqual(fresh.center, [0, 0, 0]);
  for (const key of ['radius', 'halfWidth', 'halfHeight']) assert.ok(Number.isFinite(fresh[key]), key);
  const clamped = clampAmpere({ shape: 'circle', radius: 99, center: [100, -100, 0] });
  assert.equal(clamped.radius, 5);
  assert.deepEqual(clamped.center, [15, -15, 0]);
  assert.equal(clampAmpere({ shape: 'rect', radius: 1, halfWidth: 0.001, halfHeight: 7, center: [0, 0, 0] }).halfWidth, 0.05);
});

// ---- 10 one piercing test for the Ampere count, the dot / cross symbol and the field-line seeds ------------------------------------
const slanted = along => [Math.sqrt(1 - along * along), 0, along];

test('a slanted wire (|along| < 0.5): what I_enc counts is what the picture marks and seeds', () => {
  const [source] = validateCurrentSources([wire('W', 10, 0.5, 0.1, slanted(0.3))]);
  const n = viewNormal('xy');
  assert.equal(wirePierces(source.direction, n), true);
  assert.equal(screenSense(source, n), 1, 'the dot / cross symbol is shown');
  const hit = wireHit(source, 'xy', 0);
  assert.deepEqual(hit.map(v => Math.round(v * 1e9) / 1e9), [0.5, 0.1, 0]);
  assert.deepEqual(wirePierce(source, 'xy', 0), hit, 'the field-line module uses the same point');
  const enclosure = ampereEnclosure([source], circle(0, 0, 1), 'xy');
  assert.deepEqual(enclosure.enclosedIds, ['W']);
  assert.equal(enclosure.enclosedCurrent, 10);
  const seeds = currentSeeds([source], 'xy', 0, 5, 7);
  assert.ok(seeds.length >= 7 && seeds.some(seed => Math.hypot(seed.point[0] - 0.5, seed.point[1] - 0.1) < 0.2), 'rings are seeded around the piercing point');
});

test('a wire exactly in the plane pierces nowhere: no symbol, no hit, not counted; a wire meeting the plane far away is seeded like an in-plane line', () => {
  const [flat, almost] = validateCurrentSources([wire('F', 10, 0.5, 0, [1, 0, 0]), wire('A', 10, 0.5, 0, slanted(1e-3), 0.2)]);
  const n = viewNormal('xy');
  assert.equal(wirePierces(flat.direction, n), false);
  assert.equal(screenSense(flat, n), 0);
  assert.equal(wireHit(flat, 'xy', 0), null);
  assert.equal(wirePierces(almost.direction, n), true);
  const far = wireHit(almost, 'xy', 0);
  assert.ok(Math.abs(far[0]) > 100, `the slanted wire meets the plane ${far[0]} m away`);
  const seeds = currentSeeds([almost], 'xy', 0, 5, 7);
  assert.ok(seeds.length > 0 && seeds.every(seed => Math.hypot(seed.point[0] - 0.5, seed.point[1]) < 6), 'seeds stay around the visible wire');
  assert.equal(ampereEnclosure([almost], circle(0, 0, 1), 'xy').enclosedCurrent, 0, 'its piercing point is far outside the loop');
});

test('axis-aligned wires keep their symbols (out +1, in -1) and the usual rings', () => {
  const [out, into] = validateCurrentSources([wire('O', 10, 0, 0), wire('I', -10, 1, 0)]);
  assert.equal(screenSense(out, viewNormal('xy')), 1);
  assert.equal(screenSense(into, viewNormal('xy')), -1);
  assert.deepEqual(wireHit(out, 'xy', 0), [0, 0, 0]);
  assert.ok(currentSeeds([out], 'xy', 0, 5, 7).length >= 7);
});

// ---- 11 the copy steps sideways in the viewed plane --------------------------------------------------------------------------------
test('cloneSelected steps 0.3 m along the horizontal axis of the viewed plane, so the copy is never on top of the original', () => {
  const horizontal = { xy: 0, xz: 0, yz: 1 };
  for (const [plane, axis] of Object.entries(horizontal)) {
    const editor = createCurrentEditor({ sources: [wire('I1', 10, 0, 0)] });
    const id = editor.cloneSelected(plane), [original, copy] = editor.state.sources;
    assert.equal(copy.id, id);
    const delta = copy.position.map((v, i) => v - original.position[i]);
    assert.ok(Math.abs(delta[axis] - 0.3) < 1e-12, `${plane}: ${delta}`);
    assert.ok(delta.every((v, i) => i === axis || v === 0), `${plane}: nothing else moves`);
  }
  const editor = createCurrentEditor();
  editor.cloneSelected();
  assert.ok(Math.abs(editor.state.sources[1].position[0] - 0.3) < 1e-12, 'default plane is xy');
});

test('a segment copy moves both ends in the plane axis; the charge sandbox copy follows the plane too', () => {
  const editor = createCurrentEditor({ sources: [{ id: 'S1', type: 'segment', current: 5, start: [0, 0, 0], end: [0, 1, 0] }] });
  editor.cloneSelected('yz');
  const [first, second] = editor.state.sources;
  for (const key of ['start', 'end']) {
    const delta = second[key].map((v, i) => v - first[key][i]);
    assert.ok(delta[0] === 0 && Math.abs(delta[1] - 0.3) < 1e-12 && delta[2] === 0, `${key}: ${delta}`);
  }
  const charges = createPointChargeEditor(), selectedId = charges.state.selectedId;
  const original = charges.state.sources.find(item => item.id === selectedId), cloneId = charges.cloneSelected('yz');
  const copy = charges.state.sources.find(item => item.id === cloneId);
  assert.ok(cloneId && cloneId !== selectedId);
  assert.ok(Math.abs(copy.position[1] - original.position[1] - 0.2) < 1e-12 && copy.position[0] === original.position[0]);
});
