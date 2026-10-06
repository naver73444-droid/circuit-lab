import test from 'node:test';
import assert from 'node:assert/strict';
import { MU0, lineCurrentField, loopFieldClosedForm, loopFieldAtN } from '../../../src/em-physics.js';
import {
  createCurrentEvaluator, createCurrentPlaneField, hFromB, planeBasis, screenSense, validateCurrentSources, viewNormal,
} from '../../../src/em-current-field.js';

const wire = (id, current, x, y, direction = [0, 0, 1]) => ({ id, type: 'wire', current, position: [x, y, 0], direction });
const close = (actual, expected, rel = 1e-9) => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `${actual} vs ${expected}`);

test('wire field is mu0 I / (2 pi rho) around the wire (right-hand rule)', () => {
  const sources = validateCurrentSources([wire('W', 10, 0, 0)]), evaluate = createCurrentEvaluator(sources);
  const at = evaluate([0.5, 0, 0]);
  assert.equal(at.status, 'valid');
  close(at.B[1], MU0 * 10 / (2 * Math.PI * 0.5));
  assert.ok(Math.abs(at.B[0]) < 1e-18 && Math.abs(at.B[2]) < 1e-18);
  // the same number as the existing scene model
  const scene = lineCurrentField({ current: 10, position: [0, 0, 0], direction: [0, 0, 1] }, [0.5, 0.3, 0]);
  const mine = evaluate([0.5, 0.3, 0]);
  mine.B.forEach((value, i) => assert.ok(Math.abs(value - scene.B[i]) < 1e-15));
  close(hFromB(at.B)[1], 10 / (2 * Math.PI * 0.5));
});

test('the 1 mm axis zone is excluded and a switched-off or zero source adds nothing', () => {
  const sources = validateCurrentSources([wire('W', 10, 0, 0), { ...wire('X', 5, 1, 0), enabled: false }, wire('Z', 0, -1, 0)]);
  const evaluate = createCurrentEvaluator(sources);
  assert.equal(evaluate([0.0005, 0, 0]).status, 'excluded');
  const far = evaluate([2, 0, 0]);
  close(far.B[1], MU0 * 10 / (2 * Math.PI * 2));
});

test('two wires superpose, and opposite currents cancel on the symmetry plane', () => {
  const evaluate = createCurrentEvaluator(validateCurrentSources([wire('A', 10, -0.1, 0), wire('B', -10, 0.1, 0)]));
  const mid = evaluate([0, 0, 0]);
  // between antiparallel wires the two fields add: 2 mu0 I / (2 pi d/2)
  close(mid.B[1], 2 * MU0 * 10 / (2 * Math.PI * 0.1));
  const same = createCurrentEvaluator(validateCurrentSources([wire('A', 10, -0.1, 0), wire('B', 10, 0.1, 0)]))([0, 0, 0]);
  assert.ok(Math.abs(same.B[1]) < 1e-18);
});

test('the loop evaluator is the closed form of em-physics (and its on-axis value)', () => {
  const loop = { id: 'L', type: 'loop', current: 7, position: [0, 0, 0], radius: 0.5, normal: [0, 0, 1] };
  const evaluate = createCurrentEvaluator(validateCurrentSources([loop]));
  for (const point of [[0, 0, 0.3], [0.2, 0.1, 0.4], [0.9, 0, 0.1]]) {
    const mine = evaluate(point), reference = loopFieldClosedForm({ current: 7, radius: 0.5, normal: [0, 0, 1] }, point);
    mine.B.forEach((value, i) => assert.ok(Math.abs(value - reference[i]) < 1e-15, `${point}`));
  }
  close(evaluate([0, 0, 0]).B[2], MU0 * 7 / (2 * 0.5));
  const numeric = loopFieldAtN({ current: 7, radius: 0.5, normal: [0, 0, 1] }, [0.2, 0.1, 0.4], 512);
  evaluate([0.2, 0.1, 0.4]).B.forEach((value, i) => assert.ok(Math.abs(value - numeric[i]) < 1e-3 * Math.hypot(...numeric)));
  assert.equal(evaluate([0.5, 0, 0]).status, 'excluded');
});

test('a sheet makes mu0 K / 2 on each side, opposite in direction, and the two sheets of a pair give mu0 K between them', () => {
  const upper = { id: 'U', type: 'sheet', K: 20, position: [0, 0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] };
  const lower = { id: 'D', type: 'sheet', K: -20, position: [0, -0.3, 0], normal: [0, 1, 0], direction: [0, 0, 1] };
  const one = createCurrentEvaluator(validateCurrentSources([upper]));
  close(Math.hypot(...one([1, 1, 0]).B), MU0 * 20 / 2);
  assert.ok(one([1, 1, 0]).B[0] * one([1, -1, 0]).B[0] < 0, 'sides are opposite');
  assert.equal(one([0, 0.3, 0]).status, 'excluded');
  const pair = createCurrentEvaluator(validateCurrentSources([upper, lower]));
  close(pair([0.4, 0, 0]).B[0], MU0 * 20);
  assert.ok(Math.hypot(...pair([0, 1, 0]).B) < 1e-15, 'outside the pair the fields cancel');
});

test('a long finite segment approaches the infinite wire and has no field on its own axis beyond the ends', () => {
  const segment = { id: 'S', type: 'segment', current: 10, start: [0, 0, -15], end: [0, 0, 15] };
  const evaluate = createCurrentEvaluator(validateCurrentSources([segment]));
  const rel = Math.abs(evaluate([0.2, 0, 0]).B[1] - MU0 * 10 / (2 * Math.PI * 0.2)) / (MU0 * 10 / (2 * Math.PI * 0.2));
  assert.ok(rel < 1e-3);
  const short = createCurrentEvaluator(validateCurrentSources([{ ...segment, start: [0, 0, -0.5], end: [0, 0, 0.5] }]));
  assert.deepEqual(short([0, 0, 0.8]).B, [0, 0, 0]);
  // mid-plane value: mu0 I L / (4 pi rho sqrt(rho^2 + L^2/4)) with L = 1
  close(short([0.4, 0, 0]).B[1], MU0 * 10 / (4 * Math.PI * 0.4) * 2 * 0.5 / Math.hypot(0.4, 0.5));
});

test('validation: limits, ids, directions and sheet geometry', () => {
  assert.throws(() => validateCurrentSources([wire('W', 150, 0, 0)]), /±100 A/);
  assert.throws(() => validateCurrentSources([wire('W', 1, 0, 0), wire('W', 1, 1, 0)]), /ID/);
  assert.throws(() => validateCurrentSources([wire('W', 1, 0, 0, [0, 0, 0])]), /방향/);
  assert.throws(() => validateCurrentSources([{ id: 'x', type: 'point', q: 1 }]), /알 수 없는/);
  assert.throws(() => validateCurrentSources([{ id: 'S', type: 'sheet', K: 5, position: [0, 0, 0], normal: [0, 1, 0], direction: [0, 1, 0] }]), /판 안/);
  assert.throws(() => validateCurrentSources(Array.from({ length: 17 }, (_, i) => wire(`W${i}`, 1, i * 0.1, 0))), /최대 16/);
  const sheet = validateCurrentSources([{ id: 'S', type: 'sheet', K: 5, position: [0, 0, 0], normal: [0, 2, 0], direction: [1, 3, 1] }])[0];
  assert.ok(Math.abs(sheet.direction[1]) < 1e-12 && Math.abs(Math.hypot(...sheet.direction) - 1) < 1e-12, 'K is made tangent and unit');
});

test('view helpers: xz looks from -y, a wire along the view normal reads as a dot (+) or a cross (-)', () => {
  assert.deepEqual(viewNormal('xy'), [0, 0, 1]);
  assert.deepEqual(viewNormal('xz'), [0, -1, 0]);
  assert.deepEqual(viewNormal('yz'), [1, 0, 0]);
  assert.deepEqual(planeBasis('xz').axes, [0, 2]);
  const [out, into, side] = validateCurrentSources([wire('a', 5, 0, 0), wire('b', -5, 1, 0), wire('c', 5, 2, 0, [1, 0, 0])]);
  assert.equal(screenSense(out, viewNormal('xy')), 1);
  assert.equal(screenSense(into, viewNormal('xy')), -1);
  assert.equal(screenSense(side, viewNormal('xy')), 0);
});

test('the plane field object carries |B| as the scalar and reports excluded points', () => {
  const field = createCurrentPlaneField(validateCurrentSources([wire('W', 10, 0, 0)]));
  assert.equal(field.kind, 'current');
  assert.equal(field.scalarName, '|B|');
  const result = field.evaluate([0.5, 0, 0]);
  close(result.scalar, MU0 * 10 / (2 * Math.PI * 0.5));
  assert.equal(field.evaluate([0, 0, 0]).status, 'excluded');
  assert.equal(field.evaluate([30, 0, 0]).status, 'excluded'); // beyond the +-20 m model range
});
