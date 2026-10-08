import test from 'node:test';
import assert from 'node:assert/strict';
import { bubbleText } from '../../src/signals-course-controller.js';

test('touch bubble fallback: the read-out up to its first " · ", shortened with an ellipsis', () => {
  assert.equal(bubbleText('t=1.09 s: 겹친 곱의 면적 y(t)=1 · x∗h = h∗x'), 't=1.09 s: 겹친 곱의 면적 y(t)=1');
  assert.equal(bubbleText('N=7'), 'N=7');
  assert.equal(bubbleText(''), '');
  assert.equal(bubbleText(null), '');
  const long = bubbleText('x'.repeat(100));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});
