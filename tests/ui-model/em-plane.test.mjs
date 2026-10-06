import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlaneView, handlesOf, hitGauss, hitSource, planeAxes, planeNormal, pointOnPlane, scaleBar, sectionRadius, zoomAbout,
} from '../../src/em-plane-geometry.js';
import { inspectorFields, patchFromField, sliderFromStrength, strengthFromSlider, strengthText } from '../../src/em-source-edit.js';
import { validatePointSources } from '../../src/em-playground-physics.js';

const view = createPlaneView({ width: 800, height: 600, span: 3 });
const point = (id, q, x, y, z = 0) => ({ id, type: 'point', q, position: [x, y, z], enabled: true, visible: true });

test('the view is equal-aspect, centred on the origin and y is flipped', () => {
  assert.equal(view.scale, 100);
  assert.deepEqual(view.toCanvas(0, 0), [400, 300]);
  assert.deepEqual(view.toCanvas(1, 1), [500, 200]);
  const [a, b] = view.toWorld(500, 200);
  assert.ok(Math.abs(a - 1) < 1e-12 && Math.abs(b - 1) < 1e-12);
  assert.deepEqual(view.area, { aMin: -4, aMax: 4, bMin: -3, bMax: 3 });
  assert.deepEqual(planeAxes('xz'), [0, 2]);
  assert.equal(planeNormal('yz'), 0);
});

test('a canvas position maps to a 3D point with the plane normal fixed', () => {
  assert.deepEqual(pointOnPlane(view, 'xy', 0.5, 500, 200), [1, 1, 0.5]);
  assert.deepEqual(pointOnPlane(view, 'xz', 0.5, 500, 200), [1, 0.5, 1]);
  assert.deepEqual(pointOnPlane(view, 'yz', 0.5, 500, 200), [0.5, 1, 1]);
});

test('picking finds the nearest handle and respects the radius and visibility', () => {
  const sources = validatePointSources([
    point('a', 1e-9, -0.75, 0), point('b', -1e-9, 0.75, 0),
    { id: 'l', type: 'finite-line', lambda: 1e-9, start: [-1, 2, 0], end: [1, 2, 0] },
  ]);
  const hit = hitSource(sources, view, 'xy', 478, 301);
  assert.equal(hit.source.id, 'b');
  assert.equal(hit.handle, 'body');
  assert.equal(hitSource(sources, view, 'xy', 400, 300), null);
  assert.equal(hitSource(sources, view, 'xy', 300, 100).handle, 'start');
  assert.equal(hitSource(sources, view, 'xy', 500, 100).handle, 'end');
  assert.equal(hitSource(sources, view, 'xy', 400, 100).handle, 'body');
  sources[1].visible = false;
  assert.equal(hitSource(sources, view, 'xy', 478, 301), null);
});

test('an infinite line exposes a body and a direction handle', () => {
  const [line] = validatePointSources([
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(handlesOf(line).map(h => h.handle), ['body', 'direction']);
  assert.deepEqual(handlesOf(line)[1].position, [2, 0, 0]);
});

test('the Gauss circle distinguishes ring and interior, and the section shrinks off-plane', () => {
  const gauss = { center: [0, 0, 0], radius: 1 };
  assert.equal(hitGauss(view, 'xy', gauss, 0, 500, 300), 'edge');
  assert.equal(hitGauss(view, 'xy', gauss, 0, 400, 300), 'inside');
  assert.equal(hitGauss(view, 'xy', gauss, 0, 700, 300), null);
  assert.equal(sectionRadius([0, 0, 0.6], 1, 'xy', 0), 0.8);
  assert.equal(sectionRadius([0, 0, 2], 1, 'xy', 0), 0);
  assert.equal(hitGauss(view, 'xy', { center: [0, 0, 2], radius: 1 }, 0, 400, 300), null);
});

test('scale bar uses round numbers and zoom keeps the point under the cursor', () => {
  const bar = scaleBar(view);
  assert.ok([1, 2, 5].includes(bar.meters) || bar.meters === 0.5);
  assert.ok(bar.pixels > 60 && bar.pixels < 160);
  const [a0, b0] = view.toWorld(600, 150);
  const zoomed = createPlaneView({ width: 800, height: 600, ...zoomAbout(view, 600, 150, 0.5) });
  const [a1, b1] = zoomed.toWorld(600, 150);
  assert.ok(Math.abs(a0 - a1) < 1e-12 && Math.abs(b0 - b1) < 1e-12);
  assert.equal(zoomAbout(view, 0, 0, 100).span, 12);
  assert.equal(zoomAbout(view, 0, 0, 0.001).span, 0.8);
});

test('charge slider: notch, log scale, round trip and limits', () => {
  assert.equal(strengthFromSlider(0), 0);
  assert.equal(strengthFromSlider(0.02), 0);
  assert.equal(strengthFromSlider(1), 1000);
  assert.equal(strengthFromSlider(-1), -1000);
  assert.equal(strengthFromSlider(0.03 + 0.97 * 0.4), 1);
  for (const nc of [0.05, 0.3, 1, 2.5, 47, 800, -3, -250]) {
    const back = strengthFromSlider(sliderFromStrength(nc));
    assert.ok(Math.abs(back - nc) / Math.abs(nc) < 0.01, `${nc} -> ${back}`);
  }
  assert.equal(sliderFromStrength(0.001), 0);
  assert.equal(sliderFromStrength(1e6), 1);
  assert.equal(strengthText(point('a', -2e-9, 0, 0)), '−2 nC');
  assert.equal(strengthText({ type: 'infinite-line', lambda: 3e-9 }), '+3 nC/m');
});

test('inspector fields follow the viewed plane and convert units on the way back', () => {
  const [q] = validatePointSources([point('a', 2e-9, 1, 0.5, 3)]);
  const fields = inspectorFields(q, 'xz');
  assert.deepEqual(fields.map(f => [f.id, f.label, f.value]), [['strength', 'q', 2], ['pa', 'x', 1], ['pb', 'z', 3]]);
  assert.deepEqual(patchFromField(q, 'xz', 'pb', 4), { position: [1, 0.5, 4] });
  assert.deepEqual(patchFromField(q, 'xy', 'pa', -1), { position: [-1, 0.5, 3] });
  assert.equal(patchFromField(q, 'xy', 'strength', 5).q, 5e-9);
  assert.equal(patchFromField(q, 'xy', 'pa', NaN), null);
  assert.equal(patchFromField(q, 'xy', 'nope', 1), null);
});

test('line inspector: endpoints, infinite-line angle and strength', () => {
  const [finite, infinite] = validatePointSources([
    { id: 'f', type: 'finite-line', lambda: -1e-9, start: [-1, 0, 0], end: [1, 2, 0] },
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 1, 0], direction: [0, 1, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(inspectorFields(finite, 'xy').map(f => f.id), ['strength', 'sa', 'sb', 'ea', 'eb']);
  assert.equal(inspectorFields(finite, 'xy')[0].value, -1);
  assert.deepEqual(patchFromField(finite, 'xy', 'eb', 5), { end: [1, 5, 0] });
  const angle = inspectorFields(infinite, 'xy').find(f => f.id === 'angle');
  assert.equal(angle.value, 90);
  const patch = patchFromField(infinite, 'xy', 'angle', 0);
  assert.deepEqual(patch.direction.map(v => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
  assert.deepEqual(patchFromField(infinite, 'xz', 'angle', 90).direction.map(v => Math.round(v * 1e9) / 1e9), [0, 0, 1]);
});

test('keyboard nudging moves every kind of source inside the viewed plane', async () => {
  const { nudgePatch } = await import('../../src/em-source-edit.js');
  const [p, f, i] = validatePointSources([
    point('a', 1e-9, 0, 0, 1),
    { id: 'f', type: 'finite-line', lambda: 1e-9, start: [0, 0, 0], end: [1, 0, 0] },
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [0, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  assert.deepEqual(nudgePatch(p, 'xz', 0.5, -0.5), { position: [0.5, 0, 0.5] });
  assert.deepEqual(nudgePatch(f, 'xy', 0, 1), { start: [0, 1, 0], end: [1, 1, 0] });
  assert.deepEqual(nudgePatch(i, 'yz', 2, 3), { position: [0, 2, 3] });
});

test('a new source is placed in a free spot away from sources and the sensor', async () => {
  const { freeSpot } = await import('../../src/em-source-edit.js');
  const sources = validatePointSources([point('a', 1e-9, 0, 0), point('b', -1e-9, 0.9, 0)]);
  const spot = freeSpot(sources, 'xy', 0, [0, 1, 0]);
  for (const other of [[0, 0], [0.9, 0], [0, 1]]) assert.ok(Math.hypot(spot[0] - other[0], spot[1] - other[1]) >= 0.7 - 1e-9);
  assert.equal(spot[2], 0);
  const onXz = freeSpot(sources, 'xz', 0.3, [0, 0.3, 1]);
  assert.equal(onXz[1], 0.3, 'the normal coordinate is kept');
  assert.deepEqual(freeSpot([], 'xy', 0, [5, 5, 0]), [0, 0, 0], 'an empty plane gets its centre');
});

test('a new source keeps clear of an infinite line, not just its reference point', async () => {
  const { freeSpot } = await import('../../src/em-source-edit.js');
  const lines = validatePointSources([
    { id: 'i', type: 'infinite-line', lambda: 1e-9, position: [3, 0, 0], direction: [1, 0, 0], sRef: 1, displayLength: 4 },
  ]);
  const spot = freeSpot(lines, 'xy', 0, [0, 3, 0]);
  assert.ok(Math.abs(spot[1]) >= 0.7 - 1e-9, `kept ${spot[1]} m from the line y=0`);
});
