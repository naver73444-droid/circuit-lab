import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampSplit, splitKeyDelta, splitValueFromDelta } from '../src/split-view.js';

test('split values clamp to the current viewport bounds', () => {
  assert.equal(clampSplit(240, 120, 300), 240);
  assert.equal(clampSplit(20, 120, 300), 120);
  assert.equal(clampSplit(900, 120, 300), 300);
  assert.equal(clampSplit(Number.NaN, 120, 300), null);
  assert.equal(clampSplit(200, 300, 120), null);
});

test('opposite-edge splitters apply pointer deltas in the correct direction', () => {
  assert.equal(splitValueFromDelta(156, 40, 1, 120, 300), 196);
  assert.equal(splitValueFromDelta(220, 40, -1, 180, 360), 180);
  assert.equal(splitValueFromDelta(350, -80, -1, 280, 600), 430);
});

test('separator keyboard controls follow aria orientation', () => {
  assert.equal(splitKeyDelta('ArrowLeft', 'vertical'), -12);
  assert.equal(splitKeyDelta('ArrowRight', 'vertical', 36), 36);
  assert.equal(splitKeyDelta('ArrowUp', 'horizontal'), -12);
  assert.equal(splitKeyDelta('ArrowDown', 'horizontal'), 12);
  assert.equal(splitKeyDelta('ArrowDown', 'vertical'), null);
});

test('panel close repair keeps per-panel focus and phone-only modal boundary', async () => {
  const source = await readFile(new URL('../src/panel-controller.js', import.meta.url), 'utf8');
  assert.match(source, /new Map\(\)/);
  assert.match(source, /activeMobile = name/);
  assert.match(source, /activeMobile = null/);
  assert.match(source, /returnFocus\.get\(name\) \?\? triggers\[name\]/);
  assert.match(source, /max-width: 760px/);
});

test('base HTML retains six labelled separators; shared resize math has no persistence', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const split = await readFile(new URL('../src/split-view.js', import.meta.url), 'utf8');
  assert.equal((html.match(/role="separator"/g) ?? []).length, 6);
  assert.match(html, /id="layout-reset-button"/);
  assert.doesNotMatch(split, /\b(?:localStorage|sessionStorage)\b/);
  assert.match(split, /pointercancel/);
  assert.match(split, /releasePointerCapture/);
});
