import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlaneLines, createSandboxField, createSceneField, sampleScalarGrid, sampleVectorGrid, sceneChargeSources, toDisplay, toMetres } from '../../src/em-plane-field.js';
import { createEMState, DEFAULT_SCENES } from '../../src/em-state.js';
import { createSceneMode } from '../../src/em-plane-modes.js';
import { K, MU0 } from '../../src/em-physics.js';
import { validatePointSources } from '../../src/em-playground-physics.js';

const area = { aMin: -2, aMax: 2, bMin: -1, bMax: 1 };
const sources = validatePointSources([
  { id: 'a', q: 1e-9, position: [-0.75, 0, 0] }, { id: 'b', q: -1e-9, position: [0.75, 0, 0] },
]);

test('sandbox scalar grid is the potential, antisymmetric for a dipole, NaN only in exclusion zones', () => {
  const field = createSandboxField(sources);
  const grid = sampleScalarGrid(field, 'xy', 0, area, 41, 21);
  assert.equal(grid.values.length, 41 * 21);
  const at = (col, row) => grid.values[row * 41 + col];
  assert.ok(Math.abs(at(5, 3) + at(35, 3)) < 1e-9 * Math.abs(at(5, 3)), 'V(x) = -V(-x) at equal |x|');
  assert.ok(at(10, 10) > 0 && at(30, 10) < 0);
  assert.ok(Math.abs(at(20, 10)) < 1e-6, 'zero on the bisector');
  const near = field.evaluate([-0.75 + 0.5, 0, 0]);
  assert.ok(Math.abs(near.scalar - K * 1e-9 / 0.5 + K * 1e-9 / 1.0) < 1e-6);
  const inside = sampleScalarGrid(field, 'xy', 0, { aMin: -0.75, aMax: -0.75, bMin: 0, bMax: 0 }, 2, 2);
  assert.ok(inside.values.every(Number.isNaN));
});

test('vector grid gives in-plane components along the plane axes', () => {
  const field = createSandboxField(sources);
  const arrows = sampleVectorGrid(field, 'xz', 0, area, 4, 2);
  assert.equal(arrows.length, 8);
  for (const arrow of arrows) assert.ok(arrow.magnitude <= arrow.full + 1e-12);
  const same = sampleVectorGrid(field, 'xy', 0, area, 4, 2);
  assert.ok(same.every(a => Math.abs(a.magnitude - a.full) < 1e-9), 'planar sources: E lies in the xy plane');
});

test('line current scene: B circles the wire, scalar is |B|', () => {
  const field = createSceneField(DEFAULT_SCENES.line);
  const result = field.evaluate([1, 0, 0]);
  assert.ok(Math.abs(result.vector[1] - MU0 / (2 * Math.PI)) < 1e-15);
  assert.equal(result.scalar, Math.hypot(...result.vector));
  assert.equal(field.evaluate([0.0004, 0, 0]).status, 'excluded');
  assert.equal(field.electric, false);
});

test('charge scene uses the potential as scalar; loop excludes the wire neighbourhood', () => {
  const charge = createSceneField(DEFAULT_SCENES.charge).evaluate([2, 0, 0]);
  assert.ok(Math.abs(charge.scalar - K * 1e-9 / 2) < 1e-9);
  const loop = createSceneField(DEFAULT_SCENES.loop);
  assert.equal(loop.evaluate([1, 0, 0]).status, 'excluded');
  const centre = loop.evaluate([0, 0, 0]);
  assert.ok(Math.abs(centre.vector[2] - MU0 * 1 / (2 * 1)) / (MU0 / 2) < 1e-6);
});

test('wave scene is shown in wavelengths and moves with time', () => {
  const model = DEFAULT_SCENES.wave;
  const early = createSceneField(model, 0), later = createSceneField(model, 0.25);
  assert.ok(early.unit > 1);
  const here = early.evaluate([0, 0, 0]), then = later.evaluate([0, 0, 0]);
  assert.ok(Math.abs(here.scalar - model.amplitude) < 1e-9, 'peak E at t=0, phase 0, origin');
  assert.ok(Math.abs(then.scalar) < 1e-9, 'a quarter period later the field at the origin is zero');
  assert.deepEqual(toDisplay(early, toMetres(early, [1, 0, -2])), [1, 0, -2]);
});

test('an out-of-range point is reported as excluded instead of throwing', () => {
  const field = createSandboxField(sources);
  assert.equal(field.evaluate([0.75, 0, 0]).status, 'excluded');
  assert.equal(field.evaluate([100, 0, 0]).status, 'excluded');
  const dipole = createSceneField({ ...DEFAULT_SCENES.dipole, separation: 1 });
  assert.equal(dipole.evaluate([100, 0, 0]).status, 'excluded');
});

test('sandbox lines come from every source and draft quality is lighter than final', () => {
  const field = createSandboxField(sources), wide = { aMin: -4, aMax: 4, bMin: -3, bMax: 3 };
  const final = computePlaneLines(field, { plane: 'xy', fixed: 0, area: wide, sources, quality: 'final' });
  const draft = computePlaneLines(field, { plane: 'xy', fixed: 0, area: wide, sources, quality: 'draft' });
  assert.ok(final.length > draft.length && draft.length >= 3);
  for (const line of final) assert.ok(line.points.every(p => p[2] === 0), 'lines stay in the view plane');
});

test('a line current scene yields closed lines around the wire in both directions', () => {
  const model = DEFAULT_SCENES.line, field = createSceneField(model);
  const lines = computePlaneLines(field, { plane: 'xy', fixed: 0, area: { aMin: -2, aMax: 2, bMin: -2, bMax: 2 }, model });
  assert.ok(lines.length >= 4);
  const ring = lines[0].points;
  const radius = p => Math.hypot(p[0], p[1]);
  assert.ok(Math.abs(radius(ring[0]) - radius(ring[Math.floor(ring.length / 2)])) < 0.02, 'a circle around the axis');
});

test('electric scenes reuse charge seeding; the plane wave has no lines', () => {
  const mid = { aMin: -3, aMax: 3, bMin: -2, bMax: 2 };
  const dipole = DEFAULT_SCENES.dipole;
  assert.deepEqual(sceneChargeSources(dipole).map(s => s.q), [1e-9, -1e-9]);
  const lines = computePlaneLines(createSceneField(dipole), { plane: 'xy', fixed: 0, area: mid, model: dipole });
  assert.ok(lines.length >= 6);
  assert.deepEqual(computePlaneLines(createSceneField(DEFAULT_SCENES.wave), { plane: 'xz', fixed: 0, area: mid, model: DEFAULT_SCENES.wave }), []);
});

test('current loop: the sensor and a finished render use the converged field (I = 1 A, R = 1 m, point 0.021 m from the wire)', () => {
  const point = [1.021, 0, 0];
  const converged = createSceneField(DEFAULT_SCENES.loop).evaluate(point);
  assert.equal(converged.status, 'valid');
  assert.ok(Math.abs(converged.vector[2] + 8.937e-6) / 8.937e-6 < 1e-3, `${converged.vector[2]} vs -8.937 uT`);
  // the coarse 64-segment sum (kept only for the in-drag draft) is off by 74% here
  const draft = createSceneField(DEFAULT_SCENES.loop, 0, 'draft').evaluate(point);
  assert.ok(Math.abs(draft.vector[2] + 2.297e-6) / 2.297e-6 < 1e-3, `${draft.vector[2]} vs -2.297 uT`);
  assert.ok(Math.abs(draft.vector[2] / converged.vector[2] - 1) > 0.7);
  // far from the wire both qualities agree to rounding
  const far = [0.2, 0.1, 0.3];
  const a = createSceneField(DEFAULT_SCENES.loop).evaluate(far).vector, b = createSceneField(DEFAULT_SCENES.loop, 0, 'draft').evaluate(far).vector;
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(a[i] - b[i]) <= 1e-12 * Math.hypot(...a));
});

test('the scene mode hands out the draft field only on request and caches the two qualities apart', () => {
  const store = createEMState();
  store.setScene('loop');
  const mode = createSceneMode(store);
  const final = mode.field(), draft = mode.field('draft');
  assert.notEqual(final, draft);
  assert.notEqual(mode.fieldKey('draft'), mode.fieldKey('final'));
  assert.equal(mode.field('final'), final);
  assert.equal(mode.field(), final, 'converged by default (the sensor)');
  const point = [1.021, 0, 0];
  assert.ok(Math.abs(final.evaluate(point).vector[2] + 8.937e-6) < 1e-8);
  assert.ok(Math.abs(draft.evaluate(point).vector[2] + 2.297e-6) < 1e-8);
});
