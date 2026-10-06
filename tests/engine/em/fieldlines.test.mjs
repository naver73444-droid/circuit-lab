import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSegmentToBox, lineChargeStop, seedsAroundSources, traceSourceLines, traceStreamline } from '../../../src/em-fieldlines.js';
import { createPointChargeEvaluator, validatePointSources } from '../../../src/em-playground-physics.js';
import { MU0 } from '../../../src/em-physics.js';

const point = (id, q, x, y) => ({ id, type: 'point', q, position: [x, y, 0], enabled: true, visible: true });
const planeOptions = { axes: [0, 1], normal: 2, fixed: 0, bounds: { aMin: -4, aMax: 4, bMin: -3, bMax: 3 } };
const fieldOf = sources => {
  const evaluate = createPointChargeEvaluator(validatePointSources(sources));
  return p => { const r = evaluate(p); return r.status === 'valid' ? r.E : null; };
};
const angleOf = ([x, y], [cx, cy]) => Math.atan2(y - cy, x - cx);

test('lines of a single positive charge are straight radial rays that leave the bounds', () => {
  const sources = [point('a', 1e-9, 0, 0)];
  const lines = traceSourceLines(sources, fieldOf(sources), planeOptions);
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    assert.equal(line.end.reason, 'bounds');
    const first = angleOf(line.points[0], [0, 0]);
    for (const p of line.points) {
      const d = Math.atan2(Math.sin(angleOf(p, [0, 0]) - first), Math.cos(angleOf(p, [0, 0]) - first));
      assert.ok(Math.abs(d) < 1e-6, 'a radial line keeps its polar angle');
    }
  }
});

test('lines of a negative charge are traced outward and also leave the bounds', () => {
  const sources = [point('a', -1e-9, 0, 0)];
  const lines = traceSourceLines(sources, fieldOf(sources), planeOptions);
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    assert.equal(line.end.reason, 'bounds');
    const radius = p => Math.hypot(p[0], p[1]);
    assert.ok(radius(line.points.at(-1)) > radius(line.points[0]), 'runs away from the charge');
  }
});

test('a dipole has lines that end on the opposite charge, and no duplicates from the negative side', () => {
  const sources = [point('p', 1e-9, -0.75, 0), point('n', -1e-9, 0.75, 0)];
  const lines = traceSourceLines(sources, fieldOf(sources), planeOptions);
  const connecting = lines.filter(line => line.end.reason === 'stop');
  assert.ok(connecting.length >= 2, 'several lines run + to -');
  assert.ok(connecting.every(line => line.sourceId === 'p'), 'only the positive charge owns connecting lines');
  const stop = connecting[0].points.at(-1);
  assert.deepEqual([stop[0], stop[1]], [0.75, 0]);
  assert.ok(lines.some(line => line.end.reason === 'bounds' && line.sourceId === 'n'), 'negative side keeps lines that escape');
});

test('seed count follows source strength and stays within 3..max', () => {
  const sources = [point('big', 4e-9, 0, 0), point('small', 1e-9, 2, 0)];
  const seeds = seedsAroundSources(sources, { axes: [0, 1], normal: 2, fixed: 0, maxPerSource: 12 });
  const count = id => seeds.filter(seed => seed.sourceId === id).length;
  assert.equal(count('big'), 12);
  assert.equal(count('small'), 3);
  assert.ok(seeds.every(seed => seed.point[2] === 0));
});

test('disabled or zero sources emit nothing', () => {
  const sources = [{ ...point('off', 1e-9, 0, 0), enabled: false }, point('zero', 0, 1, 0)];
  assert.deepEqual(seedsAroundSources(sources, { axes: [0, 1], normal: 2, fixed: 0 }), []);
});

test('a null field stops the line as excluded and a zero field as zero', () => {
  const base = { seed: [0, 0], bounds: { min: [-1, -1], max: [1, 1] } };
  assert.equal(traceStreamline({ ...base, field: () => null }).end.reason, 'excluded');
  assert.equal(traceStreamline({ ...base, field: () => [0, 0] }).end.reason, 'zero');
  assert.equal(traceStreamline({ ...base, field: () => [1, 0], maxSteps: 3 }).end.reason, 'max-steps');
});

test('a rotational field gives a closed line', () => {
  const curl = ([x, y]) => [-y, x];
  const traced = traceStreamline({
    field: curl, seed: [1, 0], bounds: { min: [-3, -3], max: [3, 3] }, step: { min: 0.01, max: 0.08, fraction: 1 },
    maxSteps: 1200,
  });
  assert.equal(traced.end.reason, 'closed');
  for (const [x, y] of traced.points) assert.ok(Math.abs(Math.hypot(x, y) - 1) < 5e-3, 'RK2 keeps the circle radius');
});

test('a line source of current-like field direction is followed in 2D projection', () => {
  const field = ([x, y]) => [-y, x].map(v => v * MU0);
  const traced = traceStreamline({ field, seed: [0.5, 0], bounds: { min: [-1, -1], max: [1, 1] }, maxSteps: 50 });
  assert.ok(traced.points.length > 5);
  assert.ok(traced.points[5][1] > 0, 'counter-clockwise for +z');
});

test('infinite and finite lines are seeded on both sides of the line', () => {
  const sources = validatePointSources([
    { id: 'f', type: 'finite-line', lambda: 1e-9, start: [-1, 0, 0], end: [1, 0, 0] },
    { id: 'i', type: 'infinite-line', lambda: -1e-9, position: [0, 1.5, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  const seeds = seedsAroundSources(sources, { axes: [0, 1], normal: 2, fixed: 0 });
  const finite = seeds.filter(seed => seed.sourceId === 'f');
  assert.ok(finite.some(seed => seed.point[1] > 0) && finite.some(seed => seed.point[1] < 0));
  const lines = traceSourceLines(sources, fieldOf(sources), planeOptions);
  assert.ok(lines.length >= 6);
});

test('a streamline stops where the field reverses instead of zigzagging', () => {
  // Field points toward +x for x < 1 and toward -x beyond: a stable null at x = 1.
  const field = ([x]) => [x < 1 ? 1 : -1, 0];
  const traced = traceStreamline({ field, seed: [0, 0], bounds: { min: [-5, -5], max: [5, 5] }, step: { min: 0.05, max: 0.05, fraction: 1 }, maxSteps: 200 });
  assert.equal(traced.end.reason, 'zero');
  assert.ok(traced.points.at(-1)[0] < 1.2, 'it ends at the null');
  assert.ok(traced.points.length < 40);
});

test('lines too short to read are dropped', () => {
  const sources = [point('a', 1e-9, 0, 0), point('b', -1e-9, 0.2, 0)];
  const lines = traceSourceLines(sources, fieldOf(sources), { ...planeOptions, ring: 0.12 });
  assert.ok(lines.every(line => line.points.length >= 4 || line.end.reason === 'stop'));
});

const traced = sources => {
  const valid = validatePointSources(sources);
  return { valid, lines: traceSourceLines(valid, fieldOf(valid), planeOptions) };
};

test('a positive line charge facing a negative one: lines end ON the negative line with a charge terminator, never past it', () => {
  const { lines } = traced([
    { id: 'p', type: 'infinite-line', lambda: 1e-9, position: [0, 1, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
    { id: 'n', type: 'infinite-line', lambda: -1e-9, position: [0, -1, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  const absorbed = lines.filter(line => line.end.reason === 'charge');
  assert.ok(absorbed.length >= 4, 'several lines run from + to -');
  assert.ok(absorbed.every(line => line.sourceId === 'p'), 'only the positive line owns connecting lines');
  for (const line of absorbed) assert.ok(Math.abs(line.points.at(-1)[1] + 1) < 1e-9, 'the last point sits on the negative line');
  for (const line of lines) assert.ok(line.points.every(p => p[1] > -1 - 1e-9 || line.sourceId === 'n'), 'no line crosses y = -1 from above');
  assert.equal(lines.filter(line => line.end.reason === 'zero').length, 0, 'no line dies of a field reversal behind the charge');
});

test('finite line charges are absorbing too (segment test, not only the end point)', () => {
  const { lines } = traced([
    { id: 'p', type: 'finite-line', lambda: 1e-9, start: [-1, 1, 0], end: [1, 1, 0] },
    { id: 'n', type: 'finite-line', lambda: -1e-9, start: [-1, -1, 0], end: [1, -1, 0] },
  ]);
  const absorbed = lines.filter(line => line.end.reason === 'charge');
  assert.ok(absorbed.length >= 4);
  for (const line of absorbed) {
    const [x, y] = line.points.at(-1);
    assert.ok(Math.abs(y + 1) < 1e-9 && x >= -1 - 1e-9 && x <= 1 + 1e-9, 'ends on the segment');
  }
});

test('a step that would jump over a thin line charge is caught by the segment test', () => {
  const traces = traceStreamline({
    field: () => [1, 0], seed: [-1, 0], bounds: { min: [-5, -5], max: [5, 5] }, step: { min: 1, max: 1, fraction: 1 },
    stops: [{ center: [0.4, -2], end: [0.4, 2], radius: 0.02, reason: 'charge' }],
  });
  assert.equal(traces.end.reason, 'charge');
  assert.ok(Math.abs(traces.points.at(-1)[0] - 0.4) < 1e-12);
});

test('a line charge perpendicular to the view plane is seeded by a ring around the point where it pierces the plane', () => {
  for (const source of [
    { id: 'q1', type: 'infinite-line', lambda: 1e-9, position: [0.5, -0.25, 0], direction: [0, 0, 1], sRef: 1, displayLength: 4 },
    { id: 'q1', type: 'finite-line', lambda: 1e-9, start: [0.5, -0.25, -1], end: [0.5, -0.25, 1] },
  ]) {
    const valid = validatePointSources([source]);
    const seeds = seedsAroundSources(valid, { axes: [0, 1], normal: 2, fixed: 0, maxPerSource: 12 });
    assert.ok(seeds.length >= 3, `${source.type}: seeds exist`);
    for (const seed of seeds) assert.ok(Math.abs(Math.hypot(seed.point[0] - 0.5, seed.point[1] + 0.25) - 0.12) < 1e-9, 'on a ring of radius 0.12');
    const lines = traceSourceLines(valid, fieldOf(valid), planeOptions);
    assert.ok(lines.length >= 3, `${source.type}: field lines exist (the default xy examples had none)`);
    assert.ok(lines.every(line => line.end.reason === 'bounds'), 'radial lines leave the view');
  }
});

test('a line charge that does not touch the view plane neither absorbs lines nor hides the ones around it', () => {
  const offset = validatePointSources([{ id: 'f', type: 'finite-line', lambda: 1e-9, start: [-1, 0, 0.5], end: [1, 0, 0.5] }]);
  assert.equal(lineChargeStop(offset[0], { axes: [0, 1], normal: 2, fixed: 0, radius: 0.06 }), null);
  const inPlane = lineChargeStop(offset[0], { axes: [0, 1], normal: 2, fixed: 0.5, radius: 0.06 });
  assert.deepEqual([inPlane.center, inPlane.end, inPlane.reason], [[-1, 0], [1, 0], 'charge']);
});

test('clipSegmentToBox keeps the part of a segment inside the box and rejects a miss', () => {
  const box = { aMin: -3, aMax: 3, bMin: -2, bMax: 2 };
  assert.deepEqual(clipSegmentToBox([-15, 0.5], [15, 0.5], box), [0.4, 0.6]);
  assert.deepEqual(clipSegmentToBox([-1, 0], [1, 1], box), [0, 1], 'a segment inside is returned whole');
  assert.equal(clipSegmentToBox([-15, 5], [15, 5], box), null);
  assert.equal(clipSegmentToBox([5, -5], [6, 5], box), null);
});

test('line charges are seeded along their visible part: a long or off-centre line keeps its full share of lines', () => {
  const bounds = { aMin: -3, aMax: 3, bMin: -2, bMax: 2 }, options = { axes: [0, 1], normal: 2, fixed: 0, maxPerSource: 12 };
  const count = (source, view) => seedsAroundSources(validatePointSources([source]), { ...options, bounds: view }).length;
  const finite = { id: 'f', type: 'finite-line', lambda: 1e-9, start: [-15, 0.5, 0], end: [15, 0.5, 0] };
  assert.equal(count(finite, null), 12, 'without a view the seeds spread over all 30 m (only ~4 of them would be visible)');
  assert.equal(count(finite, bounds), 12);
  const inView = seedsAroundSources(validatePointSources([finite]), { ...options, bounds });
  assert.ok(inView.every(seed => Math.abs(seed.point[0]) <= 3 + 1e-9 && Math.abs(seed.point[1] - 0.5) <= 0.12 + 1e-9), 'every seed is inside the view');
  // an infinite line whose reference point (and displayed stretch) is far off screen but which crosses the view
  const infinite = { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [15, 0.5, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 };
  assert.equal(count(infinite, null), 12, 'the old seeding: a displayed stretch around the off-screen point, no line in the view');
  assert.equal(seedsAroundSources(validatePointSources([infinite]), { ...options, bounds: null }).filter(
    seed => Math.abs(seed.point[0]) <= 3).length, 0);
  assert.equal(count(infinite, bounds), 12);
  assert.ok(seedsAroundSources(validatePointSources([infinite]), { ...options, bounds }).every(seed => Math.abs(seed.point[0]) <= 3 + 1e-9));
  // a line wholly outside the view gets none
  assert.equal(count({ ...finite, start: [-15, 5, 0], end: [15, 5, 0] }, bounds), 0);
});

test('field lines of an off-screen-centred infinite line and of a 30 m finite line are traced in the view', () => {
  const bounds = { aMin: -3, aMax: 3, bMin: -2, bMax: 2 };
  for (const source of [
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [15, 0.5, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
    { id: 'f', type: 'finite-line', lambda: 1e-9, start: [-15, 0.5, 0], end: [15, 0.5, 0] },
  ]) {
    const valid = validatePointSources([source]);
    const lines = traceSourceLines(valid, fieldOf(valid), { axes: [0, 1], normal: 2, fixed: 0, bounds });
    assert.ok(lines.length >= 10, `${source.id}: ${lines.length} lines`);
  }
});
