import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { currentArrowGeometry, currentDirectionDescriptor, currentDirectionGuide, currentProbeLabel, directionWorldEndpoints } from '../src/current-direction.js';

const component = (type, extra = {}) => ({ id: 'X1', type, x: 100, y: 200, rotation: 0, props: { ref: 'X1' }, ...extra });

test('ordinary two-pin current uses pin 1 to pin 2', () => {
  const direction = currentDirectionDescriptor(component('R'));
  assert.equal(direction.label, 'pin 1→2');
  assert.deepEqual(direction.from, { x: -40, y: 0 });
  assert.deepEqual(direction.to, { x: 40, y: 0 });
  assert.equal(currentProbeLabel(component('R')), 'I(X1, pin 1→2)');
});

test('rotation maps the reference arrow onto the actual rotated pins', () => {
  const endpoints = directionWorldEndpoints(component('R', { rotation: 90 }));
  assert.ok(Math.abs(endpoints.from.x - 100) < 1e-12);
  assert.ok(Math.abs(endpoints.from.y - 160) < 1e-12);
  assert.ok(Math.abs(endpoints.to.x - 100) < 1e-12);
  assert.ok(Math.abs(endpoints.to.y - 240) < 1e-12);
});

test('controlled outputs and sensors keep their p to n contract', () => {
  for (const type of ['VCVS', 'VCCS', 'CURRENT_SENSOR', 'CCCS', 'CCVS']) {
    const direction = currentDirectionDescriptor(component(type));
    assert.equal(direction.label, 'p→n (pin 1→2)');
    assert.equal(direction.fromPin, 0);
    assert.equal(direction.toPin, 1);
  }
});

test('op amps point from output toward the internal reference, never between inputs', () => {
  const finite = currentDirectionDescriptor(component('OPAMP'));
  const ideal = currentDirectionDescriptor(component('OPAMP_IDEAL'));
  assert.equal(finite.fromPin, 2);
  assert.equal(finite.toPin, null);
  assert.equal(finite.label, '출력→기준');
  assert.equal(ideal.label, '출력→내부 기준 GND');
  assert.ok(finite.from.x > finite.to.x);
});

test('arrow geometry and legend distinguish sign, zero and AC phasor meaning', () => {
  const arrow = currentArrowGeometry(currentDirectionDescriptor(component('R')));
  assert.equal(arrow.head.length, 3);
  assert.ok(Object.values(arrow).flatMap(value => Array.isArray(value) ? value : [value]).every(Boolean));
  assert.match(currentDirectionGuide('dc'), /음수는 반대 방향/);
  assert.match(currentDirectionGuide('dc'), /0 A는 방향 미확정/);
  assert.match(currentDirectionGuide('ac'), /AC는 페이저 기준 방향/);
});

test('app reuses the direction helper for add, example and reopen presentation', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.ok((app.match(/currentProbeLabel\(/g) ?? []).length >= 3);
  assert.match(app, /function presentProbe/);
  assert.match(app, /probe\.label = currentProbeLabel/);
  assert.match(app, /currentDirectionGuide/);
  assert.match(css, /\.current-direction \{ pointer-events: none;/);
});
