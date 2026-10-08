// The plane view's fast paths must not change a single number: the allocation-free samplers, the per-source (superposition)
// grid cache and the field lines traced through them are compared bit for bit (Object.is, so even the sign of zero) with the
// direct evaluation they replace.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePlaneLines, createSandboxField, createSceneField, createSuperpositionSampler, sampleScalarGrid, sampleVectorGrid,
} from '../../../src/em-plane-field.js';
import { createPointChargeEvaluator, createPointChargeSampler, validatePointSources } from '../../../src/em-playground-physics.js';
import { createCurrentPlaneField, validateCurrentSources } from '../../../src/em-current-field.js';
import { createLoopSampler, loopCurrentField } from '../../../src/em-physics.js';
import { DEFAULT_SCENES } from '../../../src/em-state.js';

// A small deterministic generator, so a failure names a reproducible point.
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
const randomPoints = (count, seed, reach = 3) => {
  const next = random(seed);
  return Array.from({ length: count }, () => [0, 1, 2].map(() => (2 * next() - 1) * reach));
};
const same = (actual, expected, what) => assert.ok(Object.is(actual, expected), `${what}: ${actual} !== ${expected}`);

const charge = (id, q, position, extra = {}) => ({ id, type: 'point', q, position, enabled: true, visible: true, ...extra });
const CHARGES = validatePointSources([
  charge('a', 1e-9, [-0.75, 0, 0]), charge('b', -2.5e-9, [0.75, 0.2, 0]), charge('c', 0.3e-9, [0.1, 0.9, 0.4]),
  charge('off', 1e-9, [1, 1, 0], { enabled: false }), charge('zero', 0, [-1, -1, 0]),
  { id: 'f', type: 'finite-line', lambda: 1e-9, start: [-1, -0.6, 0], end: [1, -0.5, 0.1], enabled: true, visible: true },
  { id: 'i', type: 'infinite-line', lambda: -2e-9, position: [0.6, -1.2, 0], direction: [0, 0.3, 1], sRef: 1, displayLength: 4, enabled: true, visible: true },
]);
const CURRENTS = validateCurrentSources([
  { id: 'W1', type: 'wire', current: 10, position: [-0.6, 0.3, 0], direction: [0, 0, 1] },
  { id: 'W2', type: 'wire', current: -7, position: [0.6, 0.3, 0], direction: [0.3, 0.2, 1] },
  { id: 'S1', type: 'segment', current: 5, start: [-1, -1, 0], end: [1, -0.8, 0.2] },
  { id: 'K1', type: 'sheet', K: 20, position: [0, 1.4, 0], normal: [0, 1, 0], direction: [0, 0, 1] },
  { id: 'L1', type: 'loop', current: 5, position: [0, -0.6, 0], radius: 0.4, normal: [0, 1, 0] },
  { id: 'L2', type: 'loop', current: -3, position: [0.4, 0.5, 0.2], radius: 0.3, normal: [0.2, 0.1, 1] },
  { id: 'W0', type: 'wire', current: 0, position: [1, 1, 0], direction: [0, 0, 1] },
  { id: 'Woff', type: 'wire', current: 4, position: [-1, 1, 0], direction: [0, 0, 1], enabled: false },
]);
// Points that hit the special cases: on a charge / inside an exclusion zone, on the ±20 m edge and beyond it, not a number.
const SPECIAL = [[-0.75, 0, 0], [-0.75, 0.0005, 0], [0, -0.55, 0.05], [-0.6, 0.3, 0], [-0.6, 0.3005, 0], [0, -0.6, 0], [0, -0.6, 0.4],
  [0.4, -0.6, 0], [0, 1.4, 0], [0, 1.4005, 0], [20, 0, 0], [20.000001, 0, 0], [0, -25, 0], [NaN, 0, 0], [0, 0, Infinity], [0, 0, 0]];

function assertSampleMatches(field, points, label) {
  const out = new Float64Array(4);
  for (const point of points) {
    const direct = field.evaluate(point), ok = field.sample(point[0], point[1], point[2], out);
    assert.equal(ok, direct.status === 'valid', `${label} at ${point}: valid ${direct.status}`);
    if (!ok) continue;
    for (let i = 0; i < 3; i += 1) same(out[i], direct.vector[i], `${label} at ${point}: vector[${i}]`);
    same(out[3], direct.scalar, `${label} at ${point}: scalar`);
  }
}

test('the charge sampler gives the bits of the charge evaluator (E and V), exclusions and the ±20 m range included', () => {
  const field = createSandboxField(CHARGES);
  assertSampleMatches(field, [...randomPoints(4000, 1), ...SPECIAL], 'sandbox');
  const evaluate = createPointChargeEvaluator(CHARGES), sample = createPointChargeSampler(CHARGES), out = new Float64Array(4);
  for (const point of randomPoints(500, 2)) {
    const direct = evaluate(point);
    assert.equal(sample(...point, out), direct.status === 'valid');
    if (direct.status === 'valid') { direct.E.forEach((value, i) => same(out[i], value, `E[${i}]`)); same(out[3], direct.potential, 'V'); }
  }
  assertSampleMatches(createSandboxField([]), randomPoints(50, 3), 'no sources');
});

test('the current sampler gives the bits of the current evaluator (B and |B|) for wires, segments, sheets and loops', () => {
  assertSampleMatches(createCurrentPlaneField(CURRENTS), [...randomPoints(4000, 4), ...SPECIAL], 'currents');
  for (const source of CURRENTS) assertSampleMatches(createCurrentPlaneField([source]), randomPoints(800, 5), source.id);
});

test('the loop sampler is loopCurrentField without the per-point arrays: same B, same exclusion zone, on the axis too', () => {
  const models = [
    { current: 5, center: [0, -0.6, 0], radius: 0.4, normal: [0, 1, 0] },
    { current: -100, center: [1, 2, -1], radius: 5, normal: [0.3, -0.2, 1] },
    { current: 2, center: [0, 0, 0], radius: 0.05, normal: [0, 0, 1] },
  ];
  for (const model of models) {
    const sample = createLoopSampler(model), out = new Float64Array(3);
    const onAxis = [0, 0.3e-9, 1e-7, 2, -3].map(s => model.center.map((value, i) => value + s * model.normal[i] / Math.hypot(...model.normal)));
    const onWire = [0, 0.5 * Math.PI].map(t => [model.center[0] + model.radius * Math.cos(t), model.center[1], model.center[2] + model.radius * Math.sin(t)]);
    for (const point of [...randomPoints(1500, 6, 6), ...onAxis, ...onWire]) {
      const direct = loopCurrentField(model, point), ok = sample(point[0], point[1], point[2], out);
      assert.equal(ok, direct.status === 'valid', `valid at ${point}`);
      if (ok) direct.B.forEach((value, i) => same(out[i], value, `B[${i}] at ${point}`));
    }
  }
  assert.throws(() => createLoopSampler({ current: 1, radius: 9, normal: [0, 0, 1] }), /반지름/);
});

const AREA = { aMin: -1.6, aMax: 1.4, bMin: -1.5, bMax: 1.7 };
const sameGrid = (actual, expected, label) => {
  assert.equal(actual.values.length, expected.values.length);
  for (let i = 0; i < expected.values.length; i += 1) same(actual.values[i], expected.values[i], `${label} cell ${i}`);
};
const moved = (sources, id, delta) => sources.map(source => (source.id !== id ? source : {
  ...source, ...(source.start ? { start: source.start.map((v, i) => v + delta[i]), end: source.end.map((v, i) => v + delta[i]) }
    : { position: source.position.map((v, i) => v + delta[i]) }),
}));

test('per-source cache: while one charge is dragged, the summed grids equal a direct evaluation and only that charge is sampled', () => {
  const sampler = createSuperpositionSampler();
  let sources = CHARGES;
  const active = CHARGES.filter(source => source.enabled && (source.q ?? source.lambda) !== 0).length;
  for (const [plane, fixed] of [['xy', 0], ['xz', 0.15]]) {
    const field = createSandboxField(sources);
    sameGrid(sampler.scalarGrid(field, plane, fixed, AREA, 31, 27), sampleScalarGrid(field, plane, fixed, AREA, 31, 27), `${plane} start`);
    assert.deepEqual(sampler.vectorGrid(field, plane, fixed, AREA, 7, 6), sampleVectorGrid(field, plane, fixed, AREA, 7, 6), `${plane} arrows`);
  }
  assert.equal(sampler.stats.evaluated, 4 * active, 'every active source once per point set');
  for (let step = 1; step <= 6; step += 1) {
    sources = moved(sources, 'b', [0.07 * step, -0.05, 0]);
    const field = createSandboxField(sources), before = { ...sampler.stats };
    sameGrid(sampler.scalarGrid(field, 'xy', 0, AREA, 31, 27), sampleScalarGrid(field, 'xy', 0, AREA, 31, 27), `drag step ${step}`);
    assert.deepEqual(sampler.vectorGrid(field, 'xy', 0, AREA, 7, 6), sampleVectorGrid(field, 'xy', 0, AREA, 7, 6), `arrows, drag step ${step}`);
    assert.equal(sampler.stats.evaluated - before.evaluated, 2, 'only the moved charge is sampled, once per grid');
    assert.equal(sampler.stats.reused - before.reused, 2 * (active - 1), 'the others come from the cache');
  }
  // A charge removed, one switched off, a line moved: still the direct result.
  for (const next of [sources.filter(source => source.id !== 'a'), sources.map(s => (s.id === 'c' ? { ...s, enabled: false } : s)), moved(sources, 'f', [0, 0.2, 0])]) {
    const field = createSandboxField(next);
    sameGrid(sampler.scalarGrid(field, 'xy', 0, AREA, 31, 27), sampleScalarGrid(field, 'xy', 0, AREA, 31, 27), 'edited set');
  }
});

test('per-source cache for currents: |sum of B| over the grid is bit-identical to the direct |B| while a wire is dragged', () => {
  const sampler = createSuperpositionSampler();
  let sources = CURRENTS;
  for (let step = 0; step <= 5; step += 1) {
    sources = moved(sources, 'W1', [0.05, 0.03 * step, 0]);
    const field = createCurrentPlaneField(sources);
    sameGrid(sampler.scalarGrid(field, 'xy', 0, AREA, 29, 33), sampleScalarGrid(field, 'xy', 0, AREA, 29, 33), `currents step ${step}`);
    assert.deepEqual(sampler.vectorGrid(field, 'xy', 0, AREA, 6, 7), sampleVectorGrid(field, 'xy', 0, AREA, 6, 7));
  }
  // A built-in scene has no parts: it is sampled directly.
  const scene = createSceneField(DEFAULT_SCENES.loop);
  sameGrid(sampler.scalarGrid(scene, 'xz', 0, AREA, 21, 17), sampleScalarGrid(scene, 'xz', 0, AREA, 21, 17), 'scene');
});

test('field lines traced through the fast sampler are the lines of the plain evaluate()', () => {
  const plain = field => ({ ...field, sample: undefined, parts: undefined });
  const charges = createSandboxField(CHARGES), currents = createCurrentPlaneField(CURRENTS.filter(source => source.type !== 'sheet'));
  for (const quality of ['draft', 'final']) {
    assert.deepEqual(computePlaneLines(charges, { plane: 'xy', fixed: 0, area: AREA, sources: CHARGES, quality }),
      computePlaneLines(plain(charges), { plane: 'xy', fixed: 0, area: AREA, sources: CHARGES, quality }), `charges ${quality}`);
    const sources = CURRENTS.filter(source => source.type !== 'sheet');
    assert.deepEqual(computePlaneLines(currents, { plane: 'xy', fixed: 0, area: AREA, sources, quality }),
      computePlaneLines(plain(currents), { plane: 'xy', fixed: 0, area: AREA, sources, quality }), `currents ${quality}`);
  }
});

test('draft magnetic lines (while dragging) are cheaper than the final ones and the rings around a wire still close', () => {
  const sources = validateCurrentSources([
    { id: 'W1', type: 'wire', current: 10, position: [-0.6, 0.45, 0], direction: [0, 0, 1] },
    { id: 'W2', type: 'wire', current: -10, position: [0.6, 0.45, 0], direction: [0, 0, 1] },
    { id: 'L1', type: 'loop', current: 5, position: [0, -0.7, 0], radius: 0.4, normal: [0, 1, 0] },
  ]);
  const field = createCurrentPlaneField(sources), count = lines => lines.reduce((sum, line) => sum + line.points.length, 0);
  const draft = computePlaneLines(field, { plane: 'xy', fixed: 0, area: AREA, sources, quality: 'draft' });
  const final = computePlaneLines(field, { plane: 'xy', fixed: 0, area: AREA, sources, quality: 'final' });
  assert.ok(count(draft) < 0.6 * count(final), `draft ${count(draft)} points, final ${count(final)}`);
  const closed = draft.filter(line => line.end.reason === 'closed');
  assert.ok(closed.length >= 6, `${closed.length} closed rings in the draft`);
  for (const line of closed) assert.deepEqual(line.points[0], line.points.at(-1), 'a closed ring ends where it began');
});
