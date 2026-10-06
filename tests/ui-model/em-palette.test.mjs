import test from 'node:test';
import assert from 'node:assert/strict';
import { cssRgba, mixRgb, parseColor } from '../../src/em-palette.js';

test('parseColor reads hex, rgb() and rgba() forms', () => {
  assert.deepEqual(parseColor('#e49b7e'), [228, 155, 126, 1]);
  assert.deepEqual(parseColor(' #fff '), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30, 1]);
  assert.deepEqual(parseColor('rgba(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor('rgba(10, 20, 30, .25)'), [10, 20, 30, 0.25]);
  assert.deepEqual(parseColor('nonsense'), [128, 128, 128, 1], 'an unreadable token degrades to neutral grey');
});

test('mixRgb interpolates per channel and cssRgba formats', () => {
  assert.deepEqual(mixRgb([0, 100, 200], [100, 200, 0], 0.5), [50, 150, 100]);
  assert.deepEqual(mixRgb([1, 2, 3], [9, 9, 9], 0), [1, 2, 3]);
  assert.equal(cssRgba([1, 2, 3], 0.5), 'rgba(1, 2, 3, 0.5)');
});
