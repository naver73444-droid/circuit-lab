import test from 'node:test';
import assert from 'node:assert/strict';
import { compress, compressedLevels, contourSegments, contourSet, typicalMagnitude } from '../../../src/em-contour.js';

const grid = (cols, rows, f) => Array.from({ length: cols * rows }, (_, i) => f(i % cols, Math.floor(i / cols)));

test('contour of a paraboloid lies on its circle', () => {
  const cols = 41, rows = 41, c = 20;
  const values = grid(cols, rows, (x, y) => (x - c) ** 2 + (y - c) ** 2);
  const segments = contourSegments(values, cols, rows, 100);
  assert.ok(segments.length >= 4 * 40, 'a full circle of radius 10 cells needs many segments');
  assert.equal(segments.length % 4, 0);
  for (let i = 0; i < segments.length; i += 2) {
    const radius = Math.hypot(segments[i] - c, segments[i + 1] - c);
    assert.ok(Math.abs(radius - 10) < 0.06, `point ${i / 2} radius ${radius}`);
  }
});

test('levels outside the data range produce nothing', () => {
  const values = grid(5, 5, (x, y) => x + y);
  assert.deepEqual(contourSegments(values, 5, 5, 100), []);
  assert.deepEqual(contourSegments(values, 5, 5, -1), []);
  assert.deepEqual(contourSet(values, 5, 5, [100, -1]), []);
});

test('a linear ramp gives one straight vertical line with exact interpolation', () => {
  const values = grid(6, 4, x => x * 10);
  const segments = contourSegments(values, 6, 4, 25);
  assert.equal(segments.length, 3 * 4);
  for (let i = 0; i < segments.length; i += 2) assert.ok(Math.abs(segments[i] - 2.5) < 1e-12);
});

test('cells with a missing corner are skipped', () => {
  const values = grid(4, 4, x => x);
  values[5] = NaN;
  const full = contourSegments(grid(4, 4, x => x), 4, 4, 1.5).length;
  assert.ok(contourSegments(values, 4, 4, 1.5).length < full);
});

test('saddle cells are split by the centre value without crossing', () => {
  // tl=0 tr=1 / bl=1 br=0 around level 0.5 with a high and a low centre.
  const high = contourSegments([0, 1, 1, 0], 2, 2, 0.5);
  assert.equal(high.length, 8);
  const lowCentre = contourSegments([0.6, 0, 0, 0.6], 2, 2, 0.5);
  assert.equal(lowCentre.length, 8);
});

test('compressed levels are symmetric, sorted and include zero', () => {
  const levels = compressedLevels(10, { steps: 4, clip: 30 });
  assert.equal(levels.length, 9);
  assert.deepEqual([...levels].sort((a, b) => a - b), levels);
  assert.equal(levels[4], 0);
  for (let k = 1; k <= 4; k += 1) assert.equal(levels[4 + k], -levels[4 - k]);
  assert.ok(Math.abs(levels[8] - 10 * 30) / 300 < 1e-9, 'the top level reaches the clip value');
  assert.deepEqual(compressedLevels(0), []);
  assert.deepEqual(compressedLevels(NaN), []);
});

test('compression is odd and monotonic; the typical magnitude is the median of |v|', () => {
  assert.equal(compress(0, 5), 0);
  assert.ok(Math.abs(compress(-7, 5) + compress(7, 5)) < 1e-15);
  assert.ok(compress(1, 5) < compress(2, 5));
  assert.equal(typicalMagnitude([1, -3, 2, NaN, 5], 1), 3);
  assert.equal(typicalMagnitude([NaN, NaN], 1), 0);
});
